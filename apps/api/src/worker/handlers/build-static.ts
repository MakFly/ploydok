// SPDX-License-Identifier: AGPL-3.0-only
//
// Static site build handler (Sprint 7 MF3).
//
// Stratégie : run install_command + build_command (contexte nixpacks ou
// commandes user), tar `static_output_dir` (default `dist/`), extraire dans
// `<STATIC_ROOT>/<app_id>/<sha>/` puis symlink atomique
// `<STATIC_ROOT>/<app_id>/current` → `<sha>/`.
// Caddy sert ensuite le contenu via `file_server` (cf. reconciler.ts).
//
// Cette première itération n'inclut pas l'exec réel des commandes (qui
// nécessite l'agent Rust + buildkit). Elle pose la structure : layout disque,
// helpers symlink atomique, GC keep-N, et la signature publique
// `runStaticBuild(opts)` consommable par deploy.ts.

import {
  cp,
  mkdir,
  readFile,
  readlink,
  readdir,
  rename,
  rm,
  stat,
  symlink,
} from "node:fs/promises"
import { existsSync } from "node:fs"
import path from "node:path"
import { childLogger } from "../../logger"

const log = childLogger("build-static")

/**
 * Racine sur disque où sont stockés les sites statiques. Monté en lecture seule
 * dans le container Caddy (à configurer dans `infra/docker-compose.yml`).
 *
 * Évalué dynamiquement à chaque appel pour permettre l'override en test
 * (`Bun.env["PLOYDOK_STATIC_ROOT"]` peut être set par un beforeEach).
 */
export function staticRoot(): string {
  return Bun.env["PLOYDOK_STATIC_ROOT"] ?? "/var/lib/ploydok/static"
}

export function staticRootForApp(appId: string): string {
  return path.join(staticRoot(), appId, "current")
}

export function caddyStaticRoot(): string {
  return Bun.env["PLOYDOK_CADDY_STATIC_ROOT"] ?? staticRoot()
}

export function caddyStaticRootForApp(appId: string): string {
  return path.join(caddyStaticRoot(), appId, "current")
}

export interface StaticBuildOptions {
  appId: string
  sha: string
  /**
   * Tarball ou dossier `dist/` déjà extrait — chemin source pré-build.
   * Pour la version sans agent : on attend un dossier prêt à être copié.
   */
  sourceDir: string
  rootDir?: string | null
  /**
   * Nom du dossier de sortie attendu (default `dist`). Si présent, c'est
   * `sourceDir/<staticOutputDir>` qui est copié.
   */
  staticOutputDir?: string
  installCommand?: string | null
  buildCommand?: string | null
  env?: Record<string, string>
  onLog?: (line: string) => void
}

export interface StaticBuildResult {
  appId: string
  sha: string
  installedAt: string
  currentSymlink: string
  shaDir: string
}

function appDir(appId: string): string {
  return path.join(staticRoot(), appId)
}

function shaDir(appId: string, sha: string): string {
  return path.join(appDir(appId), sha)
}

function currentLink(appId: string): string {
  return path.join(appDir(appId), "current")
}

function safeRelativePath(value: string, label: string): string {
  if (
    value.includes("\0") ||
    value.includes("\\") ||
    path.isAbsolute(value)
  ) {
    throw new Error(`${label} must be a safe relative path`)
  }
  const segments = value.split("/")
  if (segments.some((segment) => segment === "" || segment === "..")) {
    throw new Error(`${label} must not contain empty or '..' segments`)
  }
  return value
}

async function runShellCommand(opts: {
  command: string
  cwd: string
  env?: Record<string, string>
  onLog?: (line: string) => void
}): Promise<void> {
  opts.onLog?.(`[static] $ ${opts.command}`)
  const proc = Bun.spawn(["sh", "-lc", opts.command], {
    cwd: opts.cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, ...opts.env },
  })
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  for (const line of `${stdout}${stderr}`.split("\n")) {
    if (line) opts.onLog?.(line)
  }
  if (code !== 0) {
    throw new Error(`static command failed (exit ${code}): ${opts.command}`)
  }
}

async function detectDefaultBuildCommand(cwd: string): Promise<string | null> {
  try {
    const packageJson = JSON.parse(
      await readFile(path.join(cwd, "package.json"), "utf8")
    ) as { scripts?: Record<string, unknown> }
    return typeof packageJson.scripts?.["build"] === "string"
      ? `${JSON.stringify(process.execPath)} run build`
      : null
  } catch {
    return null
  }
}

/**
 * Promote un build SHA en `current` via symlink atomique :
 *   1. créer un symlink temporaire `current.<rand>` → `<sha>/`
 *   2. `rename()` atomique du temporaire vers `current` (POSIX garantit l'atomicité)
 */
export async function promoteSha(appId: string, sha: string): Promise<void> {
  const target = shaDir(appId, sha)
  if (!existsSync(target)) {
    throw new Error(`promoteSha: missing ${target}`)
  }
  const link = currentLink(appId)
  const tmp = `${link}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`
  await symlink(sha, tmp)
  await rename(tmp, link)
}

/**
 * GC : garde les `keepN` SHAs les plus récents (par mtime). Le `current`
 * symlink target est toujours préservé.
 */
export async function gcOldShas(appId: string, keepN: number): Promise<number> {
  const dir = appDir(appId)
  if (!existsSync(dir)) return 0
  const link = currentLink(appId)
  let currentTarget: string | null = null
  try {
    currentTarget = await readlink(link)
  } catch {
    currentTarget = null
  }
  const entries = await readdir(dir, { withFileTypes: true })
  const shas = entries
    .filter((e) => e.isDirectory() && e.name !== "current")
    .map((e) => e.name)
    .sort()
    .reverse()

  const toDelete = shas.slice(keepN).filter((s) => s !== currentTarget)
  for (const s of toDelete) {
    await rm(path.join(dir, s), { recursive: true, force: true })
  }
  return toDelete.length
}

/**
 * Pose le build SHA sur disque (skeleton — la copie réelle viendra avec
 * l'intégration agent dans Wave 2). Pour l'instant, crée juste le dossier
 * cible et le symlink — utilisable pour smoke-test du flow.
 */
export async function runStaticBuild(
  opts: StaticBuildOptions
): Promise<StaticBuildResult> {
  const rootDir = opts.rootDir
    ? safeRelativePath(opts.rootDir, "rootDir")
    : "."
  const workspaceRoot = path.resolve(opts.sourceDir, rootDir)
  const staticOutputDir = safeRelativePath(
    opts.staticOutputDir ?? "dist",
    "staticOutputDir"
  )
  const outputDir = path.resolve(workspaceRoot, staticOutputDir)
  const workspacePrefix = `${workspaceRoot}${path.sep}`
  if (outputDir !== workspaceRoot && !outputDir.startsWith(workspacePrefix)) {
    throw new Error("staticOutputDir must stay inside the workspace root")
  }

  if (opts.installCommand?.trim()) {
    await runShellCommand({
      command: opts.installCommand,
      cwd: workspaceRoot,
      ...(opts.env !== undefined && { env: opts.env }),
      ...(opts.onLog !== undefined && { onLog: opts.onLog }),
    })
  }

  const buildCommand =
    opts.buildCommand?.trim() || (await detectDefaultBuildCommand(workspaceRoot))
  if (buildCommand) {
    await runShellCommand({
      command: buildCommand,
      cwd: workspaceRoot,
      ...(opts.env !== undefined && { env: opts.env }),
      ...(opts.onLog !== undefined && { onLog: opts.onLog }),
    })
  }

  const outputStat = await stat(outputDir).catch(() => null)
  if (!outputStat?.isDirectory()) {
    throw new Error(`static output directory not found: ${staticOutputDir}`)
  }

  await mkdir(appDir(opts.appId), { recursive: true })
  const target = shaDir(opts.appId, opts.sha)
  const tmpTarget = path.join(
    appDir(opts.appId),
    `.tmp-${opts.sha}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  )
  await rm(target, { recursive: true, force: true })
  await rm(tmpTarget, { recursive: true, force: true })
  await cp(outputDir, tmpTarget, {
    recursive: true,
    errorOnExist: false,
    force: true,
  })
  await rename(tmpTarget, target)
  log.info(
    { appId: opts.appId, sha: opts.sha, outputDir, target },
    "static.build.installed"
  )
  await promoteSha(opts.appId, opts.sha)
  return {
    appId: opts.appId,
    sha: opts.sha,
    installedAt: new Date().toISOString(),
    currentSymlink: currentLink(opts.appId),
    shaDir: target,
  }
}

/**
 * Helper publié pour la branche static dans deploy.ts. Centralise les
 * post-conditions DB (status="serving", container_id=null).
 */
export async function dispatchStaticDeploy(
  appId: string,
  sha: string,
  staticOutputDir = "dist",
  opts: {
    workspacePath?: string
    rootDir?: string | null
    installCommand?: string | null
    buildCommand?: string | null
    env?: Record<string, string>
    onLog?: (line: string) => void
  } = {}
): Promise<StaticBuildResult> {
  return runStaticBuild({
    appId,
    sha,
    sourceDir:
      opts.workspacePath ??
      path.join(
        Bun.env["PLOYDOK_BUILD_DIR"] ?? "/tmp/ploydok-builds",
        appId,
        sha
      ),
    staticOutputDir,
    ...(opts.rootDir !== undefined && { rootDir: opts.rootDir }),
    ...(opts.installCommand !== undefined && {
      installCommand: opts.installCommand,
    }),
    ...(opts.buildCommand !== undefined && { buildCommand: opts.buildCommand }),
    ...(opts.env !== undefined && { env: opts.env }),
    ...(opts.onLog !== undefined && { onLog: opts.onLog }),
  })
}
