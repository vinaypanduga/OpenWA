# EC2 deployment at the temporary public DNS `/openwa` path

The current public URL is:

```text
http://ec2-3-104-117-96.ap-southeast-2.compute.amazonaws.com:8026/openwa/
```

This folder adds OpenWA below the existing website without taking over `/`, `/api`, `/assets`, or
the site's root Socket.IO endpoint. Nginx removes `/openwa` before requests reach the unchanged
NestJS backend; the dashboard image is built with `/openwa` as its public path.

## Prerequisites

- Docker Engine with the Compose plugin
- Nginx installed on the EC2 instance
- inbound custom TCP (`8026`) allowed by the EC2 security group for the temporary URL
- port `2785` kept private; the production Compose file publishes it only on `127.0.0.1`

## 1. Configure OpenWA

From the repository root on EC2:

```bash
cp .env.example .env
```

Copy the settings from `deploy/ec2/openwa.env.example` into `.env` and replace every placeholder
secret. Generate the two random secrets independently:

```bash
openssl rand -hex 32
openssl rand -hex 32
```

Do not commit `.env`.

## 2. Build and start

The override passes `DASHBOARD_BASE_PATH=/openwa` into Vite. A normal runtime restart is not enough
after changing this value; rebuild the image.

```bash
docker compose -f docker-compose.yml -f deploy/ec2/docker-compose.ec2.yml build openwa-api
docker compose -f docker-compose.yml -f deploy/ec2/docker-compose.ec2.yml up -d
docker compose -f docker-compose.yml -f deploy/ec2/docker-compose.ec2.yml ps
curl --fail http://127.0.0.1:2785/api/health/ready
```

The persistent named volume is `openwa_openwa-data`. Do not remove it during upgrades: it contains
the SQLite database, generated key material, and Baileys linked-device credentials.

## 3. Add the separate Nginx listener

Install the supplied server file. It listens on `8026`; the existing site's ports `80/443` are not
changed.

```bash
sudo cp deploy/ec2/nginx-openwa-path.conf /etc/nginx/conf.d/openwa-8026.conf
```

On Debian/Ubuntu installations that do not include `/etc/nginx/conf.d/*.conf`, use:

```bash
sudo cp deploy/ec2/nginx-openwa-path.conf /etc/nginx/sites-available/openwa-8026
sudo ln -s /etc/nginx/sites-available/openwa-8026 /etc/nginx/sites-enabled/openwa-8026
```

Validate and reload:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

Open the following URL. The trailing slash is canonical; `/openwa` redirects to it.

```text
http://ec2-3-104-117-96.ap-southeast-2.compute.amazonaws.com:8026/openwa/
```

This is temporary HTTP access. The environment template disables CSP's automatic HTTPS upgrade so
the dashboard can load. When a real domain is ready, enable HTTPS and remove
`CSP_UPGRADE_INSECURE_REQUESTS=false`.

## 4. Trust only the Docker proxy hop

After the first start, find the application network subnet:

```bash
docker network inspect openwa-network --format '{{(index .IPAM.Config 0).Subnet}}'
```

Put that exact value in the root `.env` as `TRUSTED_PROXIES`, then apply it:

```bash
docker compose -f docker-compose.yml -f deploy/ec2/docker-compose.ec2.yml up -d
```

## Upgrade

```bash
git pull --ff-only
docker compose -f docker-compose.yml -f deploy/ec2/docker-compose.ec2.yml build openwa-api
docker compose -f docker-compose.yml -f deploy/ec2/docker-compose.ec2.yml up -d
curl --fail http://127.0.0.1:2785/api/health/ready
```

Back up the EC2 EBS volume regularly. A container rebuild preserves the named volume, but losing the
underlying disk loses the WhatsApp credentials and requires pairing again.
