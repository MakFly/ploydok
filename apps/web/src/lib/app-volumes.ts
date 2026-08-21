// SPDX-License-Identifier: AGPL-3.0-only
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { apiFetch } from "./api"
import i18n from "./i18n"
import type {
  AppVolume,
  CreateAppVolumeInput,
  UpdateAppVolumeInput,
} from "@ploydok/shared"

const appVolumesKey = (appId: string) => ["app-volumes", appId] as const

export type { AppVolume, CreateAppVolumeInput, UpdateAppVolumeInput }

export function useAppVolumes(appId: string) {
  return useQuery({
    queryKey: appVolumesKey(appId),
    queryFn: () =>
      apiFetch<{ volumes: Array<AppVolume> }>(`/apps/${appId}/volumes`).then(
        (data) => data.volumes
      ),
  })
}

export function useCreateAppVolume(appId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateAppVolumeInput) =>
      apiFetch<{ volume: AppVolume }>(`/apps/${appId}/volumes`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: input,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: appVolumesKey(appId) })
      toast.success(i18n.t("apps:toasts.volumeCreated"))
    },
    onError: (err: Error) => {
      toast.error(i18n.t("apps:toasts.volumeCreateFailed", { message: err.message }))
    },
  })
}

export function useUpdateAppVolume(appId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      volumeId,
      input,
    }: {
      volumeId: string
      input: UpdateAppVolumeInput
    }) =>
      apiFetch<{ volume: AppVolume }>(`/apps/${appId}/volumes/${volumeId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: input,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: appVolumesKey(appId) })
      toast.success(i18n.t("apps:toasts.volumeUpdated"))
    },
    onError: (err: Error) => {
      toast.error(i18n.t("apps:toasts.volumeUpdateFailed", { message: err.message }))
    },
  })
}

export function useDeleteAppVolume(appId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (volumeId: string) =>
      apiFetch<{ ok: true }>(`/apps/${appId}/volumes/${volumeId}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: appVolumesKey(appId) })
      toast.success(i18n.t("apps:toasts.volumeDeleted"))
    },
    onError: (err: Error) => {
      toast.error(i18n.t("apps:toasts.volumeDeleteFailed", { message: err.message }))
    },
  })
}
