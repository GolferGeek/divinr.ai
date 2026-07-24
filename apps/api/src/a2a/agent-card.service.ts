import { Inject, Injectable } from '@nestjs/common';
import { sign } from 'node:crypto';
import {
  AGENT_KEY_PROVIDER,
  type AgentKeyProvider,
} from '../agent-commerce/agent-key-provider';
import { canonicalJson, canonicalJsonBytes } from '../agent-contracts/canonical-json';
import { AgentContractSchemaRegistry } from '../agent-contracts/contract-bundle';
import { loadAgentProductCatalog } from '../agent-contracts/catalog';

interface FrozenProfile {
  profileId: string;
  identifiers: { a2aExtensionUri: string };
  a2a: {
    agentCardExtensionRequired: boolean;
    agentCardExtensionParams: Record<string, unknown>;
  };
}

const SKILL_PRESENTATION: Record<string, {
  name: string;
  description: string;
  tags: string[];
  examples: string[];
}> = {
  general_updates: {
    name: 'General updates',
    description: 'Fetch general Divinr updates available to every connected user.',
    tags: ['updates', 'general', 'paid'],
    examples: ['Return general updates since 2026-07-20T00:00:00Z.'],
  },
  personal_updates: {
    name: 'Personal updates',
    description: 'Fetch Divinr updates scoped to the authenticated owner.',
    tags: ['updates', 'personal', 'paid'],
    examples: ['Return my latest Divinr updates.'],
  },
  tournaments_list: {
    name: 'Tournament listing',
    description: 'List Divinr tournaments visible to the authenticated owner.',
    tags: ['tournaments', 'listing', 'paid'],
    examples: ['List open Divinr tournaments.'],
  },
  tournament_context: {
    name: 'Tournament context',
    description: 'Fetch current rules and context for one Divinr tournament.',
    tags: ['tournaments', 'context', 'paid'],
    examples: ['Return the current context for tournament 018f8ab5-b2e0-77d0-964b-de126229c8dc.'],
  },
  analysis_request: {
    name: 'Analysis request',
    description: 'Purchase a typed Divinr analysis artifact for one instrument.',
    tags: ['analysis', 'instrument', 'paid'],
    examples: ['Analyze AAPL for a one-day horizon.'],
  },
  tournament_join: {
    name: 'Tournament join',
    description: 'Join one Divinr simulated tournament after explicit owner authority.',
    tags: ['tournaments', 'join', 'paid'],
    examples: ['Join tournament 018f8ab5-b2e0-77d0-964b-de126229c8dc.'],
  },
  tournament_trade: {
    name: 'Tournament trade',
    description: 'Submit one simulated tournament trade under current rules and authority.',
    tags: ['tournaments', 'trade', 'simulated'],
    examples: ['Buy 10 simulated AAPL shares in the selected tournament.'],
  },
};

@Injectable()
export class AgentCardService {
  private readonly registry = new AgentContractSchemaRegistry();
  private readonly catalog = loadAgentProductCatalog(this.registry);
  private readonly profile = this.registry.bundle.profile as unknown as FrozenProfile;

  constructor(
    @Inject(AGENT_KEY_PROVIDER) private readonly keys: AgentKeyProvider,
  ) {}

  async getAgentCard(): Promise<Record<string, unknown>> {
    const signingKey = await this.keys.getSigningKey('agent-card');
    const unsignedCard = {
      name: 'Divinr',
      description:
        'Typed, authenticated Divinr updates, market analysis, and simulated tournament actions for personal agents.',
      supportedInterfaces: [{
        url: 'https://divinr.ai/a2a',
        protocolBinding: 'JSONRPC',
        protocolVersion: '1.0',
      }],
      provider: {
        url: 'https://divinr.ai',
        organization: 'Divinr',
      },
      version: '0.2.0',
      documentationUrl: 'https://divinr.ai/docs/agents',
      capabilities: {
        streaming: false,
        pushNotifications: false,
        extendedAgentCard: false,
        extensions: [{
          uri: this.profile.identifiers.a2aExtensionUri,
          description:
            'Optional globally; required when invoking any paid Divinr v0.2 skill.',
          required: this.profile.a2a.agentCardExtensionRequired,
          params: this.profile.a2a.agentCardExtensionParams,
        }],
      },
      securitySchemes: {
        'oauth-dpop': {
          oauth2SecurityScheme: {
            description:
              'OAuth Device Authorization with sender-constrained DPoP access tokens.',
            oauth2MetadataUrl:
              'https://divinr.ai/.well-known/oauth-authorization-server',
            flows: {
              deviceCode: {
                deviceAuthorizationUrl:
                  'https://divinr.ai/oauth/device_authorization',
                tokenUrl: 'https://divinr.ai/oauth/token',
                refreshUrl: 'https://divinr.ai/oauth/token',
                scopes: {
                  'analysis:purchase': 'Purchase a typed Divinr analysis.',
                  'commerce:purchase': 'Submit authorized paid work.',
                  'receipts:read': 'Read receipts for owner-bound work.',
                  'tournaments:join': 'Join a simulated tournament.',
                  'tournaments:read': 'Read tournament data.',
                  'tournaments:trade': 'Place simulated tournament trades.',
                  'updates:read': 'Read general or personal updates.',
                },
              },
            },
          },
        },
      },
      securityRequirements: [{
        schemes: { 'oauth-dpop': { list: [] } },
      }],
      defaultInputModes: ['application/json'],
      defaultOutputModes: ['application/json'],
      skills: [...this.catalog.values()].map((product) => {
        const presentation = SKILL_PRESENTATION[product.skillId];
        if (!presentation) {
          throw new Error(`Missing Agent Card presentation for ${product.skillId}`);
        }
        return {
          id: product.skillId,
          ...presentation,
          inputModes: ['application/json'],
          outputModes: ['application/json'],
          securityRequirements: [{
            schemes: {
              'oauth-dpop': { list: [...product.requiredScopes] },
            },
          }],
        };
      }),
    };

    const protectedHeader = {
      alg: 'ES256',
      kid: signingKey.keyId,
      typ: 'application/a2a-agent-card+jws',
    };
    const protectedValue = Buffer.from(canonicalJson(protectedHeader)).toString('base64url');
    const payloadValue = Buffer.from(canonicalJsonBytes(unsignedCard)).toString('base64url');
    const signature = sign(
      'sha256',
      new TextEncoder().encode(`${protectedValue}.${payloadValue}`),
      { key: signingKey.privateKey, dsaEncoding: 'ieee-p1363' },
    ).toString('base64url');
    const card = {
      ...unsignedCard,
      signatures: [{ protected: protectedValue, signature }],
    };
    this.registry.validate('agentCardResponse', card);
    return card;
  }

  async getJwks(): Promise<{ keys: unknown[] }> {
    const response = { keys: await this.keys.getPublicKeys() };
    this.registry.validate('jwksResponse', response);
    return response;
  }
}
