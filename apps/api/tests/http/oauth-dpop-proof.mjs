import { createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';

const [
  materialPath,
  accessToken,
  nonce,
  method = 'POST',
  uri = 'http://127.0.0.1:7198/a2a',
  athMode = 'valid',
  proofJti = `proof-${Date.now()}`,
] = process.argv.slice(2);
const material = JSON.parse(readFileSync(materialPath, 'utf8'));
const privateKey = createPrivateKey({ key: material.privateJwk, format: 'jwk' });
const publicJwk = createPublicKey(privateKey).export({ format: 'jwk' });
const base64urlJson = (value) =>
  Buffer.from(JSON.stringify(value)).toString('base64url');
const header = {
  typ: 'dpop+jwt',
  alg: 'ES256',
  jwk: {
    kty: 'EC',
    crv: 'P-256',
    x: publicJwk.x,
    y: publicJwk.y,
  },
};
const payload = {
  htm: method,
  htu: uri,
  iat: Math.floor(Date.now() / 1000),
  jti: proofJti,
  ath: athMode === 'valid'
    ? createHash('sha256').update(accessToken).digest('base64url')
    : 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  ...(nonce ? { nonce } : {}),
};
const input = `${base64urlJson(header)}.${base64urlJson(payload)}`;
const signature = sign(
  'sha256',
  Buffer.from(input),
  { key: privateKey, dsaEncoding: 'ieee-p1363' },
).toString('base64url');
process.stdout.write(`${input}.${signature}`);
