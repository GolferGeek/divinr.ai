# Apple Assistant ↔ Divinr Contract v0.2

The six `*.v0.2.json` files in this directory are byte-for-byte copies of the
shared coordination bundle:

`/Users/golfergeek/Library/Mobile Documents/com~apple~CloudDocs/Code Coordination/apple-assistant-to-divinr/shared/contract-v0.2/`

`manifest.v0.2.json` is authoritative for the other five shared-file hashes.
Do not edit a vendored contract locally. A wire change requires a coordinated
v0.3 bundle.

Upstream protocol pins:

- A2A `1.0.0`: `173695755607e884aa9acf8ce4feed90e32727a1`
- AP2 `v0.2.0`: `b4587ac1d055888a73b4b21750973cffba961793`
- x402 core v2: `21a2e489c7ba17c2b04e4cd9ea7015da1cb4aa99`

The `ap2/` tree is copied unchanged from
`code/sdk/schemas/ap2/` at the pinned AP2 commit. Its SHA-256 hashes are:

| File | SHA-256 |
|---|---|
| `checkout_mandate.json` | `10c0341edfeaa9084d3704ef8e94869de20499c8e357068d65f8d622bf79483a` |
| `checkout_receipt.json` | `941198a1fc1916d04813a8b8ccba4b407471305a6eb1b5338b1f67b6299764ea` |
| `open_checkout_mandate.json` | `bd6eb1c95a5ccb967259fae49100287755251c9d1bdb48342d96dd99fcb30b41` |
| `open_payment_mandate.json` | `65394d52af4d3326ab6b4bdcc2aa38d65a918d11b90efd8518c583bf015ab568` |
| `payment_mandate.json` | `94c4af64ed29825cb956705ae763d42f3c04d22feb60b8d838dae2bb1eea1fb1` |
| `payment_receipt.json` | `e7d52266c407d32bcc49959f91e8ddb73024a1803bef75b7bd368fb93849ba88` |
| `types/amount.json` | `15271efa8064539b8ded7c69f213ed7a1e64f8d9634b405ce926c2dcbbc41c0f` |
| `types/item.json` | `48c24532f105fda096ab89a27e04e896a597fda7e308e96cc88e11ce6a6632f9` |
| `types/jwk.json` | `4040c2b2a105cc5d66241896189cb9c59956246c9fab7dc38f9c1da98f12cacb` |
| `types/merchant.json` | `13457334d8577230a1cce5265971cfc02f68f5d4e97f74bd2e78128105d3ab31` |
| `types/payment_instrument.json` | `b3bcea7a7b5bbf2b0aa781135ac3b6907280822aa84797161c2d3d104d0cbe8c` |
| `types/pisp.json` | `60a5c8c09236f5d1e84a25bff4fd4cff05fb3fa8e3648cbab483322f27388630` |
| `types/receipt_status.json` | `ad51c1c20be72e286f4ff6fe2819145dcec7e5e3e0f6dc7870fcf748c06c1da0` |
