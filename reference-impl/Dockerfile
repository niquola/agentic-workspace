FROM oven/bun:1
WORKDIR /app

# Install Node.js, git, sudo, and Claude Code
RUN apt-get update && \
    apt-get install -y curl git sudo && \
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get install -y nodejs && \
    npm install -g @anthropic-ai/claude-code && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Install dependencies (includes @zed-industries/claude-agent-acp + ACP SDK)
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Verify
RUN node --version && bun --version && git --version && \
    claude --version && \
    ls node_modules/.bin/claude-agent-acp

# Copy wmlet runtime sources
COPY wmlet.ts auth.ts protocol.ts tsconfig.json ./
COPY ui/ ./ui/

# Default AGENTS.md for workspaces
COPY AGENTS.md /app/AGENTS.md

# Entrypoint creates user dynamically
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

# Workspace volume
RUN mkdir -p /workspace
VOLUME /workspace

ENV WMLET_PORT=31337
EXPOSE 31337

ENTRYPOINT ["/app/docker-entrypoint.sh"]
