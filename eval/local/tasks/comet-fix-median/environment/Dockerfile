FROM python:3.12-slim

WORKDIR /workspace

# Runtime tools for both comet baselines:
# - bash: 0.3.9 classic shell scripts (bash 4+ arrays, [[ ]]; python:3.12-slim ships only dash)
# - nodejs npm: 0.4.0-beta.1 comet (independent .mjs command scripts) and OpenSpec CLI
# - git curl jq: comet scripts and state inspection
RUN apt-get update && apt-get install -y --no-install-recommends \
    bash git curl jq ca-certificates \
    nodejs npm && \
    rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir pyyaml pytest

# OpenSpec CLI (comet drives openspec new/list/status/archive).
RUN npm install -g @fission-ai/openspec@1.3.1

# Claude Code CLI (the agent runtime; version overridable via BENCH_CC_VERSION).
ARG CLAUDE_CODE_VERSION=latest
RUN npm install -g @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}

# The stats library with the median bug
COPY stats.py /workspace/stats.py
COPY test_stats.py /workspace/test_stats.py

RUN mkdir -p wordcount-cli && \
    echo '# Stats Lib\nA small statistics library.' > wordcount-cli/README.md

# OpenSpec working tree (comet-open writes under openspec/changes/)
RUN mkdir -p openspec/changes

# Create a non-root user: claude --dangerously-skip-permissions refuses to run
# as root, and most comet scripts also expect a normal HOME for git config etc.
RUN useradd --create-home --shell /bin/bash agent && \
    chown -R agent:agent /workspace
USER agent
ENV HOME=/home/agent
# Validator scripts import `scaffold.*`; bake PYTHONPATH so it never crosses the
# MSYS path-conversion boundary on the docker run command line.
ENV PYTHONPATH=/workspace
RUN git config --global user.email "agent@eval.local" && \
    git config --global user.name "Comet Eval Agent" && \
    git config --global init.defaultBranch master

CMD ["bash"]
