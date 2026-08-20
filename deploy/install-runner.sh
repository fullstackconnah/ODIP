#!/bin/bash
# One-time setup: install a GitHub Actions self-hosted runner on the homelab box
# so deploys can reach the LAN-only stack at /mnt/docker/stacks/odip.
#
# Usage (on 192.168.4.70, as connah):
#   ./install-runner.sh <REGISTRATION_TOKEN>
#
# Get the token from:
#   https://github.com/fullstackconnah/ODIP/settings/actions/runners/new
# It is short-lived (about an hour) and is NOT a personal access token.
#
# Safe for this repo because ODIP is PRIVATE. Never run a self-hosted runner on
# a public repo — fork pull requests would execute arbitrary code on this host.
set -euo pipefail

TOKEN="${1:-}"
if [ -z "$TOKEN" ]; then
  echo "usage: $0 <REGISTRATION_TOKEN>" >&2
  exit 1
fi

REPO_URL="https://github.com/fullstackconnah/ODIP"
RUNNER_DIR="$HOME/actions-runner"
RUNNER_VERSION="2.336.0"

# rsync is used by the deploy workflow to sync source into the stack directory.
if ! command -v rsync >/dev/null 2>&1; then
  echo "==> Installing rsync"
  sudo apt-get update -qq && sudo apt-get install -y rsync
fi

mkdir -p "$RUNNER_DIR"
cd "$RUNNER_DIR"

if [ ! -f ./config.sh ]; then
  echo "==> Downloading runner v${RUNNER_VERSION}"
  curl -fsSL -o actions-runner.tar.gz \
    "https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz"
  tar xzf actions-runner.tar.gz
  rm -f actions-runner.tar.gz
fi

echo "==> Configuring runner"
./config.sh \
  --url "$REPO_URL" \
  --token "$TOKEN" \
  --name "homelab-odip" \
  --labels "self-hosted,linux,x64,odip" \
  --work "_work" \
  --unattended \
  --replace

echo "==> Installing as a systemd service"
sudo ./svc.sh install "$USER"
sudo ./svc.sh start

echo
echo "==> Status"
sudo ./svc.sh status || true

echo
echo "Runner installed. It must be able to run docker without sudo:"
id -nG "$USER" | tr ' ' '\n' | grep -qx docker \
  && echo "  OK — $USER is in the docker group" \
  || echo "  WARNING — $USER is NOT in the docker group; run: sudo usermod -aG docker $USER"
