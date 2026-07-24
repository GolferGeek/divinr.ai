FROM debian:bookworm-slim@sha256:7b140f374b289a7c2befc338f42ebe6441b7ea838a042bbd5acbfca6ec875818

ARG TARGETARCH
ARG BITCOIN_VERSION=31.1
ARG BITCOIN_SHA256_ARM64=dcf1873f2208ba4f962f3398d47e154c39c0084be8f4553e05c940d0ace3d004
ARG BITCOIN_SHA256_AMD64=b80d9c3e04da78fb6f0569685673418cf686fadba9042d926d13fb87ff503f9e

RUN apt-get update \
    && apt-get install --yes --no-install-recommends bash ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*
RUN set -eu; \
    case "${TARGETARCH}" in \
      arm64) archive_arch="aarch64"; expected="${BITCOIN_SHA256_ARM64}" ;; \
      amd64) archive_arch="x86_64"; expected="${BITCOIN_SHA256_AMD64}" ;; \
      *) echo "unsupported architecture: ${TARGETARCH}" >&2; exit 64 ;; \
    esac; \
    archive="bitcoin-${BITCOIN_VERSION}-${archive_arch}-linux-gnu.tar.gz"; \
    curl --fail --silent --show-error --location \
      "https://bitcoincore.org/bin/bitcoin-core-${BITCOIN_VERSION}/${archive}" \
      --output "/tmp/${archive}"; \
    printf '%s  %s\n' "${expected}" "/tmp/${archive}" | sha256sum -c -; \
    tar -xzf "/tmp/${archive}" -C /tmp; \
    install -m 0755 "/tmp/bitcoin-${BITCOIN_VERSION}/bin/bitcoind" /usr/local/bin/bitcoind; \
    install -m 0755 "/tmp/bitcoin-${BITCOIN_VERSION}/bin/bitcoin-cli" /usr/local/bin/bitcoin-cli

RUN groupadd --system bitcoin && useradd --system --gid bitcoin --home-dir /data bitcoin \
    && install -d -o bitcoin -g bitcoin -m 0700 /data
USER bitcoin
ENTRYPOINT ["bitcoind"]
