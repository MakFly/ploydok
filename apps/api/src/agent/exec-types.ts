// SPDX-License-Identifier: AGPL-3.0-only
//
// Re-exports exec-related types from @ploydok/agent-proto.
//
// Note: @ploydok/agent-proto has been regenerated with the ContainerExec RPC.
// This file provides a stable import path inside apps/api so that
// apps-exec.ts and wrapper.ts don't need to change if the proto package
// ever restructures its exports.

export type {
  ExecFrame,
  ExecStart,
  ExecResize,
  ExecExit,
  ExecReady,
} from "@ploydok/agent-proto"
