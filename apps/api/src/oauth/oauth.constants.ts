export const DIVINR_ISSUER = 'https://divinr.ai';
export const DIVINR_A2A_RESOURCE = `${DIVINR_ISSUER}/a2a`;
export const DEVICE_VERIFICATION_URI = `${DIVINR_ISSUER}/connect/device`;
export const DEVICE_GRANT_TYPE =
  'urn:ietf:params:oauth:grant-type:device_code';
export const DEVICE_CODE_LIFETIME_SECONDS = 600;
export const DEVICE_POLL_INTERVAL_SECONDS = 5;
export const AGENT_SCOPES = Object.freeze([
  'analysis:purchase',
  'commerce:purchase',
  'receipts:read',
  'tournaments:join',
  'tournaments:read',
  'tournaments:trade',
  'updates:read',
] as const);

export const FROZEN_AUTHORITY_REVIEW = Object.freeze({
  profileVersion: 2,
  mode: 'autonomous',
  network: 'regtest',
  economicValue: false,
  productPriceMinorUnits: { minimum: 1, maximum: 5 },
  maximumSuccessfulCalls: 10,
  maximumCumulativePriceMinorUnits: 25,
  maximumAtomicAmount: '250000',
  maximumPerTransactionAtomicAmount: '50000',
  authorityWindowSeconds: 3600,
});
