# Phase 7 Spark Lightning Inventory

**Observed**: 2026-07-24
**Host**: `spark-51e5` (`spark-51e5.tail126196.ts.net`, Tailscale
`100.120.203.62`)
**Method**: Read-only SSH and Docker inspection. No service, container, volume,
network, configuration, credential, or production state was changed.

## Decision

Preserve the existing OrchestratorAI Lightning profile unchanged. Do not repair,
reuse, rename, migrate, reset, or attach Divinr to its containers or volumes.
Build the Divinr payment demonstration as an independently named Compose
project with its own Bitcoin data, two LND identities, network, credentials,
facade databases, lifecycle, health checks, and rollback boundary.

## Existing ownership and lifecycle

- The four Lightning-related containers belong to Compose project
  `orchestratorai-enterprise`, configuration
  `/home/golfergeek/projects/orchestratorai-enterprise/docker-compose.yml`,
  profile `lightning`.
- Services are `bitcoind`, `lnd`, `lnd-init`, and `bitcoind-miner`.
- OrchestratorAI's named volumes are
  `orchestratorai-enterprise_bitcoind-data`,
  `orchestratorai-enterprise_lnd-data`, and
  `orchestratorai-enterprise_shared-data`.
- OrchestratorAI's bridge network is
  `orchestratorai-enterprise_default`.
- The miner and init services bind scripts from the OrchestratorAI repository.
- The LND container publishes REST on host port `6108` and gRPC on host port
  `6109`. These are legacy ports and are not Divinr facade endpoints.
- None of the four containers has a Docker health check. Bitcoin and LND use
  `unless-stopped`; the helper containers have no restart policy.
- The current images are:
  - `lncm/bitcoind:v27.0`,
    `lncm/bitcoind@sha256:324fec72192e8a1c7b79e7ab91003e47678b808d46da2c1943e72ec212ab348f`
  - `lightninglabs/lnd:v0.18.4-beta`,
    `lightninglabs/lnd@sha256:e44e6296611cb60c5d8382c69ab959281f4f9b96e2249949829d90752bc0df99`

The existing services and scripts remain OrchestratorAI dependencies. Divinr
must not make their availability, ports, credentials, volumes, or lifecycle a
precondition of its own payment demonstration.

## Current state

### Bitcoin Core

- Network: `regtest`
- Blocks and headers at observation: `129507`
- Verification progress: `1`
- Initial block download: `false`
- Pruning: disabled
- Loaded wallet: `miner`
- The miner reports that initial blocks were mined and periodic mining is
  active.

### LND

- Version: `0.18.4-beta`
- Network: Bitcoin `regtest`
- Identity:
  `02c0e510765d6c93e9df5e7b324f86004ef09ed034570756f16f5e91f71221d4e4`
- Reported height at observation: `129502`
- `synced_to_chain`: `false`
- `synced_to_graph`: `false`
- Peers: `0`
- Active, inactive, and pending channels: `0`
- Confirmed wallet balance: `1,494,999,998,350` sat, economically valueless
  regtest funds

## Diagnosed fault

LND repeatedly reports:

```text
Unable to synchronize wallet to chain: failed to fetch block hash for height
59422: block not found
```

The persisted LND wallet expects a block from an earlier regtest history that
the current Bitcoin data no longer contains. Bitcoin and LND persistent state
were therefore reset or replaced independently. Continuing to mine the current
chain cannot repair that historical mismatch.

The existing layout also contains image-created anonymous `/data/.bitcoin`
volumes in addition to the intended named Bitcoin volume. That ambiguity is
another reason not to adopt the legacy topology.

## Credential and exposure findings

- RPC credentials are present as process arguments in the legacy deployment.
  Their values were not recorded. The Divinr topology must use mounted
  credential files or runtime secret mounts, never command arguments, logs, the
  repository, model context, or general application environment.
- The existing LND REST/gRPC ports are host-published. The Divinr topology must
  publish no raw Bitcoin or LND API on the host.
- Apple Assistant must receive only the payer facade's TLS client material and
  schema-defined facade access. It must never receive LND TLS keys, seeds, or
  macaroons.
- Divinr API must receive only its merchant and payer-verifier mTLS identities.
  It must never receive payer execution authority or LND administrator
  credentials.

## Reserved Divinr boundary

The replacement will use repository-owned `infra/lightning-regtest/` and
`apps/payment-facades/`, a unique Compose project name, unique service/container
names, unique volumes, and an internal-only network. Only these facade
listeners may cross that network boundary:

- payer full API:
  `https://spark-51e5.tail126196.ts.net:7443/v1`, Tailscale plus mTLS;
- payer verifier:
  `https://127.0.0.1:7443/v1`, loopback plus its distinct mTLS identity;
- merchant:
  `https://127.0.0.1:7444/v1`, loopback plus the Divinr API mTLS identity.

No cutover is authorized by this inventory. A later cutover requires the full
Phase 7 gates: two synchronized identities, active funded channel, exact
payment, deterministic negative cases, restart/recovery evidence, and proof
that OrchestratorAI remains unaffected.
