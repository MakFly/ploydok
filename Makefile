.PHONY: help install dev dev-agent agent-restart agent-logs db-migrate db-reset db-seed infra-up infra-down infra-stop infra-logs build start test lint typecheck clean secrets-init dod

# Ports locaux :
#   API 3335 — Web 5173 — Caddy 8180/8543/2020 — Agent unix /tmp/ploydok/agent.sock

# Couleurs ANSI (désactivées si stdout n'est pas un TTY)
ifneq (,$(findstring xterm,$(TERM))$(MAKE_TERMOUT))
  C_RESET  := \033[0m
  C_TITLE  := \033[1;37m
  C_CAT    := \033[1;35m
  C_TARGET := \033[1;36m
  C_DESC   := \033[0;37m
  C_DIM    := \033[2;37m
endif

help:
	@printf "$(C_TITLE)Usage: make <target>$(C_RESET)\n\n"
	@printf "$(C_CAT)▶ Setup$(C_RESET)\n"
	@printf "  $(C_TARGET)%-14s$(C_RESET) $(C_DESC)%s$(C_RESET)\n" "install" "Setup complet : bun install + secrets + infra + migrations"
	@printf "\n$(C_CAT)▶ Dev$(C_RESET)\n"
	@printf "  $(C_TARGET)%-14s$(C_RESET) $(C_DESC)%s$(C_RESET)\n" "dev"       "Lance web + api via turbo (http://localhost:5173 + :3335)"
	@printf "  $(C_TARGET)%-14s$(C_RESET) $(C_DESC)%s$(C_RESET)\n" "dev-agent" "[debug] Lance l'agent Rust en natif (insecure, /tmp/ploydok/agent.sock)"
	@printf "  %-14s $(C_DIM)%s$(C_RESET)\n" "" "⚠ stop le container 'agent' d'abord — collision sur le socket"
	@printf "\n$(C_CAT)▶ Agent$(C_RESET)\n"
	@printf "  $(C_TARGET)%-14s$(C_RESET) $(C_DESC)%s$(C_RESET)\n" "agent-restart" "Redémarre le container 'ploydok-agent' (utile après modif Rust)"
	@printf "  $(C_TARGET)%-14s$(C_RESET) $(C_DESC)%s$(C_RESET)\n" "agent-logs"    "Tail logs du container 'ploydok-agent'"
	@printf "\n$(C_CAT)▶ Database$(C_RESET)\n"
	@printf "  $(C_TARGET)%-14s$(C_RESET) $(C_DESC)%s$(C_RESET)\n" "db-migrate" "Applique les migrations Postgres"
	@printf "  $(C_TARGET)%-14s$(C_RESET) $(C_DESC)%s$(C_RESET)\n" "db-reset"   "Wipe runtime app/db containers + Postgres + Redis + apply migrations"
	@printf "  $(C_TARGET)%-14s$(C_RESET) $(C_DESC)%s$(C_RESET)\n" "db-seed"    "Seed dev (user dev@ploydok.local + backup code DEVD-EVDE-VDEV)"
	@printf "\n$(C_CAT)▶ Infra$(C_RESET)\n"
	@printf "  $(C_TARGET)%-14s$(C_RESET) $(C_DESC)%s$(C_RESET)\n" "secrets-init" "Génère PLOYDOK_PG_PASSWORD + PLOYDOK_REDIS_PASSWORD dans .env.local"
	@printf "  $(C_TARGET)%-14s$(C_RESET) $(C_DESC)%s$(C_RESET)\n" "infra-up"     "docker compose up (postgres + redis + caddy + buildkitd + registry + agent)"
	@printf "  $(C_TARGET)%-14s$(C_RESET) $(C_DESC)%s$(C_RESET)\n" "infra-down"   "cleanup infra (stop + rm containers + networks)"
	@printf "  $(C_TARGET)%-14s$(C_RESET) $(C_DESC)%s$(C_RESET)\n" "infra-stop"   "stop infra containers (sans les supprimer)"
	@printf "  $(C_TARGET)%-14s$(C_RESET) $(C_DESC)%s$(C_RESET)\n" "infra-logs"   "tail logs Caddy"
	@printf "\n$(C_CAT)▶ Quality & Build$(C_RESET)\n"
	@printf "  $(C_TARGET)%-14s$(C_RESET) $(C_DESC)%s$(C_RESET)\n" "dod" "Lance les 11 specs Playwright DoD Sprint 3 (requiert infra + dev up)"
	@printf "  $(C_TARGET)%-14s$(C_RESET) $(C_DESC)%s$(C_RESET)\n" "build/start/test/lint/typecheck/clean" "délégués à turbo"

install:
	@echo "[install] installing workspace dependencies..."
	bun install
	@echo "[install] bringing up local infra (postgres + redis + caddy + buildkitd + registry + agent)..."
	$(MAKE) infra-up
	@echo "[install] waiting for postgres to accept connections..."
	@for i in $$(seq 1 30); do \
	  if docker compose --env-file apps/api/.env.local -f infra/docker-compose.yml exec -T postgres pg_isready -U ploydok >/dev/null 2>&1; then \
	    echo "[install] postgres ready"; break; \
	  fi; \
	  if [ "$$i" = "30" ]; then echo "[install] postgres not ready after 30s — aborting" >&2; exit 1; fi; \
	  sleep 1; \
	done
	@echo "[install] applying database migrations..."
	$(MAKE) db-migrate
	@echo "[install] done — next: 'make dev' (web:5173 + api:3335)"

dev:
	bunx turbo dev

dev-agent:
	@echo "Starting ploydok-agent in native mode (insecure, /tmp/ploydok/agent.sock)..."
	@echo "⚠  Stop the compose 'agent' service first: docker compose -f infra/docker-compose.yml stop agent"
	mkdir -p /tmp/ploydok
	cd agent && PLOYDOK_AGENT_INSECURE=1 PLOYDOK_AGENT_SOCKET=/tmp/ploydok/agent.sock PLOYDOK_VALIDATOR_CONFIG=$(CURDIR)/agent/config/dev-validator.toml cargo run --release -p ploydok-agent

agent-restart:
	docker compose --env-file apps/api/.env.local -f infra/docker-compose.yml restart agent
	@echo "agent restarted — tail with: make agent-logs"

agent-logs:
	docker compose --env-file apps/api/.env.local -f infra/docker-compose.yml logs -f agent

db-migrate:
	set -a; . apps/api/.env.local; set +a; bun run --cwd packages/db migrate

db-reset:
	@echo "[db-reset] removing runtime app/database containers..."
	@containers=$$({ docker ps -aq --filter 'name=^/ploydok-app-'; docker ps -aq --filter 'name=^/ploydok-db-'; } | sort -u); \
	if [ -n "$$containers" ]; then \
	  docker rm -f $$containers >/dev/null; \
	  echo "[db-reset] removed runtime containers: $$containers"; \
	else \
	  echo "[db-reset] no runtime containers to remove"; \
	fi
	@echo "[db-reset] dropping public + drizzle schemas..."
	@docker compose --env-file apps/api/.env.local -f infra/docker-compose.yml exec -T postgres psql -U ploydok -d ploydok -v ON_ERROR_STOP=1 --quiet -c 'SET client_min_messages = warning; DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO ploydok; GRANT ALL ON SCHEMA public TO public;' >/dev/null
	@echo "[db-reset] flushing redis..."
	@set -a; . apps/api/.env.local; set +a; docker compose --env-file apps/api/.env.local -f infra/docker-compose.yml exec -T redis redis-cli --no-auth-warning -a "$$PLOYDOK_REDIS_PASSWORD" FLUSHDB >/dev/null
	@echo "[db-reset] applying migrations..."
	@set -a; . apps/api/.env.local; set +a; bun run --cwd packages/db migrate
	@echo "[db-reset] done — instance is back to a fresh-install state (no users, no projects)"
	@echo "                next: restart 'make dev' so the API prints the /setup token in its logs"

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

infra-stop:
	docker compose --env-file apps/api/.env.local -f infra/docker-compose.yml stop --timeout 15

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

# Exécute les 11 specs Playwright DoD Sprint 3 contre l'infra réelle.
# Écrit un rapport local gitignoré sous .ai/reports/.
dod:
	@echo "┌─ Pré-requis avant make dod ────────────────────────────────────┐"
	@echo "│ 1. make infra-up       → postgres/redis/caddy/buildkit/registry/agent │"
	@echo "│ 2. make dev            → dans un autre shell (web + api)       │"
	@echo "│ 3. make db-seed        → 1× (dev@ploydok.local + backup code)  │"
	@echo "│ 4. GitHub App installée sur le compte de test                  │"
	@echo "│    (via /settings/github dans l'UI web)                        │"
	@echo "└────────────────────────────────────────────────────────────────┘"
	@echo ""
	@echo "Durée : ~5-15 min selon vitesse BuildKit + réseau GitHub."
	@echo "Logs détaillés : test-results/dod-*/"
	@echo ""
	PLOYDOK_E2E_REAL=1 bun scripts/run-dod.ts

# Seed dev DB : user dev@ploydok.local + project + backup code fixe (DEVD-EVDE-VDEV).
# Utilisé par `make dod` pour skipper l'export des creds.
db-seed:
	bun run --cwd packages/db seed
