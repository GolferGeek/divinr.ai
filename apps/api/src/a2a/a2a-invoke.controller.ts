import {
  Controller,
  Post,
  Body,
  Req,
  Logger,
} from '@nestjs/common';
import { MarketsService } from '../markets/markets.service';

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
 */
@Controller('a2a')
export class A2AInvokeController {
  private readonly logger = new Logger(A2AInvokeController.name);

  constructor(private readonly marketsService: MarketsService) {}

  @Post()
  async invoke(
    @Body() body: A2ARequest,
    @Req() req: { user?: { id: string } },
  ) {
    if (body.jsonrpc !== '2.0' || body.method !== 'invoke') {
      return {
        jsonrpc: '2.0',
        id: body.id ?? null,
        error: {
          code: -32600,
          message: 'Invalid Request: expected jsonrpc 2.0 with method "invoke"',
        },
      };
    }

    const { context, data } = body.params ?? {};
    if (!context || !data) {
      return {
        jsonrpc: '2.0',
        id: body.id ?? null,
        error: {
          code: -32602,
          message: 'Invalid params: context and data are required',
        },
      };
    }

    const content = data.content ?? {};
    const capability = (content.capability as string) ?? '';
    const userId =
      req.user?.id ?? (context.userId as string) ?? 'a2a-caller';
    const organizationSlug =
      (context.tenantId as string) ??
      (content.organizationSlug as string) ??
      '';

    try {
      let result: unknown;

      switch (capability) {
        case 'markets/instruments':
          result = await this.marketsService.listInstruments(
            organizationSlug,
            userId,
          );
          break;

        case 'markets/analysts':
          result = await this.marketsService.listAnalysts(
            organizationSlug,
            userId,
          );
          break;

        case 'markets/runs':
          result = await this.marketsService.listRuns({
            organizationSlug,
            userId,
          });
          break;

        case 'markets/sources':
          result = await this.marketsService.listEntitledSources(
            organizationSlug,
            userId,
          );
          break;

        case 'markets/risk-assessments':
          result = await this.marketsService.listRiskAssessments({
            organizationSlug,
            userId,
            instrumentId: content.instrumentId as string | undefined,
          });
          break;

        case 'markets/predictions':
          result = await this.marketsService.listPredictionOutcomes({
            organizationSlug,
            userId,
          });
          break;

        default:
          return {
            jsonrpc: '2.0',
            id: body.id ?? null,
            error: {
              code: -32601,
              message: `Unknown capability: ${capability}`,
              data: { errorType: 'capability_not_found', retryable: false },
            },
          };
      }

      return {
        jsonrpc: '2.0',
        id: body.id ?? null,
        result: {
          success: true,
          output: {
            content: result,
            outputType: 'json',
          },
          metadata: {
            capability,
            timestamp: new Date().toISOString(),
          },
        },
      };
    } catch (error) {
      this.logger.error(`A2A invoke failed for ${capability}:`, error);
      return {
        jsonrpc: '2.0',
        id: body.id ?? null,
        error: {
          code: -32000,
          message: error instanceof Error ? error.message : 'Internal error',
          data: {
            errorType: 'invocation_failed',
            retryable: true,
          },
        },
      };
    }
  }
}
