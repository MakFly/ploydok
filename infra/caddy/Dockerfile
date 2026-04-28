# Caddy custom build with DNS-01 provider modules (xcaddy).
# Required for wildcard TLS certificates via DNS challenge.
# To rebuild after changing modules: make infra-down && make infra-up
#
# Pinned to Caddy 2.11 because caddy-l4 v0.1.x requires Caddy >= 2.11.1.
FROM caddy:2.11-builder AS builder

RUN xcaddy build \
  --with github.com/mholt/caddy-l4 \
  --with github.com/mholt/caddy-ratelimit \
  --with github.com/caddyserver/cache-handler \
  --with github.com/ueffel/caddy-brotli \
  --with github.com/ueffel/caddy-imagefilter/resize \
  --with github.com/caddy-dns/cloudflare \
  --with github.com/caddy-dns/route53 \
  --with github.com/caddy-dns/ovh \
  --with github.com/caddy-dns/digitalocean

FROM caddy:2.11-alpine
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
