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

import { rename, mkdir, readlink, readdir, rm, symlink } from "node:fs/promises"
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

export interface StaticBuildOptions {
  appId: string
  sha: string
  /**
   * Tarball ou dossier `dist/` déjà extrait — chemin source pré-build.
   * Pour la version sans agent : on attend un dossier prêt à être copié.
   */
  sourceDir: string
  /**
   * Nom du dossier de sortie attendu (default `dist`). Si présent, c'est
   * `sourceDir/<staticOutputDir>` qui est copié.
   */
  staticOutputDir?: string
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
  const target = shaDir(opts.appId, opts.sha)
  await mkdir(target, { recursive: true })
  log.info(
    { appId: opts.appId, sha: opts.sha, target },
    "static.build.layout_ready"
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
  staticOutputDir = "dist"
): Promise<StaticBuildResult> {
  return runStaticBuild({
    appId,
    sha,
    sourceDir: path.join(
      Bun.env["PLOYDOK_BUILD_DIR"] ?? "/tmp/ploydok-builds",
      appId,
      sha
    ),
    staticOutputDir,
  })
}
