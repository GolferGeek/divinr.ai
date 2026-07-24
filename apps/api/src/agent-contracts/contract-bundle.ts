import { createHash } from 'node:crypto';
import {
  existsSync,
  readFileSync,
  readdirSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import Ajv2020, { type ErrorObject, type ValidateFunction } from 'ajv/dist/2020';
import addFormats from 'ajv-formats';

const CONTRACT_RELATIVE_PATH = join('contracts', 'apple-divinr', 'v0.2');
const AP2_SCHEMA_HASHES: Readonly<Record<string, string>> = Object.freeze({
  'checkout_mandate.json': '10c0341edfeaa9084d3704ef8e94869de20499c8e357068d65f8d622bf79483a',
  'checkout_receipt.json': '941198a1fc1916d04813a8b8ccba4b407471305a6eb1b5338b1f67b6299764ea',
  'open_checkout_mandate.json': 'bd6eb1c95a5ccb967259fae49100287755251c9d1bdb48342d96dd99fcb30b41',
  'open_payment_mandate.json': '65394d52af4d3326ab6b4bdcc2aa38d65a918d11b90efd8518c583bf015ab568',
  'payment_mandate.json': '94c4af64ed29825cb956705ae763d42f3c04d22feb60b8d838dae2bb1eea1fb1',
  'payment_receipt.json': 'e7d52266c407d32bcc49959f91e8ddb73024a1803bef75b7bd368fb93849ba88',
  'types/amount.json': '15271efa8064539b8ded7c69f213ed7a1e64f8d9634b405ce926c2dcbbc41c0f',
  'types/item.json': '48c24532f105fda096ab89a27e04e896a597fda7e308e96cc88e11ce6a6632f9',
  'types/jwk.json': '4040c2b2a105cc5d66241896189cb9c59956246c9fab7dc38f9c1da98f12cacb',
  'types/merchant.json': '13457334d8577230a1cce5265971cfc02f68f5d4e97f74bd2e78128105d3ab31',
  'types/payment_instrument.json': 'b3bcea7a7b5bbf2b0aa781135ac3b6907280822aa84797161c2d3d104d0cbe8c',
  'types/pisp.json': '60a5c8c09236f5d1e84a25bff4fd4cff05fb3fa8e3648cbab483322f27388630',
  'types/receipt_status.json': 'ad51c1c20be72e286f4ff6fe2819145dcec7e5e3e0f6dc7870fcf748c06c1da0',
});

interface ContractManifest {
  schemaVersion: number;
  profileId: string;
  hashAlgorithm: 'SHA-256';
  files: Array<{ path: string; sha256: string }>;
}

export interface ContractBundle {
  root: string;
  manifest: ContractManifest;
  profile: Record<string, unknown>;
  profileSchema: Record<string, unknown>;
  schemas: Record<string, unknown>;
  fixtures: Record<string, unknown>;
  fixturesSchema: Record<string, unknown>;
}

export class ContractValidationError extends Error {
  constructor(
    message: string,
    readonly errors: ErrorObject[] = [],
  ) {
    super(message);
    this.name = 'ContractValidationError';
  }
}

function sha256(path: string): string {
  return createHash('sha256')
    .update(readFileSync(path, 'utf8'), 'utf8')
    .digest('hex');
}

function findWorkspaceRoot(start = process.cwd()): string {
  let current = resolve(start);
  while (true) {
    if (existsSync(join(current, 'pnpm-workspace.yaml'))) return current;
    const parent = dirname(current);
    if (parent === current) {
      throw new ContractValidationError(
        `Unable to locate workspace root from ${start}`,
      );
    }
    current = parent;
  }
}

function readJson(path: string): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  } catch (error) {
    throw new ContractValidationError(
      `Invalid contract JSON ${basename(path)}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

export function loadAndVerifyContractBundle(
  workspaceRoot = findWorkspaceRoot(),
): ContractBundle {
  const root = join(workspaceRoot, CONTRACT_RELATIVE_PATH);
  const manifestPath = join(root, 'manifest.v0.2.json');
  const manifest = readJson(manifestPath) as unknown as ContractManifest;
  if (
    manifest.schemaVersion !== 2 ||
    manifest.hashAlgorithm !== 'SHA-256' ||
    !Array.isArray(manifest.files)
  ) {
    throw new ContractValidationError('Invalid v0.2 contract manifest shape');
  }

  const expectedJson = new Set([
    'manifest.v0.2.json',
    ...manifest.files.map((entry) => entry.path),
  ]);
  const actualJson = readdirSync(root)
    .filter((name) => name.endsWith('.v0.2.json'));
  const unexpected = actualJson.filter((name) => !expectedJson.has(name));
  const missing = [...expectedJson].filter((name) => !actualJson.includes(name));
  if (missing.length || unexpected.length) {
    throw new ContractValidationError(
      `Contract bundle file mismatch; missing=${missing.join(',') || 'none'}; unexpected=${
        unexpected.join(',') || 'none'
      }`,
    );
  }

  for (const entry of manifest.files) {
    const actualHash = sha256(join(root, entry.path));
    if (actualHash !== entry.sha256) {
      throw new ContractValidationError(
        `Contract hash mismatch for ${entry.path}: expected ${entry.sha256}, got ${actualHash}`,
      );
    }
  }

  for (const [relativePath, expectedHash] of Object.entries(AP2_SCHEMA_HASHES)) {
    const path = join(root, 'ap2', relativePath);
    if (!existsSync(path)) {
      throw new ContractValidationError(`Missing pinned AP2 schema ${relativePath}`);
    }
    const actualHash = sha256(path);
    if (actualHash !== expectedHash) {
      throw new ContractValidationError(
        `Pinned AP2 hash mismatch for ${relativePath}: expected ${expectedHash}, got ${actualHash}`,
      );
    }
  }

  return {
    root,
    manifest,
    profile: readJson(join(root, 'integration-profile.v0.2.json')),
    profileSchema: readJson(join(root, 'profile-schema.v0.2.json')),
    schemas: readJson(join(root, 'schemas.v0.2.json')),
    fixtures: readJson(join(root, 'fixtures.v0.2.json')),
    fixturesSchema: readJson(join(root, 'fixtures-schema.v0.2.json')),
  };
}

export class AgentContractSchemaRegistry {
  private readonly validators = new Map<string, ValidateFunction>();

  constructor(readonly bundle = loadAndVerifyContractBundle()) {
    const ajv = new Ajv2020({
      allErrors: true,
      strict: true,
      // The frozen profile schema intentionally uses `required` as a presence
      // contract for several open metadata objects without repeating every
      // member under `properties`. That is valid JSON Schema, but Ajv's
      // optional strictRequired authoring lint rejects it. File bytes remain
      // exact through manifest verification; wire schemas still enforce their
      // own additionalProperties rules.
      strictRequired: false,
      // The shared schemas use type-specific keywords inside `contains` and
      // `oneOf` branches without restating `type` in every branch. JSON Schema
      // defines those keywords as no-ops for other types; Ajv's strictTypes
      // lint requires the redundant annotation.
      strictTypes: false,
      validateFormats: true,
    });
    addFormats(ajv);
    ajv.addSchema(bundle.schemas);
    ajv.addSchema(bundle.profileSchema);
    ajv.addSchema(bundle.fixturesSchema);

    this.validators.set('profile', ajv.getSchema(String(bundle.profileSchema.$id))!);
    this.validators.set('fixtures', ajv.getSchema(String(bundle.fixturesSchema.$id))!);

    const definitions = bundle.schemas.$defs as Record<string, unknown>;
    for (const name of Object.keys(definitions)) {
      const uri = `${String(bundle.schemas.$id)}#/$defs/${name}`;
      const validator = ajv.getSchema(uri);
      if (!validator) {
        throw new ContractValidationError(`Unable to compile schema ${uri}`);
      }
      this.validators.set(name, validator);
    }
  }

  validate(name: string, value: unknown): void {
    const validator = this.validators.get(name);
    if (!validator) {
      throw new ContractValidationError(`Unknown contract schema ${name}`);
    }
    if (!validator(value)) {
      throw new ContractValidationError(
        `Contract schema ${name} rejected the value`,
        validator.errors ?? [],
      );
    }
  }

  validateBundleDocuments(): void {
    this.validate('profile', this.bundle.profile);
    this.validate('fixtures', this.bundle.fixtures);
  }
}
