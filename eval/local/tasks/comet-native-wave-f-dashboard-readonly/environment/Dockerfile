FROM node:22-bookworm-slim

WORKDIR /workspace

RUN apt-get update && apt-get install -y --no-install-recommends \
    git python3 python3-pip python-is-python3 ca-certificates && \
    rm -rf /var/lib/apt/lists/*

RUN npm config set registry https://registry.npmmirror.com && \
    npm install -g @anthropic-ai/claude-code@latest && \
    npm config delete registry

COPY current-comet-package.json /opt/comet-cli/package.json
RUN npm install --prefix /opt/comet-cli --omit=dev --ignore-scripts

RUN pip install --break-system-packages --no-cache-dir pyyaml pytest

COPY wordcount.py /workspace/wordcount.py
COPY test_wordcount.py /workspace/test_wordcount.py
COPY current-comet.sh /workspace/current-comet.sh

RUN useradd --create-home --shell /bin/bash agent && \
    chown -R agent:agent /workspace
USER agent
ENV HOME=/home/agent
ENV PYTHONPATH=/workspace
RUN git config --global user.email "agent@eval.local" && \
    git config --global user.name "Comet Native Eval Agent" && \
    git config --global init.defaultBranch master

CMD ["bash"]
