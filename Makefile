.PHONY: help dev dev-agent db-migrate infra-up infra-down infra-logs build start test lint typecheck clean

# Ports locaux :
#   API 4000 — Web 5173 — Caddy 8180/8543/2020 — Agent unix /tmp/ploydok-agent.sock

help:
	@echo "Usage: make <target>"
	@echo ""
	@echo "  dev          - Lance web + api via turbo (http://localhost:5173 + :4000)"
	@echo "  dev-agent    - Lance l'agent Rust (unix socket, insecure)"
	@echo "  db-migrate   - Applique les migrations SQLite (ploydok.db à la racine)"
	@echo "  infra-up     - docker compose up Caddy + network ploydok-public"
	@echo "  infra-down   - cleanup infra"
	@echo "  infra-logs   - tail logs Caddy"
	@echo "  build/start/test/lint/typecheck/clean - délégués à turbo"

dev:
	bunx turbo dev

dev-agent:
	@echo "Starting ploydok-agent (insecure, /tmp/ploydok-agent.sock)..."
	cd agent && PLOYDOK_AGENT_INSECURE=1 PLOYDOK_AGENT_SOCKET=/tmp/ploydok-agent.sock cargo run --release -p ploydok-agent

db-migrate:
	bun run --cwd packages/db migrate

infra-up:
	@docker network create ploydok-public 2>/dev/null || true
	docker compose -f infra/docker-compose.yml up -d caddy
	@echo "Caddy admin : http://127.0.0.1:2020/config/"

infra-down:
	-docker compose -f infra/docker-compose.yml down --timeout 10
	-docker network rm ploydok-public 2>/dev/null

infra-logs:
	docker compose -f infra/docker-compose.yml logs -f caddy

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