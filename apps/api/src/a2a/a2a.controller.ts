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
      version: '0.2.0',
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
          description: 'Latest predictions with analyst assessments. Pass instrumentId for deep-dive.',
          kind: 'api',
          discoverable: true,
          invoke: { method: 'invoke' },
        },
        {
          id: 'markets-risk',
          slug: 'markets/risk-assessments',
          name: 'Risk Assessments',
          description: 'Composite risk scores across all instruments, or detail by instrumentId.',
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
          id: 'markets-trading',
          slug: 'markets/trading',
          name: 'Trading Dashboard',
          description: 'Analyst leaderboard, positions, P&L. Pass analystId for position details.',
          kind: 'api',
          discoverable: true,
          invoke: { method: 'invoke' },
        },
        {
          id: 'markets-portfolios',
          slug: 'markets/portfolios',
          name: 'Portfolios',
          description: 'Analyst portfolios with leaderboard rankings.',
          kind: 'api',
          discoverable: true,
          invoke: { method: 'invoke' },
        },
        {
          id: 'markets-queue',
          slug: 'markets/queue',
          name: 'Review Queue',
          description: 'Pending learning proposals awaiting human review. Read-only.',
          kind: 'api',
          discoverable: true,
          invoke: { method: 'invoke' },
        },
        {
          id: 'markets-context-agents',
          slug: 'markets/context-agents',
          name: 'Context Agents',
          description: 'Analyst personas and their configurations.',
          kind: 'api',
          discoverable: true,
          invoke: { method: 'invoke' },
        },
        {
          id: 'markets-daily-report',
          slug: 'markets/daily-report',
          name: 'Daily Report',
          description: '24h summary: predictions made, risk scores, outcomes, learning reports.',
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
