#!/usr/bin/env bash
# Deploy services/tg-userbot/ → Oracle VM 134.98.128.78
# Usage: SSH_KEY=/path/to/key bash deploy.sh
#
# Использует tar+ssh pipe (вместо rsync) для совместимости с Git Bash Windows.

set -euo pipefail

SSH_HOST="${SSH_HOST:-ubuntu@134.98.128.78}"
SSH_KEY="${SSH_KEY:-/tmp/oracle.key}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ ! -f "$SSH_KEY" ]]; then
  echo "ERROR: SSH key not found at $SSH_KEY" >&2
  echo "Usage: SSH_KEY=/path/to/key bash deploy.sh" >&2
  exit 1
fi

SSH_CMD="ssh -i $SSH_KEY -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null"

echo "===> [1/4] tar+ssh upload to VM"
cd "$SCRIPT_DIR"
tar -czf - \
  --exclude='.venv' --exclude='venv' \
  --exclude='__pycache__' --exclude='*.pyc' \
  --exclude='.env' --exclude='.env.*' \
  --exclude='.pytest_cache' --exclude='.ruff_cache' \
  . | $SSH_CMD "$SSH_HOST" "sudo rm -rf /tmp/tg-userbot-deploy && sudo mkdir -p /tmp/tg-userbot-deploy && sudo tar -xzf - -C /tmp/tg-userbot-deploy"

echo "===> [2/4] sync to /opt/tg-userbot/ + chown"
$SSH_CMD "$SSH_HOST" \
  "sudo cp -r /tmp/tg-userbot-deploy/app /opt/tg-userbot/ \
   && sudo cp /tmp/tg-userbot-deploy/requirements.txt /opt/tg-userbot/ \
   && sudo cp -r /tmp/tg-userbot-deploy/systemd /opt/tg-userbot/ \
   && sudo cp /tmp/tg-userbot-deploy/README.md /opt/tg-userbot/ 2>/dev/null || true \
   && sudo chown -R tg-userbot:tg-userbot /opt/tg-userbot/app /opt/tg-userbot/requirements.txt /opt/tg-userbot/systemd /opt/tg-userbot/README.md \
   && sudo rm -rf /tmp/tg-userbot-deploy"

echo "===> [3/4] venv + pip install"
$SSH_CMD "$SSH_HOST" \
  "sudo -u tg-userbot bash -c 'cd /opt/tg-userbot \
    && (test -d venv || python3 -m venv venv) \
    && venv/bin/pip install --quiet --upgrade pip \
    && venv/bin/pip install --quiet -r requirements.txt' 2>&1 | tail -3"

echo "===> [4/4] systemd reload + restart"
$SSH_CMD "$SSH_HOST" \
  "sudo cp /opt/tg-userbot/systemd/tg-userbot.service /etc/systemd/system/ \
   && sudo systemctl daemon-reload \
   && sudo systemctl enable tg-userbot 2>&1 | tail -1 \
   && sudo systemctl restart tg-userbot \
   && sleep 3 \
   && sudo systemctl status tg-userbot --no-pager -l | head -25"

echo ""
echo "===> Done. Test:"
echo "      curl https://userbot.finkley.app/health"
