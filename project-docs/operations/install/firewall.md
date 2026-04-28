# Firewall

L’installeur ne modifie pas le firewall sauf si `--manage-firewall` est fourni.

## Takeover

Ports publics attendus :

```bash
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw deny 2019
ufw deny 5000
```

`2019` est l’admin API Caddy et doit rester local. `5000` est le registry interne.

## Coexist

Le proxy frontal reste exposé publiquement. Ploydok écoute en loopback :

```bash
ufw allow 22/tcp
ufw deny 2019
ufw deny 5000
```

Si le port coexist doit être joint depuis un autre reverse proxy local :

```bash
ufw allow from 127.0.0.1 to any port 8080 proto tcp
```

## firewalld

```bash
firewall-cmd --permanent --add-service=http
firewall-cmd --permanent --add-service=https
firewall-cmd --permanent --remove-port=2019/tcp
firewall-cmd --permanent --remove-port=5000/tcp
firewall-cmd --reload
```

Adaptez les règles si vous utilisez `coexist` derrière un proxy frontal.
