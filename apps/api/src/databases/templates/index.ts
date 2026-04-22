// SPDX-License-Identifier: AGPL-3.0-only

export interface DbPlan {
  cpu: number
  mem_mb: number
}

export interface DbTemplate {
  kind: "postgres" | "redis" | "mongo"
  image: string
  plans: Record<"small" | "medium" | "large", DbPlan>
  volume_path: string
  port: number
  healthcheck: string
  env: Record<string, string>
  args?: string[]
  connection_string: string
}

export const templates: Record<"postgres" | "redis" | "mongo", DbTemplate> = {
  postgres: {
    kind: "postgres",
    image: "postgres:16-alpine",
    plans: {
      small: { cpu: 0.5, mem_mb: 512 },
      medium: { cpu: 1.0, mem_mb: 2048 },
      large: { cpu: 2.0, mem_mb: 8192 },
    },
    volume_path: "/var/lib/postgresql/data",
    port: 5432,
    healthcheck: "pg_isready -U $POSTGRES_USER",
    env: {
      POSTGRES_USER: "ploydok",
      POSTGRES_DB: "app",
      POSTGRES_PASSWORD: "@generated(32)",
    },
    connection_string: "postgres://{user}:{password}@{host}:{port}/{database}",
  },
  redis: {
    kind: "redis",
    image: "redis:7-alpine",
    plans: {
      small: { cpu: 0.25, mem_mb: 256 },
      medium: { cpu: 0.5, mem_mb: 1024 },
      large: { cpu: 1.0, mem_mb: 4096 },
    },
    volume_path: "/data",
    port: 6379,
    healthcheck: "redis-cli ping",
    env: {},
    args: ["--requirepass", "@generated(32)"],
    connection_string: "redis://:{password}@{host}:{port}",
  },
  mongo: {
    kind: "mongo",
    image: "mongo:7",
    plans: {
      small: { cpu: 0.5, mem_mb: 512 },
      medium: { cpu: 1.0, mem_mb: 2048 },
      large: { cpu: 2.0, mem_mb: 8192 },
    },
    volume_path: "/data/db",
    port: 27017,
    healthcheck: "mongosh --eval \"db.adminCommand('ping')\"",
    env: {
      MONGO_INITDB_ROOT_USERNAME: "ploydok",
      MONGO_INITDB_ROOT_PASSWORD: "@generated(32)",
      MONGO_INITDB_DATABASE: "app",
    },
    connection_string: "mongodb://{user}:{password}@{host}:{port}/{database}?authSource=admin",
  },
}
