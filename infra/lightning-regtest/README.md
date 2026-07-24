# Divinr Lightning regtest

This Compose project is an isolated, economically valueless payment laboratory.
It is not a Bitcoin mainnet, testnet, or signet deployment and refuses to start
when `DIVINR_BITCOIN_NETWORK` is anything other than `regtest`.

It owns one Bitcoin Core chain and two persistent LND identities:

- `divinr-payer-lnd`: Apple Assistant's restricted payment authority;
- `divinr-merchant-lnd`: Divinr's restricted invoice/refund authority.

It neither joins nor modifies the `orchestratorai-enterprise` Compose project.
No raw Bitcoin or LND port is host-published. The only intended host listeners
are the mTLS facade ports described by the frozen v0.2 integration profile.

## Local lifecycle

```bash
bash infra/lightning-regtest/scripts/prepare-runtime.sh
docker compose -f infra/lightning-regtest/compose.yml up -d --build
bash infra/lightning-regtest/scripts/bootstrap-topology.sh
bash infra/lightning-regtest/scripts/verify-topology.sh
```

On Spark, set `DIVINR_AGENT_COMMERCE_ROOT=/var/lib/divinr-agent-commerce` in
the operator-only environment before running `prepare-runtime.sh`. Runtime
secrets, certificates, databases, LND state, and protected evidence must never
be copied to Git, iCloud, model context, logs, or general application
environment.

`reset-regtest.sh` is intentionally gated and deletes only this Compose
project’s disposable regtest volumes. It cannot target another network or
Compose project.
