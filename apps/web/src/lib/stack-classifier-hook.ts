// SPDX-License-Identifier: AGPL-3.0-only
import { useQuery } from "@tanstack/react-query";
import {
  ALL_PROBE_KEYS,
  ENV_FILE_PROBE_KEYS,
  MANIFEST_FILE_PROBE_KEYS,
  classifyStackWithManifests,
  parseEnvFile,
} from "@ploydok/shared";
import { apiFetch } from "./api";
import type {
  ManifestContents,
  ManifestProbeKey,
  ParsedEnvVar,
  ProbeResults,
  StackClassification,
} from "@ploydok/shared";
import type { ApiError } from "./api";

type Source = "github" | "gitlab";

interface FileExistsBatchResponse {
  files: Record<string, boolean>;
}

interface ManifestFileResponse {
  path: string;
  content: string;
}

function buildFilesExistUrl(
  source: Source,
  fullName: string,
  paths: ReadonlyArray<string>,
  ref: string,
): string {
  const params = new URLSearchParams();
  for (const path of paths) params.append("path", path);
  params.set("ref", ref);

  if (source === "github") {
    const [owner, repo] = fullName.split("/");
    return `/github/repos/${encodeURIComponent(owner ?? "")}/${encodeURIComponent(
      repo ?? "",
    )}/files-exist?${params.toString()}`;
  }

  return `/gitlab/repos/${encodeURIComponent(fullName)}/files-exist?${params.toString()}`;
}

function buildManifestFileUrl(
  source: Source,
  fullName: string,
  path: ManifestProbeKey,
  ref: string,
): string {
  const params = new URLSearchParams({ path, ref });

  if (source === "github") {
    const [owner, repo] = fullName.split("/");
    return `/github/repos/${encodeURIComponent(owner ?? "")}/${encodeURIComponent(
      repo ?? "",
    )}/manifest-file?${params.toString()}`;
  }

  return `/gitlab/repos/${encodeURIComponent(fullName)}/manifest-file?${params.toString()}`;
}

async function runProbes(
  source: Source,
  fullName: string,
  ref: string,
): Promise<{ probes: ProbeResults; files: Record<string, boolean> }> {
  const paths = Array.from(new Set([...ALL_PROBE_KEYS, ...MANIFEST_FILE_PROBE_KEYS]));
  try {
    const res = await apiFetch<FileExistsBatchResponse>(
      buildFilesExistUrl(source, fullName, paths, ref),
    );
    const out: ProbeResults = {};
    for (const key of ALL_PROBE_KEYS) {
      if (res.files[key] === true) out[key] = true;
    }
    return { probes: out, files: res.files };
  } catch {
    // Probe failures (404, network) are treated as "not present" — classifier will
    // handle missing signals gracefully.
    return { probes: {}, files: {} };
  }
}

export async function runStackClassificationProbes(
  source: Source,
  fullName: string,
  ref: string,
): Promise<{ probes: ProbeResults; classification: StackClassification }> {
  const { probes, files } = await runProbes(source, fullName, ref);
  const manifestEntries = await Promise.all(
    MANIFEST_FILE_PROBE_KEYS.map(async (path) => {
      if (files[path] !== true) return null;
      try {
        const response = await apiFetch<ManifestFileResponse>(
          buildManifestFileUrl(source, fullName, path, ref),
        );
        return [path, response.content] as const;
      } catch {
        return null;
      }
    }),
  );
  const manifests: ManifestContents = Object.fromEntries(
    manifestEntries.filter((entry): entry is [ManifestProbeKey, string] =>
      Boolean(entry),
    ),
  );
  const classification = classifyStackWithManifests(probes, manifests);
  return { probes, classification };
}

export function detectedEnvFiles(
  probes: ProbeResults | undefined,
): Array<string> {
  if (!probes) return [];
  return ENV_FILE_PROBE_KEYS.filter((path) => probes[path] === true);
}

interface EnvFileResponse {
  path: string;
  content: string;
}

function buildEnvFileUrl(
  source: Source,
  fullName: string,
  path: string,
  ref: string,
): string {
  const params = new URLSearchParams({ path, ref });

  if (source === "github") {
    const [owner, repo] = fullName.split("/");
    return `/github/repos/${encodeURIComponent(owner ?? "")}/${encodeURIComponent(
      repo ?? "",
    )}/env-file?${params.toString()}`;
  }

  return `/gitlab/repos/${encodeURIComponent(fullName)}/env-file?${params.toString()}`;
}

export async function importEnvFileVars(params: {
  source: Source;
  fullName: string;
  path: string;
  ref: string;
}): Promise<Array<ParsedEnvVar>> {
  const response = await apiFetch<EnvFileResponse>(
    buildEnvFileUrl(params.source, params.fullName, params.path, params.ref),
  );
  return parseEnvFile(response.content);
}

export interface UseStackClassificationResult {
  data: StackClassification | undefined;
  probes: ProbeResults | undefined;
  isLoading: boolean;
  isFetching: boolean;
  error: ApiError | null;
}

/**
 * Runs the full probe set in parallel against the given repo + ref and
 * returns a deterministic StackClassification. Enabled only when both
 * fullName and ref are provided.
 */
export function useStackClassification(
  source: Source | undefined,
  fullName: string | undefined,
  ref: string | undefined,
): UseStackClassificationResult {
  const enabled = Boolean(source && fullName && ref);
  const query = useQuery<
    { probes: ProbeResults; classification: StackClassification },
    ApiError
  >({
    queryKey: ["stack-classifier", source ?? "", fullName ?? "", ref ?? ""],
    queryFn: async () => {
      return runStackClassificationProbes(
        source as Source,
        fullName as string,
        ref as string,
      );
    },
    enabled,
    staleTime: 5 * 60_000,
  });

  return {
    data: query.data?.classification,
    probes: query.data?.probes,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error,
  };
}
