# Tooling image for tools/check-linux.sh, built from one commit's archived inputs.
# BASE and PLATFORM come from tools/tool-pins.json, so no pin is repeated here; the provisioning lives in
# tools/check-linux.sh, and every download it makes is checked against tools/tool-pins.json.
# No syntax directive: the built-in frontend needs no extra image from a registry.
ARG BASE
ARG PLATFORM
FROM --platform=${PLATFORM} ${BASE}

# Authenticated archive metadata only; exact versions are recorded in the image, not pinned.
RUN export DEBIAN_FRONTEND=noninteractive && apt-get update -qq && \
  apt-get install -y -qq --no-install-recommends \
    git ca-certificates curl xz-utils python3 python3-venv libicu74 libatomic1 sudo > /dev/null && \
  rm -rf /var/lib/apt/lists/*

COPY . /opt/sharpladder-check/inputs/
RUN sh /opt/sharpladder-check/inputs/tools/check-linux.sh --build-root
USER runner
RUN sh /opt/sharpladder-check/inputs/tools/check-linux.sh --build-user
USER root
RUN sh /opt/sharpladder-check/inputs/tools/check-linux.sh --build-seal
USER runner
WORKDIR /home/runner
