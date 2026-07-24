import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes, randomUUID, sign } from 'node:crypto';
import {
  canonicalJsonBytes,
  canonicalSha256,
  canonicalSha256Base64Url,
} from '../agent-contracts/canonical-json';
import { AgentContractSchemaRegistry } from '../agent-contracts/contract-bundle';
import type { AgentProduct } from '../agent-contracts/catalog';
import {
  AGENT_KEY_PROVIDER,
  type AgentKeyProvider,
} from './agent-key-provider';

export const AGENT_MERCHANT_INVOICE_ISSUER = Symbol(
  'AGENT_MERCHANT_INVOICE_ISSUER',
);

export interface AgentMerchantInvoice {
  invoice: string;
  paymentHash: string;
}

export interface AgentMerchantInvoiceIssuer {
  createInvoice(input: {
    taskId: string;
    quoteId: string;
    amount: string;
    expiresAt: string;
  }): Promise<AgentMerchantInvoice>;
}

@Injectable()
export class PhaseSixMerchantInvoiceIssuer implements AgentMerchantInvoiceIssuer {
  async createInvoice(input: {
    taskId: string;
    quoteId: string;
    amount: string;
    expiresAt: string;
  }): Promise<AgentMerchantInvoice> {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'Spark merchant Lightning invoice issuance is not enabled until Phase 7',
      );
    }
    const paymentHash = canonicalSha256({
      phase: 6,
      nonce: randomBytes(32).toString('base64url'),
      ...input,
    });
    return {
      // Deliberately non-payable. Phase 7 replaces this provider with the
      // restricted Spark merchant facade before production activation.
      invoice: `lnbcrt1phase6unpayable${paymentHash}`,
      paymentHash,
    };
  }
}

export interface AgentQuoteBundle {
  internalQuoteId: string;
  quoteId: string;
  checkoutJwtHash: string;
  checkoutNonceHash: string;
  paymentNonceHash: string;
  signedQuote: Record<string, unknown>;
  canonicalQuoteHash: string;
  requirementId: string;
  paymentRequirement: Record<string, unknown>;
  canonicalRequirementHash: string;
  quotedIntent: Record<string, unknown>;
  currentIntentHash: string;
  invoiceReferenceHash: string;
  expiresAt: string;
}

function encode(value: unknown): string {
  return Buffer.from(canonicalJsonBytes(value)).toString('base64url');
}

function rawSha256(value: string, encoding: 'hex' | 'base64url'): string {
  return createHash('sha256').update(value, 'utf8').digest(encoding);
}

const CHECKOUT_TITLES: Readonly<Record<string, string>> = Object.freeze({
  general_updates: 'Divinr general updates',
  personal_updates: 'Divinr personal updates',
  tournaments_list: 'Divinr tournament listing',
  tournament_context: 'Divinr tournament context',
  analysis_request: 'Divinr analysis',
  tournament_join: 'Divinr tournament join',
  tournament_trade: 'Divinr simulated tournament trade',
});

@Injectable()
export class AgentQuoteService {
  private readonly schemas = new AgentContractSchemaRegistry();

  constructor(
    @Inject(AGENT_KEY_PROVIDER) private readonly keys: AgentKeyProvider,
    @Inject(AGENT_MERCHANT_INVOICE_ISSUER)
    private readonly invoices: AgentMerchantInvoiceIssuer,
  ) {}

  async create(input: {
    taskId: string;
    businessInputHash: string;
    baseIntent: Record<string, unknown>;
    product: Readonly<AgentProduct>;
    now?: Date;
  }): Promise<AgentQuoteBundle> {
    const now = input.now ?? new Date();
    const quoteId = `quote-${randomUUID()}`;
    const internalQuoteId = randomUUID();
    const requirementId = `requirement-${randomUUID()}`;
    const checkoutNonce = `checkout-${randomUUID()}`;
    const paymentNonce = `payment-${randomUUID()}`;
    const createdAt = now.toISOString();
    const expiresAt = new Date(
      now.getTime() + input.product.quoteLifetimeSeconds * 1000,
    ).toISOString();
    const invoice = await this.invoices.createInvoice({
      taskId: input.taskId,
      quoteId,
      amount: input.product.atomicAmount,
      expiresAt,
    });
    const checkoutKey = await this.keys.getSigningKey('checkout');
    const checkoutHeader = {
      alg: 'ES256',
      kid: checkoutKey.keyId,
      typ: 'ap2-checkout+jwt',
    };
    const checkoutPayload = {
      iss: 'https://divinr.ai',
      aud: 'https://divinr.ai/a2a',
      iat: Math.floor(now.getTime() / 1000),
      exp: Math.floor(new Date(expiresAt).getTime() / 1000),
      jti: checkoutNonce,
      order_id: input.taskId,
      merchant: {
        id: 'divinr',
        name: 'Divinr',
        website: 'https://divinr.ai',
      },
      line_items: [{
        id: `${quoteId}-line-1`,
        product_id: input.product.productId,
        title: CHECKOUT_TITLES[input.product.skillId],
        quantity: 1,
        unit_price_minor: input.product.priceMinorUnits,
        currency: 'USD',
      }],
      total_price_minor: input.product.priceMinorUnits,
      currency: 'USD',
      quote_id: quoteId,
      input_hash: input.businessInputHash,
    };
    this.schemas.validate('checkoutClaims', checkoutPayload);
    const checkoutSigningInput =
      `${encode(checkoutHeader)}.${encode(checkoutPayload)}`;
    const checkoutSignature = sign(
      'sha256',
      new TextEncoder().encode(checkoutSigningInput),
      { key: checkoutKey.privateKey, dsaEncoding: 'ieee-p1363' },
    ).toString('base64url');
    const checkoutJwt = `${checkoutSigningInput}.${checkoutSignature}`;
    const checkoutJwtHash = rawSha256(checkoutJwt, 'base64url');
    const quoteKey = await this.keys.getSigningKey('quote');
    const unsignedQuote = {
      schemaVersion: 2,
      quoteId,
      taskId: input.taskId,
      merchantId: 'divinr',
      skillId: input.product.skillId,
      productId: input.product.productId,
      inputHash: input.businessInputHash,
      price: {
        currency: 'USD',
        minorUnits: input.product.priceMinorUnits,
        display: input.product.displayPrice,
      },
      settlement: {
        amount: input.product.atomicAmount,
        asset: 'BTC-REGTEST',
        unit: 'msat',
        network: 'urn:golfergeek:x402:lightning-regtest:v0.2',
        scheme: 'exact',
        invoice: invoice.invoice,
        paymentHash: invoice.paymentHash,
      },
      checkoutJwt,
      checkoutNonce,
      paymentNonce,
      createdAt,
      expiresAt,
      keyId: quoteKey.keyId,
    };
    const quoteSignature = sign(
      'sha256',
      canonicalJsonBytes(unsignedQuote),
      { key: quoteKey.privateKey, dsaEncoding: 'ieee-p1363' },
    ).toString('base64url');
    const signedQuote = { ...unsignedQuote, signature: quoteSignature };
    this.schemas.validate('signedQuote', signedQuote);
    const canonicalQuoteHash = canonicalSha256Base64Url(signedQuote);
    const paymentRequirement = {
      x402Version: 2,
      error: 'PAYMENT_REQUIRED',
      resource: {
        url: 'https://divinr.ai/a2a',
        description: 'Divinr paid business skill',
        mimeType: 'application/json',
      },
      accepts: [{
        scheme: 'exact',
        network: 'urn:golfergeek:x402:lightning-regtest:v0.2',
        amount: input.product.atomicAmount,
        asset: 'BTC-REGTEST',
        payTo: 'divinr',
        maxTimeoutSeconds: 60,
        extra: {
          unit: 'msat',
          invoice: invoice.invoice,
          paymentHash: invoice.paymentHash,
          quoteId,
          quoteHash: canonicalQuoteHash,
          checkoutMandateHash: checkoutJwtHash,
          paymentNonce,
        },
      }],
    };
    this.schemas.validate('paymentRequired', paymentRequirement);
    const canonicalRequirementHash =
      canonicalSha256Base64Url(paymentRequirement);
    const quotedIntent = {
      ...input.baseIntent,
      intentPhase: 'quoted',
      quoteId,
      quoteHash: canonicalQuoteHash,
      paymentRequirementHash: canonicalRequirementHash,
    };
    this.schemas.validate('quotedCanonicalIntent', quotedIntent);
    return {
      internalQuoteId,
      quoteId,
      checkoutJwtHash,
      checkoutNonceHash: rawSha256(checkoutNonce, 'hex'),
      paymentNonceHash: rawSha256(paymentNonce, 'hex'),
      signedQuote,
      canonicalQuoteHash,
      requirementId,
      paymentRequirement,
      canonicalRequirementHash,
      quotedIntent,
      currentIntentHash: canonicalSha256Base64Url(quotedIntent),
      invoiceReferenceHash: rawSha256(invoice.invoice, 'hex'),
      expiresAt,
    };
  }
}
