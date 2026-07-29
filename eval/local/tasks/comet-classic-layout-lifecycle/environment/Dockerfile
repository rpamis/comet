FROM node:22-bookworm-slim

WORKDIR /workspace

# Runtime tools for current Classic plus frozen 0.3.9/0.4.0 treatments.
RUN apt-get update && apt-get install -y --no-install-recommends \
    bash git curl jq ca-certificates \
    python3 python3-pip python-is-python3 && \
    rm -rf /var/lib/apt/lists/*

RUN pip install --break-system-packages --no-cache-dir pyyaml

# Match Comet's supported OpenSpec floor. The current-checkout CLI and its
# dependencies remain separate so the benchmark does not depend on a published
# Comet package.
RUN npm install -g @fission-ai/openspec@1.5.0

COPY current-comet-package.json /opt/comet-cli/package.json
RUN npm install --prefix /opt/comet-cli --omit=dev --ignore-scripts

# Claude Code CLI (the agent runtime; version overridable via BENCH_CC_VERSION).
ARG CLAUDE_CODE_VERSION=latest
RUN npm install -g @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}

# Existing wordcount code (extended during the task).
COPY wordcount.py /workspace/wordcount.py
COPY test_wordcount.py /workspace/test_wordcount.py
COPY current-comet.sh /usr/local/bin/comet
RUN chmod 0755 /usr/local/bin/comet

# Do not pre-create openspec/. Each treatment owns its selected artifact
# layout; OpenSpec creates the configured root on first use.

# Create a non-root user: claude --dangerously-skip-permissions refuses to run
# as root, and Comet expects a normal HOME for Git/config discovery.
RUN useradd --create-home --shell /bin/bash agent && \
    chown -R agent:agent /workspace
USER agent
ENV HOME=/home/agent
ENV PYTHONPATH=/workspace
RUN git config --global user.email "agent@eval.local" && \
    git config --global user.name "Comet Eval Agent" && \
    git config --global init.defaultBranch master

CMD ["bash"]
