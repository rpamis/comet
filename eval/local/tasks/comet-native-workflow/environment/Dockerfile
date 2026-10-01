FROM node:22-bookworm-slim

WORKDIR /workspace

RUN apt-get update && apt-get install -y --no-install-recommends \
    bash git curl jq ca-certificates \
    python3 python3-pip python-is-python3 && \
    rm -rf /var/lib/apt/lists/*

RUN pip install --break-system-packages --no-cache-dir pyyaml pytest

COPY current-comet-package.json /opt/comet-cli/package.json
RUN npm install --prefix /opt/comet-cli --omit=dev --ignore-scripts

ARG CLAUDE_CODE_VERSION=latest
RUN npm install -g @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}

COPY wordcount.py /workspace/wordcount.py
COPY test_wordcount.py /workspace/test_wordcount.py
COPY current-comet.sh /usr/local/bin/comet
RUN chmod 0755 /usr/local/bin/comet

RUN useradd --create-home --shell /bin/bash agent && \
    chown -R agent:agent /workspace
USER agent
ENV HOME=/home/agent
ENV PYTHONPATH=/workspace
RUN git config --global user.email "agent@eval.local" && \
    git config --global user.name "Comet Native Eval Agent" && \
    git config --global init.defaultBranch master

CMD ["bash"]
