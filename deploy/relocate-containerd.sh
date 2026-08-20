#!/bin/bash
# Relocate containerd's data root off the 98G boot LV onto the 916G NVMe.
#
# Docker uses the containerd snapshotter, so image layers live in
# /var/lib/containerd rather than DockerRootDir — which is why moving Docker to
# /mnt/docker earlier left 64G behind on /.
#
# The original directory is RENAMED, never deleted, so rollback is one mv away.
set -euo pipefail

OLD=/var/lib/containerd
NEW=/mnt/docker/containerd
CONF=/etc/containerd/config.toml

echo "=== [0/7] pre-switch state ==="
docker images -q | wc -l | xargs echo "images before:"
docker ps -q | wc -l | xargs echo "running before:"
docker images -q | sort > /tmp/images-before.txt

echo "=== [1/7] stopping containers gracefully (30s grace) ==="
RUNNING=$(docker ps -q)
if [ -n "$RUNNING" ]; then
  docker stop -t 30 $RUNNING >/dev/null
fi
echo "stopped: $(echo "$RUNNING" | wc -w)"

echo "=== [2/7] stopping daemons ==="
sudo systemctl stop docker.socket docker containerd
sleep 3
systemctl is-active docker containerd || true

echo "=== [3/7] delta sync (only what changed during bulk copy) ==="
sudo rsync -aHAX --numeric-ids --delete --stats "$OLD"/ "$NEW"/ 2>&1 | grep -E "Number of .*files transferred|Total transferred file size" || true

echo "=== [4/7] configuring containerd root ==="
sudo cp "$CONF" "$CONF.bak.$(date +%s)"
sudo sed -i 's|^#root = "/var/lib/containerd"|root = "'"$NEW"'"|' "$CONF"
if ! sudo grep -q "^root = \"$NEW\"" "$CONF"; then
  echo "sed did not match; appending explicitly"
  echo "root = \"$NEW\"" | sudo tee -a "$CONF" >/dev/null
fi
sudo grep -n "^root" "$CONF"

echo "=== [5/7] moving old directory aside (NOT deleted) ==="
sudo mv "$OLD" "${OLD}.old"
echo "old data preserved at ${OLD}.old"

echo "=== [6/7] starting daemons ==="
sudo systemctl start containerd
sleep 5
sudo systemctl start docker
sleep 10
systemctl is-active containerd docker

echo "=== [7/7] verification ==="
echo "containerd root in use:"
docker info 2>/dev/null | grep -i "docker root dir" || true
docker images -q | sort > /tmp/images-after.txt
echo "images after: $(wc -l < /tmp/images-after.txt) (before: $(wc -l < /tmp/images-before.txt))"
if diff -q /tmp/images-before.txt /tmp/images-after.txt >/dev/null; then
  echo "IMAGE SET IDENTICAL"
else
  echo "WARNING: image set differs"
  diff /tmp/images-before.txt /tmp/images-after.txt | head -10
fi
echo "running now: $(docker ps -q | wc -l)"
