FROM python:3.12-slim

WORKDIR /workspace

RUN apt-get update && apt-get install -y --no-install-recommends \
    git nodejs npm ca-certificates && \
    rm -rf /var/lib/apt/lists/*

RUN npm config set registry https://registry.npmmirror.com && \
    npm install -g @anthropic-ai/claude-code@latest && \
    npm config delete registry

RUN pip install --no-cache-dir pyyaml pytest

COPY wordcount.py /workspace/wordcount.py
COPY test_wordcount.py /workspace/test_wordcount.py

RUN useradd --create-home --shell /bin/bash agent && \
    chown -R agent:agent /workspace
USER agent
ENV HOME=/home/agent
ENV PYTHONPATH=/workspace
RUN git config --global user.email "agent@eval.local" && \
    git config --global user.name "Comet Native Clarification Depth Eval Agent" && \
    git config --global init.defaultBranch master

CMD ["bash"]
