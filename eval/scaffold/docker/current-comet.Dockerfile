ARG BASE_IMAGE
FROM ${BASE_IMAGE}
USER root
COPY --from=current_cli --chmod=0555 / /opt/comet-current/
RUN ln -sfn /opt/comet-cli/node_modules /opt/comet-current/node_modules
USER agent
