// SPDX-License-Identifier: AGPL-3.0-only
import { useQuery } from "@tanstack/react-query";
import {
  ALL_PROBE_KEYS,
  classifyStack,
  type ProbeKey,
  type ProbeResults,
  type StackClassification,
} from "@ploydok/shared";
import { apiFetch } from "./api";
import type { ApiError } from "./api";

type Source = "github" | "gitlab";

async function probeOne(
  source: Source,
  fullName: string,
  path: string,
  ref: string,
): Promise<boolean> {
  const pathEnc = encodeURIComponent(path);
  const refEnc = encodeURIComponent(ref);
  let url: string;
  if (source === "github") {
    const [owner, repo] = fullName.split("/");
    url = `/github/repos/${owner}/${repo}/file-exists?path=${pathEnc}&ref=${refEnc}`;
  } else {
    url = `/gitlab/repos/${encodeURIComponent(fullName)}/file-exists?path=${pathEnc}&ref=${refEnc}`;
  }
  try {
    const res = await apiFetch<{ exists: boolean }>(url);
    return res.exists === true;
  } catch {
    // Probe failures (404, network) treated as "not present" — classifier will
    // handle missing signals gracefully.
    return false;
  }
}

async function runProbes(
  source: Source,
  fullName: string,
  ref: string,
): Promise<ProbeResults> {
  const entries = await Promise.all(
    ALL_PROBE_KEYS.map(async (key) => [key, await probeOne(source, fullName, key, ref)] as const),
  );
  const out: ProbeResults = {};
  for (const [key, exists] of entries) {
    if (exists) out[key as ProbeKey] = true;
  }
  return out;
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
      const probes = await runProbes(source as Source, fullName as string, ref as string);
      const classification = classifyStack(probes);
      return { probes, classification };
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
