import { Controller, Get } from '@nestjs/common';
import { Public } from '@orchestratorai/planes/auth';

/**
 * A2A Discovery Controller — serves the Divinr agent card at /.well-known/agent.json.
 * Unauthenticated (public) for protocol compliance.
 */
@Controller('.well-known')
export class A2AController {
  @Public()
  @Get('agent.json')
  getAgentCard() {
    return {
      name: 'Divinr AI',
      description:
        'Market intelligence platform with multi-analyst prediction pipeline',
      url: 'https://divinr.ai',
      version: '0.1.0',
      capabilities: [
        {
          id: 'markets-instruments',
          slug: 'markets/instruments',
          name: 'Instrument Watchlists',
          kind: 'api',
          discoverable: true,
          invoke: { method: 'invoke' },
        },
        {
          id: 'markets-predictions',
          slug: 'markets/predictions',
          name: 'Predictions',
          kind: 'api',
          discoverable: true,
          invoke: { method: 'invoke' },
        },
        {
          id: 'markets-risk',
          slug: 'markets/risk-assessments',
          name: 'Risk Assessments',
          kind: 'api',
          discoverable: true,
          invoke: { method: 'invoke' },
        },
        {
          id: 'markets-analysts',
          slug: 'markets/analysts',
          name: 'Analysts',
          kind: 'api',
          discoverable: true,
          invoke: { method: 'invoke' },
        },
        {
          id: 'markets-runs',
          slug: 'markets/runs',
          name: 'Orchestration Runs',
          kind: 'api',
          discoverable: true,
          invoke: { method: 'invoke' },
        },
        {
          id: 'markets-sources',
          slug: 'markets/sources',
          name: 'Sources',
          kind: 'api',
          discoverable: true,
          invoke: { method: 'invoke' },
        },
        {
          id: 'markets-portfolios',
          slug: 'markets/portfolios',
          name: 'Portfolios',
          kind: 'api',
          discoverable: true,
          invoke: { method: 'invoke' },
        },
      ],
      authentication: {
        schemes: ['bearer'],
      },
    };
  }
}
