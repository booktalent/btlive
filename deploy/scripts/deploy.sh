#!/usr/bin/env bash
# BookTalent — one-shot deploy script
# Usage:  sudo ./deploy.sh
# --------------------------------------------------------------------
# Pulls latest code, installs deps, rebuilds frontend, restarts backend.
# Idempotent — safe to re-run on every push.
# --------------------------------------------------------------------
set -euo pipefail

APP_DIR="/opt/booktalent"
APP_USER="booktalent"

echo "▶ Pulling latest from git…"
cd "$APP_DIR"
sudo -u "$APP_USER" git pull --rebase

echo "▶ Backend — installing Python deps…"
cd "$APP_DIR/backend"
sudo -u "$APP_USER" ./.venv/bin/pip install --upgrade -r requirements.txt
# Emergent integrations lives on a private index
sudo -u "$APP_USER" ./.venv/bin/pip install --upgrade \
    emergentintegrations \
    --extra-index-url https://d33sy5i8bnduwe.cloudfront.net/simple/

echo "▶ Frontend — installing + building React bundle…"
cd "$APP_DIR/frontend"
sudo -u "$APP_USER" yarn install --frozen-lockfile
sudo -u "$APP_USER" yarn build

echo "▶ Restarting backend (systemd)…"
sudo systemctl restart booktalent-backend
sleep 2
sudo systemctl status booktalent-backend --no-pager

echo "▶ Reloading Nginx…"
sudo nginx -t && sudo systemctl reload nginx

echo "✓ Deploy complete."
echo "  Backend:  https://$(hostname -f)/api/healthz"
echo "  Frontend: https://$(hostname -f)/"
