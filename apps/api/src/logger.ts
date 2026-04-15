// SPDX-License-Identifier: AGPL-3.0-only
import pino, { type Logger, type LoggerOptions } from "pino";
import { env } from "./env";

const isProd = env.NODE_ENV === "prod";
const isTest = env.NODE_ENV === "test";

const level = Bun.env["LOG_LEVEL"] ?? (isTest ? "silent" : isProd ? "info" : "debug");

const options: LoggerOptions = {
  level,
  base: { env: env.NODE_ENV },
  // epochTime permet à pino-pretty de formater via `translateTime`.
  timestamp: pino.stdTimeFunctions.epochTime,
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "req.headers['x-csrf-token']",
      "password",
      "*.password",
      "token",
      "*.token",
      "secret",
      "*.secret",
    ],
    censor: "[REDACTED]",
  },
};

// Pretty output in dev — JSON lines in prod (ingestable by Loki/Datadog/etc.).
export const logger: Logger = isProd
  ? pino(options)
  : pino({
      ...options,
      transport: {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "HH:MM:ss.l",
          // Monolog-like : [time] channel.LEVEL: msg {context}
          messageFormat: "{name}: {msg}",
          ignore: "pid,hostname,env,name",
          singleLine: true,
        },
      },
    });

export function childLogger(name: string, bindings: Record<string, unknown> = {}): Logger {
  return logger.child({ name, ...bindings });
}
