/**
 * Unit tests for CredentialEncryptionService
 * Tests encrypt/decrypt roundtrip and tamper detection.
 */
import { CredentialEncryptionService } from '../../src/credentials/credential-encryption.service';

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string) {
  if (condition) {
    passed++;
    console.log(`  \u2713 ${label}`);
  } else {
    failed++;
    console.error(`  \u2717 ${label}`);
  }
}

async function main(): Promise<void> {
  console.log('\n=== CredentialEncryptionService Tests ===\n');

  // Use dev key (no env var set)
  delete process.env.CREDENTIAL_ENCRYPTION_KEY;

  // ─── encrypt then decrypt roundtrip ──────────────────────
  {
    const service = new CredentialEncryptionService();
    const plaintext = 'sk-test-secret-key-12345';
    const { ciphertext, iv, tag } = service.encrypt(plaintext);
    const decrypted = service.decrypt(ciphertext, iv, tag);
    assert(decrypted === plaintext, 'encrypt then decrypt roundtrip preserves plaintext');
    assert(!ciphertext.toString('utf8').includes(plaintext), 'ciphertext does not contain plaintext');
    assert(iv.length === 12, 'IV is 12 bytes');
    assert(tag.length === 16, 'auth tag is 16 bytes');
  }

  // ─── decrypt with wrong tag fails ────────────────────────
  {
    const service = new CredentialEncryptionService();
    const plaintext = 'sk-another-secret';
    const { ciphertext, iv, tag } = service.encrypt(plaintext);

    // Tamper with the auth tag
    const badTag = Buffer.from(tag);
    badTag[0] = badTag[0] ^ 0xff;

    let threw = false;
    try {
      service.decrypt(ciphertext, iv, badTag);
    } catch {
      threw = true;
    }
    assert(threw, 'decrypt with wrong tag throws');
  }

  // ─── different plaintexts produce different ciphertexts ──
  {
    const service = new CredentialEncryptionService();
    const a = service.encrypt('key-a');
    const b = service.encrypt('key-b');
    assert(!a.ciphertext.equals(b.ciphertext), 'different plaintexts produce different ciphertexts');
    assert(!a.iv.equals(b.iv), 'different encryptions use different IVs');
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
