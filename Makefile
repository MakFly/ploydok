.PHONY: help dev dev-web dev-api build build-web build-api start test lint typecheck clean

help:
	@echo "Usage: make <target>"
	@echo ""
	@echo "Targets:"
	@echo "  dev          - Run all apps in dev mode"
	@echo "  dev-web      - Run web app (port 3000)"
	@echo "  dev-api      - Run api server"
	@echo "  build        - Build all apps"
	@echo "  build-web    - Build web app"
	@echo "  start        - Start production API"
	@echo "  test         - Run tests"
	@echo "  lint         - Run lint"
	@echo "  typecheck    - Run typecheck"
	@echo "  clean        - Clean build artifacts"

dev: dev-web dev-api

dev-web:
	@echo "Starting web..."
	cd apps/web && bun run dev

dev-api:
	@echo "Starting api..."
	cd apps/api && bun run dev

build: build-web

build-web:
	cd apps/web && bun run build

start:
	cd apps/api && bun run start

test:
	cd apps/web && bun run test
	cd apps/api && bun run test

lint:
	cd apps/web && bun run lint

typecheck:
	cd apps/web && bun run typecheck
	cd apps/api && bun run typecheck

clean:
	rm -rf apps/web/.vite
	rm -rf apps/web/dist
	rm -rf apps/api/dist