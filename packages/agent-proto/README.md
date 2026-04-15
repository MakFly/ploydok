# @ploydok/agent-proto

Shared Protobuf definitions for the `ploydok-agent` gRPC daemon.

## Source of truth

```
packages/agent-proto/proto/agent.proto
```

This file is the **single source of truth** for the `ploydok.agent.v1` package.
Never edit the generated files directly — always edit the `.proto` file and regenerate.

## Package convention

Proto package: `ploydok.agent.v1`
gRPC service: `Agent`

## Regenerating — TypeScript

Prerequisites: `protoc` (>= 3.21) available on PATH (Ubuntu: `apt install protobuf-compiler`).

```sh
# From the monorepo root
bun install
bun run --cwd packages/agent-proto gen
```

The generated code lands in `packages/agent-proto/src/gen/agent.ts`.
Generated files are committed to the repository so that consumers and CI do not
need `protoc` installed.

## Regenerating — Rust

The Rust stubs are generated at **build time** by `tonic-build` (via `build.rs`).
No manual step required — simply run:

```sh
cd agent
cargo build -p ploydok-proto
```

The generated code is written to `agent/target/…/OUT_DIR/ploydok.agent.v1.rs` and
included automatically via `tonic::include_proto!` in `agent/crates/ploydok-proto/src/lib.rs`.

## Usage — TypeScript (apps/api or tests)

```ts
import { AgentClient, ContainerCreateRequest } from "@ploydok/agent-proto";
```

## Usage — Rust (agent crates)

```rust
use ploydok_proto::agent::{
    agent_client::AgentClient,
    ContainerCreateRequest,
};
```
