// SPDX-License-Identifier: AGPL-3.0-only

export interface DbPlan {
  cpu: number
  mem_mb: number
}

export interface DbTemplate {
  kind: "postgres" | "mysql" | "mariadb" | "redis" | "mongo" | "libsql"
  version: string
  image: string
  plans: Record<"small" | "medium" | "large", DbPlan>
  volume_path: string
  port: number
  healthcheck: string
  env: Record<string, string>
  args?: string[]
  connection_string: string
}

export const templates: Record<
  "postgres" | "mysql" | "mariadb" | "redis" | "mongo" | "libsql",
  DbTemplate
> = {
  postgres: {
    kind: "postgres",
    version: "16",
    image: "postgres:16-alpine",
    plans: {
      small: { cpu: 0.5, mem_mb: 512 },
      medium: { cpu: 1.0, mem_mb: 2048 },
      large: { cpu: 2.0, mem_mb: 8192 },
    },
    volume_path: "/var/lib/postgresql/data",
    port: 5432,
    healthcheck: "pg_isready -U $POSTGRES_USER -d $POSTGRES_DB",
    env: {
      POSTGRES_USER: "ploydok",
      POSTGRES_DB: "app",
      POSTGRES_PASSWORD: "@generated(32)",
    },
    connection_string:
      "postgres://{user}:{password}@{host}:{port}/{database}?serverVersion=16&charset=utf8",
  },
  mysql: {
    kind: "mysql",
    version: "8.4",
    image: "mysql:8.4",
    plans: {
      small: { cpu: 0.5, mem_mb: 512 },
      medium: { cpu: 1.0, mem_mb: 2048 },
      large: { cpu: 2.0, mem_mb: 8192 },
    },
    volume_path: "/var/lib/mysql",
    port: 3306,
    healthcheck: "mysqladmin ping -h 127.0.0.1 -uroot -p$MYSQL_ROOT_PASSWORD",
    env: {
      MYSQL_DATABASE: "app",
      MYSQL_USER: "ploydok",
      MYSQL_PASSWORD: "@generated(32)",
      MYSQL_ROOT_PASSWORD: "@generated(32)",
    },
    connection_string: "mysql://{user}:{password}@{host}:{port}/{database}",
  },
  mariadb: {
    kind: "mariadb",
    version: "11.4",
    image: "mariadb:11.4",
    plans: {
      small: { cpu: 0.5, mem_mb: 512 },
      medium: { cpu: 1.0, mem_mb: 2048 },
      large: { cpu: 2.0, mem_mb: 8192 },
    },
    volume_path: "/var/lib/mysql",
    port: 3306,
    healthcheck:
      "mariadb-admin ping -h 127.0.0.1 -uroot -p$MARIADB_ROOT_PASSWORD",
    env: {
      MARIADB_DATABASE: "app",
      MARIADB_USER: "ploydok",
      MARIADB_PASSWORD: "@generated(32)",
      MARIADB_ROOT_PASSWORD: "@generated(32)",
    },
    connection_string: "mysql://{user}:{password}@{host}:{port}/{database}",
  },
  redis: {
    kind: "redis",
    version: "7",
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
    version: "7",
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
    connection_string:
      "mongodb://{user}:{password}@{host}:{port}/{database}?authSource=admin",
  },
  libsql: {
    kind: "libsql",
    version: "0.24.32",
    image: "ghcr.io/tursodatabase/libsql-server:v0.24.32",
    plans: {
      small: { cpu: 0.25, mem_mb: 256 },
      medium: { cpu: 0.5, mem_mb: 1024 },
      large: { cpu: 1.0, mem_mb: 4096 },
    },
    volume_path: "/var/lib/sqld",
    port: 8080,
    healthcheck:
      "curl -fsS http://127.0.0.1:8080/health >/dev/null || wget -q -O /dev/null http://127.0.0.1:8080/health",
    env: {
      SQLD_NODE: "primary",
      SQLD_HTTP_AUTH: "@generated-basic-auth",
    },
    args: [
      "/bin/sh",
      "-c",
      "sqld --db-path /var/lib/sqld/iku.db --http-listen-addr 0.0.0.0:8080 --grpc-listen-addr 0.0.0.0:5001 --admin-listen-addr 0.0.0.0:5000",
    ],
    connection_string: "http://{user}:{password}@{host}:{port}",
  },
}
