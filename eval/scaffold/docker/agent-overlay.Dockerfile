ARG BASE_IMAGE
FROM ${BASE_IMAGE}

USER root
ARG EVAL_AGENT=claude-code
ARG CODEX_VERSION=latest
ARG QODER_VERSION=latest
ARG CODEBUDDY_VERSION=latest
ARG LANGFUSE_ENABLED=false

RUN if [ "$EVAL_AGENT" = "codex" ]; then \
      npm install -g @openai/codex@${CODEX_VERSION}; \
    elif [ "$EVAL_AGENT" = "qoder" ]; then \
      npm install -g @qoder-ai/qodercli@${QODER_VERSION}; \
    elif [ "$EVAL_AGENT" = "codebuddy" ]; then \
      npm install -g @tencent-ai/codebuddy-code@${CODEBUDDY_VERSION}; \
    fi

# The official Claude hook can use the preinstalled Python SDK, while the
# official Codex plugin ships its Node bundle. Install the SDK only for an
# explicit Langfuse suite so Local/LangSmith images stay unchanged.
RUN if [ "$LANGFUSE_ENABLED" = "true" ]; then \
      apt-get update && apt-get install -y --no-install-recommends python3 python3-pip && \
      python3 -m pip install --break-system-packages --no-cache-dir 'langfuse>=4.0,<5' && \
      rm -rf /var/lib/apt/lists/*; \
    fi

USER agent
