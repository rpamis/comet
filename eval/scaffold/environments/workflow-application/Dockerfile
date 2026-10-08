FROM node:22-bookworm-slim
WORKDIR /workspace
RUN apt-get update && apt-get install -y --no-install-recommends bash git ca-certificates python3 python3-pip python-is-python3 && rm -rf /var/lib/apt/lists/*
RUN pip install --break-system-packages --no-cache-dir pyyaml pytest
COPY current-comet-package.json /opt/comet-cli/package.json
RUN npm install --prefix /opt/comet-cli --omit=dev --ignore-scripts
RUN mkdir -p /opt/comet-current && ln -s /opt/comet-cli/node_modules /opt/comet-current/node_modules
RUN ln -s /opt/comet-cli/node_modules/.bin/openspec /usr/local/bin/openspec
ARG CLAUDE_CODE_VERSION=latest
RUN npm install -g @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}
COPY current-comet.sh /usr/local/bin/comet
RUN chmod 0755 /usr/local/bin/comet
RUN useradd --create-home --shell /bin/bash agent && chown -R agent:agent /workspace
USER agent
ENV HOME=/home/agent
RUN git config --global user.email "agent@eval.local" && git config --global user.name "Comet Application Eval" && git config --global init.defaultBranch master
CMD ["bash"]
