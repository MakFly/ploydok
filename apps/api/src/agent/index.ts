// SPDX-License-Identifier: AGPL-3.0-only
export { Agent } from "./wrapper.js"
export { createAgentClient } from "./client.js"
export type { AgentClientOptions } from "./client.js"
export {
  AgentError,
  toAgentError,
  GrpcStatus,
  isAlreadyExists,
  isNotFound,
} from "./errors.js"

// Types utiles réexportés depuis le proto
export type {
  // Requests
  ContainerCreateRequest,
  ContainerStartRequest,
  ContainerStopRequest,
  ContainerRemoveRequest,
  ContainerLogsRequest,
  ContainerStatsRequest,
  ImagePullRequest,
  ImageBuildRequest,
  NetworkCreateRequest,
  NetworkRemoveRequest,
  NetworkConnectRequest,
  NetworkDisconnectRequest,
  // Responses
  ContainerCreateResponse,
  ContainerStartResponse,
  ContainerStopResponse,
  ContainerRemoveResponse,
  NetworkCreateResponse,
  NetworkRemoveResponse,
  NetworkConnectResponse,
  NetworkDisconnectResponse,
  // Stream frames
  LogLine,
  StatsFrame,
  PullProgress,
  BuildProgress,
  // Helpers
  VolumeMount,
  PortMapping,
  ResourceLimits,
  HealthcheckConfig,
  // Host stats (Sprint 6.6)
  HostStatsRequest,
  HostStatsResponse,
} from "@ploydok/agent-proto"
