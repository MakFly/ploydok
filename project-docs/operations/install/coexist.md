# Mode coexist

Le mode `coexist` est recommandé quand nginx ou apache2 sert déjà des vhosts de production.

```bash
sudo installer/install.sh --mode=coexist --http-port=8080 --https-port=8443 --yes
```

Dans ce mode :

- Caddy Ploydok écoute sur `127.0.0.1:<http-port>` et `127.0.0.1:<https-port>`.
- Le proxy frontal existant conserve TLS et les ports publics.
- L’installeur génère des snippets de départ :
  - `/etc/nginx/snippets/ploydok.conf`
  - `/etc/apache2/conf-available/ploydok.conf`

## Nginx

Inclure le snippet dans un serveur TLS existant :

```nginx
server {
  listen 443 ssl http2;
  server_name ploydok.example.com *.apps.example.com;

  ssl_certificate /etc/letsencrypt/live/example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/example.com/privkey.pem;

  include /etc/nginx/snippets/ploydok.conf;
}
```

Tester avant reload :

```bash
sudo nginx -t
sudo systemctl reload nginx
```

## Apache

Activer les modules requis :

```bash
sudo a2enmod proxy proxy_http proxy_wstunnel headers
sudo a2enconf ploydok
sudo apache2ctl configtest
sudo systemctl reload apache2
```

Le snippet généré est volontairement minimal : il sert de base vérifiable, pas de migration automatique de vhosts complexes.
