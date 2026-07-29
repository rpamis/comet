FROM python:3.12-slim

WORKDIR /workspace

RUN apt-get update && apt-get install -y --no-install-recommends \
    bash git curl jq ca-certificates \
    nodejs npm && \
    rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir pyyaml pytest

RUN npm install -g @fission-ai/openspec@1.3.1

ARG CLAUDE_CODE_VERSION=latest
RUN npm install -g @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}

COPY config_loader.py /workspace/config_loader.py
COPY test_config_loader.py /workspace/test_config_loader.py

RUN mkdir -p wordcount-cli && \
    echo '# Config Loader' > wordcount-cli/README.md
RUN mkdir -p openspec/changes

RUN useradd --create-home --shell /bin/bash agent && \
    chown -R agent:agent /workspace
USER agent
ENV HOME=/home/agent
# Validator scripts import scaffold.*; bake PYTHONPATH so it never crosses the
# MSYS path-conversion boundary on the docker run command line.
ENV PYTHONPATH=/workspace
RUN git config --global user.email "agent@eval.local" && \
    git config --global user.name "Comet Eval Agent" && \
    git config --global init.defaultBranch master

CMD ["bash"]
