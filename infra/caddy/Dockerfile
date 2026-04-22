# Caddy custom build with DNS-01 provider modules (xcaddy).
# Required for wildcard TLS certificates via DNS challenge.
# To rebuild after changing modules: make infra-down && make infra-up
FROM caddy:2.8-builder AS builder

RUN xcaddy build \
  --with github.com/mholt/caddy-ratelimit \
  --with github.com/caddy-dns/cloudflare \
  --with github.com/caddy-dns/route53 \
  --with github.com/caddy-dns/ovh \
  --with github.com/caddy-dns/digitalocean

FROM caddy:2.8-alpine
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
