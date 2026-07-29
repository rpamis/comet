FROM python:3.11-slim

WORKDIR /workspace

RUN pip install --no-cache-dir pyyaml

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates nodejs npm && \
    rm -rf /var/lib/apt/lists/*

RUN npm install -g @anthropic-ai/claude-code@latest

RUN useradd --create-home --shell /bin/bash agent && \
    chown -R agent:agent /workspace
USER agent
ENV HOME=/home/agent
