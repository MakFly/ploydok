# Framework builds

## Summary

Ploydok now distinguishes three framework-specific concerns that were previously conflated:

- runtime port: `apps.runtime_port`
- healthcheck probe port: `apps.healthcheck_port`
- secret exposure phase: `secrets.phase ∈ {build, runtime, both}`

This is primarily meant for Next.js and TanStack deployments where build-time variables and runtime variables are often different.

## Next.js

- Keep `buildMethod=auto` unless you need to force `docker` or `nixpacks`.
- Set `runtimePort=3000` unless your app listens elsewhere.
- Put `NEXT_PUBLIC_*` values needed during `next build` in secrets with `phase=build` or `phase=both`.
- Put server-only runtime values in secrets with `phase=runtime`.
- For Dockerfile builds, build-time secrets are forwarded as both BuildKit secrets and build args.

## TanStack Start

- Set `runtimePort=3000` unless the app listens on another port.
- Use `nixpacksConfigPath` when auto-detection needs an explicit `nixpacks.toml`.
- Use `nodeVersion` when the repo needs a pinned Node major for the builder.
- Put `VITE_*` and other compile-time values in secrets with `phase=build` or `phase=both`.

## Nixpacks

The Nixpacks path now accepts:

- `nixpacksConfigPath`
- `nodeVersion`
- `installCommand`
- `buildCommand`
- `startCommand`
- build-time env via secrets resolver

## Notes

- `healthcheck.port` overrides only the readiness probe. It no longer defines the public upstream port.
- `runtimePort` is injected into the container as `PORT`.
- Existing secrets without a phase default to `runtime`.
