FROM python:3.12-slim

WORKDIR /workspace

RUN apt-get update && apt-get install -y --no-install-recommends bash git curl jq ca-certificates nodejs npm && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir pyyaml pytest
RUN npm config set registry https://registry.npmmirror.com && npm install -g @fission-ai/openspec@1.3.1 && npm install -g @anthropic-ai/claude-code@latest && npm config delete registry
COPY . /workspace/
RUN mkdir -p openspec/changes
RUN useradd --create-home --shell /bin/bash agent && chown -R agent:agent /workspace
USER agent
ENV HOME=/home/agent
ENV PYTHONPATH=/workspace
RUN git config --global user.email "agent@eval.local" && git config --global user.name "Comet Eval Agent" && git config --global init.defaultBranch master
CMD ["bash"]
