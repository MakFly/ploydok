.PHONY: help dev dev-agent db-migrate infra-up infra-down infra-logs build start test lint typecheck clean secrets-init

# Ports locaux :
#   API 3335 — Web 5173 — Caddy 8180/8543/2020 — Agent unix /tmp/ploydok-agent.sock

help:
	@echo "Usage: make <target>"
	@echo ""
	@echo "  dev          - Lance web + api via turbo (http://localhost:5173 + :3335)"
	@echo "  dev-agent    - Lance l'agent Rust (unix socket, insecure)"
	@echo "  db-migrate   - Applique les migrations Postgres"
	@echo "  secrets-init - Génère PLOYDOK_PG_PASSWORD + PLOYDOK_REDIS_PASSWORD dans .env.local"
	@echo "  infra-up     - docker compose up (postgres + redis + caddy + buildkitd + registry)"
	@echo "  infra-down   - cleanup infra"
	@echo "  infra-logs   - tail logs Caddy"
	@echo "  build/start/test/lint/typecheck/clean - délégués à turbo"

dev:
	bunx turbo dev

dev-agent:
	@echo "Starting ploydok-agent (insecure, /tmp/ploydok-agent.sock)..."
	cd agent && PLOYDOK_AGENT_INSECURE=1 PLOYDOK_AGENT_SOCKET=/tmp/ploydok-agent.sock PLOYDOK_VALIDATOR_CONFIG=$(CURDIR)/agent/config/dev-validator.toml cargo run --release -p ploydok-agent

db-migrate:
	set -a; . apps/api/.env.local; set +a; bun run --cwd packages/db migrate

secrets-init:
	@ENV_FILE=apps/api/.env.local; \
	touch "$$ENV_FILE"; \
	if ! grep -q 'PLOYDOK_PG_PASSWORD' "$$ENV_FILE" 2>/dev/null; then \
	  PG_PASS=$$(openssl rand -hex 32); \
	  echo "PLOYDOK_PG_PASSWORD=$$PG_PASS" >> "$$ENV_FILE"; \
	  echo "[secrets-init] PLOYDOK_PG_PASSWORD generated"; \
	else \
	  echo "[secrets-init] PLOYDOK_PG_PASSWORD already present — skipped"; \
	fi; \
	if ! grep -q 'PLOYDOK_REDIS_PASSWORD' "$$ENV_FILE" 2>/dev/null; then \
	  REDIS_PASS=$$(openssl rand -hex 32); \
	  echo "PLOYDOK_REDIS_PASSWORD=$$REDIS_PASS" >> "$$ENV_FILE"; \
	  echo "[secrets-init] PLOYDOK_REDIS_PASSWORD generated"; \
	else \
	  echo "[secrets-init] PLOYDOK_REDIS_PASSWORD already present — skipped"; \
	fi; \
	if ! grep -q 'DATABASE_URL' "$$ENV_FILE" 2>/dev/null; then \
	  PG_PASS=$$(grep 'PLOYDOK_PG_PASSWORD' "$$ENV_FILE" | cut -d= -f2); \
	  echo "DATABASE_URL=postgres://ploydok:$$PG_PASS@127.0.0.1:5434/ploydok" >> "$$ENV_FILE"; \
	  echo "[secrets-init] DATABASE_URL generated"; \
	else \
	  echo "[secrets-init] DATABASE_URL already present — skipped"; \
	fi; \
	if ! grep -q 'REDIS_URL' "$$ENV_FILE" 2>/dev/null; then \
	  REDIS_PASS=$$(grep 'PLOYDOK_REDIS_PASSWORD' "$$ENV_FILE" | cut -d= -f2); \
	  echo "REDIS_URL=redis://:$$REDIS_PASS@127.0.0.1:6381/0" >> "$$ENV_FILE"; \
	  echo "[secrets-init] REDIS_URL generated"; \
	else \
	  echo "[secrets-init] REDIS_URL already present — skipped"; \
	fi

infra-up: secrets-init
	@docker network create ploydok-public 2>/dev/null || true
	@docker network create ploydok-ingress 2>/dev/null || true
	docker compose --env-file apps/api/.env.local -f infra/docker-compose.yml up -d
	@echo "Caddy admin   : http://127.0.0.1:2020/config/"
	@echo "Registry v2   : http://127.0.0.1:5000/v2/"
	@echo "BuildKit host : docker-container://ploydok-buildkitd"
	@echo "Postgres      : postgresql://ploydok:***@127.0.0.1:5434/ploydok"
	@echo "Redis         : redis://:***@127.0.0.1:6381/0"

infra-down:
	-docker compose --env-file apps/api/.env.local -f infra/docker-compose.yml down --timeout 10
	-docker network rm ploydok-public 2>/dev/null
	-docker network rm ploydok-ingress 2>/dev/null

infra-logs:
	docker compose --env-file apps/api/.env.local -f infra/docker-compose.yml logs -f caddy

build:
	bunx turbo build

start:
	cd apps/api && bun run start

test:
	bunx turbo test

lint:
	bunx turbo lint

typecheck:
	bunx turbo typecheck

clean:
	bunx turbo clean || true
	rm -rf apps/web/.vite apps/web/dist apps/api/dist .turbo */.turbo **/*/.turbo 2>/dev/null || true
