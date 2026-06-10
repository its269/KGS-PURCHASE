#!/usr/bin/env bash
# =============================================================
#  deploy.sh  — Build & launch acu-inventory with Nginx
#  Run on your Linux server:  chmod +x deploy.sh && ./deploy.sh
# =============================================================
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NGINX_CONF="/etc/nginx/sites-available/acu-inventory"
NGINX_ENABLED="/etc/nginx/sites-enabled/acu-inventory"

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║   acu-inventory  — Production Deploy         ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

# ── 1. Install dependencies ───────────────────────────────────
echo "▶  Installing dependencies…"
npm ci --omit=dev

# ── 2. Build Next.js (standalone output) ─────────────────────
echo "▶  Building Next.js…"
npm run build

# ── 3. Copy static assets next to standalone server ──────────
#    Required when output: 'standalone' is used
echo "▶  Copying static assets…"
cp -r "$APP_DIR/.next/static"  "$APP_DIR/.next/standalone/.next/static"
cp -r "$APP_DIR/public"        "$APP_DIR/.next/standalone/public"

# ── 4. Patch nginx.conf paths ─────────────────────────────────
echo "▶  Installing Nginx config…"
sed "s|/path/to/acu-inventory|$APP_DIR|g" "$APP_DIR/nginx.conf" \
    | sudo tee "$NGINX_CONF" > /dev/null

# Enable site
sudo ln -sf "$NGINX_CONF" "$NGINX_ENABLED"

# Test and reload Nginx
echo "▶  Testing Nginx config…"
sudo nginx -t
echo "▶  Reloading Nginx…"
sudo systemctl reload nginx

# ── 5. (Re)start Next.js via PM2 ─────────────────────────────
if command -v pm2 &>/dev/null; then
    echo "▶  Restarting app with PM2…"
    pm2 delete acu-inventory 2>/dev/null || true
    pm2 start "$APP_DIR/.next/standalone/server.js" \
        --name  acu-inventory \
        --env   production \
        -- -p 3000
    pm2 save
else
    echo "⚠  PM2 not found. Install it: npm i -g pm2"
    echo "   Then run: pm2 start .next/standalone/server.js --name acu-inventory -- -p 3000"
fi

echo ""
echo "✅  Deploy complete!  Your app is live at https://your-domain.com"
echo ""
