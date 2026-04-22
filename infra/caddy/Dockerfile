# Caddy custom build with DNS-01 provider modules (xcaddy).
# Required for wildcard TLS certificates via DNS challenge.
# To rebuild after changing modules: make infra-down && make infra-up
#
# Pinned to Caddy 2.10 to pull Go 1.25+ (required by caddy-dns/route53 >= v1.6).
FROM caddy:2.10-builder AS builder

RUN xcaddy build \
  --with github.com/mholt/caddy-ratelimit \
  --with github.com/caddy-dns/cloudflare \
  --with github.com/caddy-dns/route53 \
  --with github.com/caddy-dns/ovh \
  --with github.com/caddy-dns/digitalocean

FROM caddy:2.10-alpine
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
