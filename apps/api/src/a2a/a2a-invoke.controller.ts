import {
  Controller,
  Post,
  Body,
  Req,
  Logger,
  UseGuards,
  Inject,
} from '@nestjs/common';
import { MarketsService } from '../markets/markets.service';
import { AnalystPortfolioService } from '../markets/services/analyst-portfolio.service';
import { ServiceApiKeyGuard } from '../auth/service-api-key.guard';

interface A2ARequest {
  jsonrpc: string;
  id: string | number | null;
  method: string;
  params?: {
    context?: Record<string, unknown>;
    data?: { content?: Record<string, unknown> };
  };
}

/**
 * A2A JSON-RPC invoke endpoint — maps A2A invoke requests to internal service methods.
 * Protected by service API key + machine identity authentication.
 *
 * All capabilities are read-only. Enterprise will NEVER write, trigger runs, or modify data.
 */
@Controller('a2a')
@UseGuards(ServiceApiKeyGuard)
export class A2AInvokeController {
  private readonly logger = new Logger(A2AInvokeController.name);

  constructor(
    @Inject(MarketsService) private readonly marketsService: MarketsService,
    @Inject(AnalystPortfolioService) private readonly analystPortfolio: AnalystPortfolioService,
  ) {}

  @Post()
  async invoke(
    @Body() body: A2ARequest,
    @Req() req: { user?: { id: string } },
  ) {
    if (body.jsonrpc !== '2.0' || body.method !== 'invoke') {
      return this.error(body.id, -32600, 'Invalid Request: expected jsonrpc 2.0 with method "invoke"');
    }

    const { context, data } = body.params ?? {};
    if (!context || !data) {
      return this.error(body.id, -32602, 'Invalid params: context and data are required');
    }

    const content = data.content ?? {};
    const capability = (content.capability as string) ?? '';
    const userId = req.user?.id ?? (context.userId as string) ?? 'a2a-caller';
    const organizationSlug = (context.tenantId as string) ?? (content.organizationSlug as string) ?? '';
    const instrumentId = content.instrumentId as string | undefined;

    try {
      const result = await this.dispatch(capability, organizationSlug, userId, content, instrumentId);

      return {
        jsonrpc: '2.0',
        id: body.id ?? null,
        result: {
          success: true,
          output: { content: result, outputType: 'json' },
          metadata: { capability, timestamp: new Date().toISOString() },
        },
      };
    } catch (error) {
      this.logger.error(`A2A invoke failed for ${capability}:`, error);
      if (error instanceof CapabilityNotFoundError) {
        return this.error(body.id, -32601, error.message, { errorType: 'capability_not_found', retryable: false });
      }
      return this.error(body.id, -32000, error instanceof Error ? error.message : 'Internal error', { errorType: 'invocation_failed', retryable: true });
    }
  }

  private async dispatch(
    capability: string,
    organizationSlug: string,
    userId: string,
    content: Record<string, unknown>,
    instrumentId?: string,
  ): Promise<unknown> {
    switch (capability) {
      // ─── Already working ─────────────────────────────────────
      case 'markets/instruments':
        return this.marketsService.listInstruments(userId);

      case 'markets/analysts':
        return this.marketsService.listAnalysts(userId);

      case 'markets/runs':
        return this.marketsService.listRuns({ userId });

      case 'markets/sources':
        return this.marketsService.listEntitledSources(userId);

      // ─── Predictions (with optional instrumentId deep-dive) ──
      case 'markets/predictions': {
        const runId = content.runId as string | undefined;
        if (runId) {
          return this.marketsService.listPredictionOutcomes({ userId, runId });
        }
        if (instrumentId) {
          return this.marketsService.listPredictionsWithRole({
            userId, instrumentId, role: 'all',
          });
        }
        return this.marketsService.getDashboardPredictions(userId);
      }

      // ─── Risk assessments (unfiltered or by instrument) ──────
      case 'markets/risk-assessments':
        if (instrumentId) {
          return this.marketsService.getInstrumentCompositeScore(userId, instrumentId);
        }
        return this.marketsService.getDashboardRiskSummary(userId);

      // ─── Trading: leaderboard + positions ────────────────────
      case 'markets/trading': {
        const leaderboard = await this.analystPortfolio.getLeaderboard();
        const analystId = content.analystId as string | undefined;
        let positions: unknown[] = [];
        if (analystId) {
          positions = await this.analystPortfolio.listPositions(analystId);
        }
        return { leaderboard, positions };
      }

      // ─── Portfolios: analyst portfolios with leaderboard ─────
      case 'markets/portfolios': {
        const portfolios = await this.analystPortfolio.listPortfolios();
        const leaderboard = await this.analystPortfolio.getLeaderboard();
        return { portfolios, leaderboard };
      }

      // ─── Queue: pending learning proposals ───────────────────
      case 'markets/queue':
        return this.marketsService.listLearningProposals(userId, 'pending');

      // ─── Context agents: analyst personas + configs ──────────
      case 'markets/context-agents':
        return this.marketsService.listAnalysts(userId);

      // ─── Daily report: 24h aggregate ─────────────────────────
      case 'markets/daily-report':
        return this.marketsService.getDailyReport(userId);

      default:
        throw new CapabilityNotFoundError(`Unknown capability: ${capability}`);
    }
  }

  private error(id: string | number | null, code: number, message: string, data?: Record<string, unknown>) {
    return { jsonrpc: '2.0', id: id ?? null, error: { code, message, ...(data ? { data } : {}) } };
  }
}

class CapabilityNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CapabilityNotFoundError';
  }
}
