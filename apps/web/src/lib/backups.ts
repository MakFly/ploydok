// SPDX-License-Identifier: AGPL-3.0-only
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiFetch } from "./api"
import { toast } from "sonner"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Backup {
  id: string
  databaseId: string
  configId: string | null
  destinationKind: "s3" | "local" | null
  location: string
  sizeBytes: number | null
  ageEncrypted: boolean
  status: "running" | "succeeded" | "failed"
  error: string | null
  startedAt: string
  finishedAt: string | null
}

export interface BackupConfig {
  id: string
  databaseId: string
  destinationKind: "s3" | "local"
  s3Endpoint: string | null
  s3Bucket: string | null
  s3Prefix: string | null
  s3Region: string | null
  s3CredentialsSecretId: string | null
  scheduleCron: string
  retentionDays: number
  ageRecipientPublicKey: string | null
  enabled: boolean
  lastRunAt: string | null
  lastError: string | null
  createdAt: string | undefined
}

export interface UpdateBackupConfigInput {
  destinationKind?: "s3" | "local"
  s3Endpoint?: string
  s3Bucket?: string
  s3Prefix?: string
  s3Region?: string
  s3CredentialsSecretId?: string
  scheduleCron?: string
  retentionDays?: number
  ageRecipientPublicKey?: string | null
  enabled?: boolean
}

export interface RestoreInput {
  backupId: string
  ageIdentity?: string
  confirm: string
}

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

const backupsKey = (databaseId: string) => ["backups", databaseId] as const
const backupConfigKey = (databaseId: string) => ["backup-config", databaseId] as const

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export function useBackups(databaseId: string) {
  return useQuery({
    queryKey: backupsKey(databaseId),
    queryFn: () => apiFetch<{ backups: Backup[] }>(`/databases/${databaseId}/backups`).then((d) => d.backups),
    refetchInterval: 10_000,
  })
}

export function useBackupConfig(databaseId: string) {
  return useQuery({
    queryKey: backupConfigKey(databaseId),
    queryFn: () =>
      apiFetch<{ config: BackupConfig | null }>(`/databases/${databaseId}/backup-config`).then(
        (d) => d.config,
      ),
  })
}

export function useUpdateBackupConfig(databaseId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: UpdateBackupConfigInput) => {
      return apiFetch<{ config: BackupConfig }>(`/databases/${databaseId}/backup-config`, {
        method: "PUT",
        body: JSON.stringify(input),
        headers: { "content-type": "application/json" },
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: backupConfigKey(databaseId) })
      toast.success("Backup configuration saved")
    },
    onError: (err: Error) => {
      toast.error(`Save failed: ${err.message}`)
    },
  })
}

export function useBackupNow(databaseId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      return apiFetch<{ message: string; backupId: string }>(`/databases/${databaseId}/backup-now`, {
        method: "POST",
      })
    },
    onSuccess: () => {
      toast.success("Backup started")
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: backupsKey(databaseId) })
      }, 2000)
    },
    onError: (err: Error) => {
      toast.error(`Backup failed: ${err.message}`)
    },
  })
}

export function useRestoreBackup(databaseId: string) {
  return useMutation({
    mutationFn: async (input: RestoreInput) => {
      return apiFetch<{ ok: boolean }>(`/databases/${databaseId}/restore`, {
        method: "POST",
        body: JSON.stringify(input),
        headers: { "content-type": "application/json" },
      })
    },
    onSuccess: () => {
      toast.success("Restore completed")
    },
    onError: (err: Error) => {
      toast.error(`Restore failed: ${err.message}`)
    },
  })
}

export function useDeleteBackup(databaseId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (backupId: string) => {
      return apiFetch<{ ok: boolean }>(`/backups/${backupId}`, { method: "DELETE" })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: backupsKey(databaseId) })
      toast.success("Backup deleted")
    },
    onError: (err: Error) => {
      toast.error(`Delete failed: ${err.message}`)
    },
  })
}
