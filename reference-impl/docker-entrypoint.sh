#!/bin/bash
set -e

USERNAME="${WS_USER:-developer}"

# Create user if doesn't exist
if ! id "$USERNAME" &>/dev/null; then
  useradd -m -s /bin/bash "$USERNAME" 2>/dev/null || useradd -m -o -u 1001 -s /bin/bash "$USERNAME"
  echo "$USERNAME ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers
fi

# Ensure home dir exists (but .claude is mounted as volume)
mkdir -p /home/$USERNAME/.claude
chown -R $USERNAME:$USERNAME /home/$USERNAME

# If credentials exist in mounted volume, load token into env
if [ -f "/home/$USERNAME/.claude/.credentials.json" ]; then
  echo "[entrypoint] Found persisted credentials"
fi

# Ensure workspace dir is owned by user
chown -R $USERNAME:$USERNAME /workspace 2>/dev/null || true

# Set workspace dir to user's home if not overridden
export HOME="/home/$USERNAME"
export WORKSPACE_DIR="${WORKSPACE_DIR:-/home/$USERNAME/workspace}"
mkdir -p "$WORKSPACE_DIR"
chown -R $USERNAME:$USERNAME "$WORKSPACE_DIR"

# Init git in workspace if needed
if [ ! -d "$WORKSPACE_DIR/.git" ]; then
  su - $USERNAME -c "cd $WORKSPACE_DIR && git init && git config user.name '$USERNAME' && git config user.email '$USERNAME@workspace'"
fi

# Copy AGENTS.md if workspace is empty
if [ ! -f "$WORKSPACE_DIR/AGENTS.md" ] && [ -f /app/AGENTS.md ]; then
  cp /app/AGENTS.md "$WORKSPACE_DIR/AGENTS.md"
  chown $USERNAME:$USERNAME "$WORKSPACE_DIR/AGENTS.md"
fi

# Run wmlet as the user
exec su - $USERNAME -c "cd /app && HOME=/home/$USERNAME WORKSPACE_DIR=$WORKSPACE_DIR WMLET_PORT=${WMLET_PORT:-31337} WORKSPACE_NAME=${WORKSPACE_NAME} MANAGER_URL=${MANAGER_URL} PATH=$PATH bun run wmlet.ts"
