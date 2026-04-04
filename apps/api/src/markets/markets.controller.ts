import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '@orchestratorai/planes/auth';
import { MarketsService } from './markets.service';
import { NightlyEvaluationService } from './services/nightly-evaluation.service';
import { LearningEngineService } from './services/learning-engine.service';
import { AnalystPortfolioService } from './services/analyst-portfolio.service';
import { UserPortfolioService } from './services/user-portfolio.service';
import { EodSettlementService } from './services/eod-settlement.service';
import { OrchestratorBaseDataService } from './services/orchestrator-base-data.service';
import { AnalystPipelineService } from './services/analyst-pipeline.service';
import { CrawlerService } from './services/crawler.service';
import { PredictorGeneratorService } from './services/predictor-generator.service';
import { PredictionGeneratorService } from './services/prediction-generator.service';
import { OutcomeTrackingService } from './services/outcome-tracking.service';
import type {
  CreateAnalystInput,
  ExternalCrawlerSyncInput,
  CreateInstrumentInput,
  CreateRunInput,
  ListMarketArticlesInput,
  ListPredictorsInput,
  RunType,
  RunStatus,
  UpsertPredictorInput,
  UpsertSourceEntitlementInput,
} from './markets.types';

interface AuthenticatedUser {
  id: string;
  email?: string;
  role?: string;
}

@UseGuards(JwtAuthGuard)
@Controller('markets')
export class MarketsController {
  private readonly markets: MarketsService;

  constructor(
    @Inject(MarketsService) markets: MarketsService,
    private readonly nightlyEvaluation: NightlyEvaluationService,
    private readonly learningEngine: LearningEngineService,
    private readonly analystPortfolio: AnalystPortfolioService,
    private readonly userPortfolio: UserPortfolioService,
    private readonly eodSettlement: EodSettlementService,
    private readonly baseData: OrchestratorBaseDataService,
    private readonly analystPipeline: AnalystPipelineService,
    private readonly crawler: CrawlerService,
    private readonly predictorGenerator: PredictorGeneratorService,
    private readonly predictionGenerator: PredictionGeneratorService,
    private readonly outcomeTracking: OutcomeTrackingService,
  ) {
    this.markets = markets;
  }

  /**
   * Resolve identity from the authenticated user (JWT/middleware) and
   * the organizationSlug from query/body/header.
   *
   * userId always comes from the authenticated principal.
   * organizationSlug comes from the request (query param, body field, or x-org-slug header).
   */
  private resolveIdentity(
    user: AuthenticatedUser,
    orgSlugSources: { query?: string; body?: string; header?: string },
  ): { organizationSlug: string; userId: string } {
    const organizationSlug =
      orgSlugSources.header || orgSlugSources.body || orgSlugSources.query;
    if (!organizationSlug) {
      throw new BadRequestException(
        'organizationSlug is required (via query param, body, or x-org-slug header)',
      );
    }
    return { organizationSlug, userId: user.id };
  }

  private getUser(req: { user?: AuthenticatedUser }): AuthenticatedUser {
    if (!req.user?.id) {
      throw new BadRequestException('Authentication required');
    }
    return req.user;
  }

  // ─── Instruments ───────────────────────────────────────────────

  @Get('instruments')
  async listInstruments(
    @Req() req: { user?: AuthenticatedUser },
    @Query('organizationSlug') orgSlug: string,
    @Query('x-org-slug') headerOrgSlug?: string,
  ) {
    const user = this.getUser(req);
    const identity = this.resolveIdentity(user, { query: orgSlug, header: headerOrgSlug });
    return this.markets.listInstruments(identity.organizationSlug, identity.userId);
  }

  @Post('instruments')
  async createInstrument(
    @Req() req: { user?: AuthenticatedUser },
    @Body() body: CreateInstrumentInput,
  ) {
    const user = this.getUser(req);
    if (!body?.symbol) {
      throw new BadRequestException('symbol is required');
    }
    const identity = this.resolveIdentity(user, { body: body.organizationSlug });
    return this.markets.createInstrument({
      ...body,
      organizationSlug: identity.organizationSlug,
      userId: identity.userId,
    });
  }

  // ─── Analysts ──────────────────────────────────────────────────

  @Get('analysts')
  async listAnalysts(
    @Req() req: { user?: AuthenticatedUser },
    @Query('organizationSlug') orgSlug: string,
  ) {
    const user = this.getUser(req);
    const identity = this.resolveIdentity(user, { query: orgSlug });
    return this.markets.listAnalysts(identity.organizationSlug, identity.userId);
  }

  @Get('instruments/:instrumentId/analysts')
  async listInstrumentAnalysts(
    @Req() req: { user?: AuthenticatedUser },
    @Param('instrumentId') instrumentId: string,
    @Query('organizationSlug') orgSlug: string,
  ) {
    const user = this.getUser(req);
    if (!instrumentId) {
      throw new BadRequestException('instrumentId is required');
    }
    const identity = this.resolveIdentity(user, { query: orgSlug });
    return this.markets.listAnalystsForInstrument(
      identity.organizationSlug,
      identity.userId,
      instrumentId,
    );
  }

  @Post('analysts')
  async createAnalyst(
    @Req() req: { user?: AuthenticatedUser },
    @Body() body: CreateAnalystInput,
  ) {
    const user = this.getUser(req);
    if (!body?.slug || !body?.displayName || !body?.personaPrompt) {
      throw new BadRequestException('slug, displayName, and personaPrompt are required');
    }
    const identity = this.resolveIdentity(user, { body: body.organizationSlug });
    return this.markets.createAnalyst({
      organizationSlug: identity.organizationSlug,
      userId: identity.userId,
      slug: body.slug,
      displayName: body.displayName,
      personaPrompt: body.personaPrompt,
    });
  }

  @Put('analysts/:analystId')
  async updateAnalyst(
    @Req() req: { user?: AuthenticatedUser },
    @Param('analystId') analystId: string,
    @Body() body: {
      organizationSlug: string;
      personaPrompt?: string;
      defaultWeight?: number;
      tierInstructions?: Record<string, string>;
      isEnabled?: boolean;
      changeReason?: string;
    },
  ) {
    const user = this.getUser(req);
    if (!analystId) throw new BadRequestException('analystId is required');
    const identity = this.resolveIdentity(user, { body: body.organizationSlug });
    return this.markets.updateAnalyst({
      organizationSlug: identity.organizationSlug,
      userId: identity.userId,
      analystId,
      personaPrompt: body.personaPrompt,
      defaultWeight: body.defaultWeight,
      tierInstructions: body.tierInstructions,
      isEnabled: body.isEnabled,
      changeReason: body.changeReason,
    });
  }

  @Post('analysts/:analystId/rollback')
  async rollbackAnalyst(
    @Req() req: { user?: AuthenticatedUser },
    @Param('analystId') analystId: string,
    @Body() body: { organizationSlug: string },
  ) {
    const user = this.getUser(req);
    if (!analystId) throw new BadRequestException('analystId is required');
    const identity = this.resolveIdentity(user, { body: body.organizationSlug });
    return this.markets.rollbackAnalyst({
      organizationSlug: identity.organizationSlug,
      userId: identity.userId,
      analystId,
    });
  }

  @Post('analysts/assign')
  async assignAnalyst(
    @Req() req: { user?: AuthenticatedUser },
    @Body() body: { organizationSlug: string; instrumentId: string; analystId: string },
  ) {
    const user = this.getUser(req);
    if (!body?.instrumentId || !body?.analystId) {
      throw new BadRequestException('instrumentId and analystId are required');
    }
    const identity = this.resolveIdentity(user, { body: body.organizationSlug });
    return this.markets.assignAnalystToInstrument({
      organizationSlug: identity.organizationSlug,
      userId: identity.userId,
      instrumentId: body.instrumentId,
      analystId: body.analystId,
    });
  }

  // ─── Sources & Articles ────────────────────────────────────────

  @Get('sources')
  async listSources(
    @Req() req: { user?: AuthenticatedUser },
    @Query('organizationSlug') orgSlug: string,
  ) {
    const user = this.getUser(req);
    const identity = this.resolveIdentity(user, { query: orgSlug });
    return this.markets.listEntitledSources(identity.organizationSlug, identity.userId);
  }

  @Post('sources/entitlements')
  async upsertSourceEntitlement(
    @Req() req: { user?: AuthenticatedUser },
    @Body() body: UpsertSourceEntitlementInput,
  ) {
    const user = this.getUser(req);
    if (!body?.sourceId || body?.isEnabled === undefined) {
      throw new BadRequestException('sourceId and isEnabled are required');
    }
    const identity = this.resolveIdentity(user, { body: body.organizationSlug });
    return this.markets.upsertSourceEntitlement({
      ...body,
      organizationSlug: identity.organizationSlug,
      userId: identity.userId,
    });
  }

  @Post('data/sync/external-crawler')
  async syncExternalCrawlerData(
    @Req() req: { user?: AuthenticatedUser },
    @Body() body: ExternalCrawlerSyncInput,
  ) {
    const user = this.getUser(req);
    const identity = this.resolveIdentity(user, { body: body.organizationSlug });
    return this.markets.syncExternalCrawlerData({
      ...body,
      organizationSlug: identity.organizationSlug,
      userId: identity.userId,
    });
  }

  @Get('articles')
  async listArticles(
    @Req() req: { user?: AuthenticatedUser },
    @Query('organizationSlug') orgSlug: string,
    @Query('sourceId') sourceId?: string,
    @Query('limit') limit?: string,
  ) {
    const user = this.getUser(req);
    const identity = this.resolveIdentity(user, { query: orgSlug });
    const parsedLimit =
      limit === undefined
        ? undefined
        : Number.isNaN(Number(limit))
          ? undefined
          : Number(limit);
    const request: ListMarketArticlesInput = {
      organizationSlug: identity.organizationSlug,
      userId: identity.userId,
      sourceId,
      limit: parsedLimit,
    };
    return this.markets.listMarketArticles(request);
  }

  // ─── Predictors ────────────────────────────────────────────────

  @Post('predictors/score')
  async scorePredictor(
    @Req() req: { user?: AuthenticatedUser },
    @Body() body: { organizationSlug: string; instrumentId: string; articleId: string },
  ) {
    const user = this.getUser(req);
    if (!body?.instrumentId || !body?.articleId) {
      throw new BadRequestException('instrumentId and articleId are required');
    }
    const identity = this.resolveIdentity(user, { body: body.organizationSlug });
    return this.markets.scoreArticleForInstrument({
      organizationSlug: identity.organizationSlug,
      userId: identity.userId,
      instrumentId: body.instrumentId,
      articleId: body.articleId,
    });
  }

  @Post('predictors/score-batch')
  async scorePredictorBatch(
    @Req() req: { user?: AuthenticatedUser },
    @Body() body: { organizationSlug: string; instrumentId: string; articleIds: string[] },
  ) {
    const user = this.getUser(req);
    if (!body?.instrumentId || !Array.isArray(body?.articleIds) || body.articleIds.length === 0) {
      throw new BadRequestException('instrumentId and articleIds (non-empty array) are required');
    }
    const identity = this.resolveIdentity(user, { body: body.organizationSlug });
    return this.markets.scoreArticleBatch({
      organizationSlug: identity.organizationSlug,
      userId: identity.userId,
      instrumentId: body.instrumentId,
      articleIds: body.articleIds,
    });
  }

  @Get('predictors')
  async listPredictors(
    @Req() req: { user?: AuthenticatedUser },
    @Query('organizationSlug') orgSlug: string,
    @Query('instrumentId') instrumentId: string,
    @Query('status') status?: 'active' | 'dismissed' | 'all',
  ) {
    const user = this.getUser(req);
    if (!instrumentId) {
      throw new BadRequestException('instrumentId is required');
    }
    const identity = this.resolveIdentity(user, { query: orgSlug });
    const request: ListPredictorsInput = {
      organizationSlug: identity.organizationSlug,
      userId: identity.userId,
      instrumentId,
      status,
    };
    return this.markets.listPredictors(request);
  }

  @Post('predictors')
  async upsertPredictor(
    @Req() req: { user?: AuthenticatedUser },
    @Body() body: UpsertPredictorInput,
  ) {
    const user = this.getUser(req);
    if (
      !body?.instrumentId ||
      !body?.articleId ||
      body.relevanceScore === undefined ||
      body.relevanceScore === null
    ) {
      throw new BadRequestException('instrumentId, articleId, and relevanceScore are required');
    }
    const identity = this.resolveIdentity(user, { body: body.organizationSlug });
    return this.markets.upsertPredictor({
      ...body,
      organizationSlug: identity.organizationSlug,
      userId: identity.userId,
    });
  }

  // ─── Runs ──────────────────────────────────────────────────────

  @Post('runs')
  async enqueueRun(
    @Req() req: { user?: AuthenticatedUser },
    @Body() body: Omit<CreateRunInput, 'runType'> & { runType: RunType },
  ) {
    const user = this.getUser(req);
    if (!body?.instrumentId || !body?.runType) {
      throw new BadRequestException('instrumentId and runType are required');
    }
    if (body.runType !== 'risk' && body.runType !== 'prediction') {
      throw new BadRequestException('runType must be one of: risk, prediction');
    }
    const identity = this.resolveIdentity(user, { body: body.organizationSlug });
    return this.markets.enqueueRun({
      ...body,
      organizationSlug: identity.organizationSlug,
      userId: identity.userId,
    });
  }

  @Get('runs')
  async listRuns(
    @Req() req: { user?: AuthenticatedUser },
    @Query('organizationSlug') orgSlug: string,
    @Query('status') status?: RunStatus,
  ) {
    const user = this.getUser(req);
    const identity = this.resolveIdentity(user, { query: orgSlug });
    if (
      status &&
      status !== 'queued' &&
      status !== 'running' &&
      status !== 'completed' &&
      status !== 'failed'
    ) {
      throw new BadRequestException('status must be one of: queued, running, completed, failed');
    }
    return this.markets.listRuns({
      organizationSlug: identity.organizationSlug,
      userId: identity.userId,
      status,
    });
  }

  @Get('runs/:runId')
  async getRun(
    @Req() req: { user?: AuthenticatedUser },
    @Param('runId') runId: string,
    @Query('organizationSlug') orgSlug: string,
    @Query('detail') detail?: string,
  ) {
    const user = this.getUser(req);
    if (!runId) throw new BadRequestException('runId is required');
    const identity = this.resolveIdentity(user, { query: orgSlug });
    if (detail === 'true') {
      return this.markets.getRunDetail(identity.organizationSlug, identity.userId, runId);
    }
    return this.markets.getRun(identity.organizationSlug, identity.userId, runId);
  }

  @Post('runs/:runId/status')
  async updateRunStatus(
    @Req() req: { user?: AuthenticatedUser },
    @Param('runId') runId: string,
    @Body() body: { organizationSlug: string; status: RunStatus; errorMessage?: string },
  ) {
    const user = this.getUser(req);
    if (!runId || !body?.status) {
      throw new BadRequestException('runId and status are required');
    }
    const validStatuses: RunStatus[] = ['queued', 'running', 'completed', 'failed'];
    if (!validStatuses.includes(body.status)) {
      throw new BadRequestException('status must be one of: queued, running, completed, failed');
    }
    if (body.status === 'failed' && (!body.errorMessage || body.errorMessage.trim().length === 0)) {
      throw new BadRequestException('errorMessage is required when status is failed');
    }
    if (body.status !== 'failed' && body.errorMessage && body.errorMessage.trim().length > 0) {
      throw new BadRequestException('errorMessage is only allowed when status is failed');
    }
    const identity = this.resolveIdentity(user, { body: body.organizationSlug });
    return this.markets.updateRunStatus({
      organizationSlug: identity.organizationSlug,
      userId: identity.userId,
      runId,
      status: body.status,
      errorMessage: body.errorMessage,
    });
  }

  @Post('runs/process-next')
  async processNextRun(
    @Req() req: { user?: AuthenticatedUser },
    @Body() body: { organizationSlug: string },
  ) {
    const user = this.getUser(req);
    const identity = this.resolveIdentity(user, { body: body.organizationSlug });
    return this.markets.processNextQueuedRun({
      organizationSlug: identity.organizationSlug,
      userId: identity.userId,
    });
  }

  @Post('runs/process')
  async processRuns(
    @Req() req: { user?: AuthenticatedUser },
    @Body() body: { organizationSlug: string; maxRuns?: number },
  ) {
    const user = this.getUser(req);
    const identity = this.resolveIdentity(user, { body: body.organizationSlug });
    if (
      body.maxRuns !== undefined &&
      (!Number.isInteger(body.maxRuns) || body.maxRuns < 1 || body.maxRuns > 100)
    ) {
      throw new BadRequestException('maxRuns must be an integer between 1 and 100');
    }
    return this.markets.processQueuedRuns({
      organizationSlug: identity.organizationSlug,
      userId: identity.userId,
      maxRuns: body.maxRuns,
    });
  }

  // ─── Evaluation & Replay ───────────────────────────────────────

  @Post('runs/:runId/evaluate')
  async evaluateRun(
    @Req() req: { user?: AuthenticatedUser },
    @Param('runId') runId: string,
    @Body() body: { organizationSlug: string; actualDirection: 'up' | 'down' | 'flat' },
  ) {
    const user = this.getUser(req);
    if (!runId || !body?.actualDirection) {
      throw new BadRequestException('runId and actualDirection are required');
    }
    const identity = this.resolveIdentity(user, { body: body.organizationSlug });
    return this.markets.evaluateRun({
      organizationSlug: identity.organizationSlug,
      userId: identity.userId,
      runId,
      actualDirection: body.actualDirection,
    });
  }

  @Post('runs/:runId/replay')
  async replayRun(
    @Req() req: { user?: AuthenticatedUser },
    @Param('runId') runId: string,
    @Body() body: { organizationSlug: string; scenario: string },
  ) {
    const user = this.getUser(req);
    if (!runId || !body?.scenario) {
      throw new BadRequestException('runId and scenario are required');
    }
    const identity = this.resolveIdentity(user, { body: body.organizationSlug });
    return this.markets.replayRun({
      organizationSlug: identity.organizationSlug,
      userId: identity.userId,
      runId,
      scenario: body.scenario,
    });
  }

  // ─── Artifacts & Outcomes ──────────────────────────────────────

  @Get('runs/:runId/artifacts')
  async listRunArtifacts(
    @Req() req: { user?: AuthenticatedUser },
    @Param('runId') runId: string,
    @Query('organizationSlug') orgSlug: string,
  ) {
    const user = this.getUser(req);
    if (!runId) {
      throw new BadRequestException('runId is required');
    }
    const identity = this.resolveIdentity(user, { query: orgSlug });
    return this.markets.listRunArtifacts({
      organizationSlug: identity.organizationSlug,
      userId: identity.userId,
      runId,
    });
  }

  @Get('predictions/dashboard')
  async getDashboardPredictions(
    @Req() req: { user?: AuthenticatedUser },
    @Query('organizationSlug') orgSlug: string,
  ) {
    const user = this.getUser(req);
    const identity = this.resolveIdentity(user, { query: orgSlug });
    return this.markets.getDashboardPredictions(identity.organizationSlug, identity.userId);
  }

  @Get('predictions')
  async listPredictions(
    @Req() req: { user?: AuthenticatedUser },
    @Query('organizationSlug') orgSlug: string,
    @Query('runId') runId?: string,
    @Query('instrumentId') instrumentId?: string,
    @Query('role') role?: 'analyst' | 'arbitrator' | 'all',
  ) {
    const user = this.getUser(req);
    const identity = this.resolveIdentity(user, { query: orgSlug });
    if (role) {
      return this.markets.listPredictionsWithRole({
        organizationSlug: identity.organizationSlug,
        userId: identity.userId,
        runId,
        instrumentId,
        role,
      });
    }
    return this.markets.listPredictionOutcomes({
      organizationSlug: identity.organizationSlug,
      userId: identity.userId,
      runId,
      instrumentId,
    });
  }

  @Get('risk-assessments')
  async listRiskAssessments(
    @Req() req: { user?: AuthenticatedUser },
    @Query('organizationSlug') orgSlug: string,
    @Query('runId') runId?: string,
    @Query('instrumentId') instrumentId?: string,
    @Query('role') role?: string,
  ) {
    const user = this.getUser(req);
    const identity = this.resolveIdentity(user, { query: orgSlug });
    return this.markets.listRiskAssessments({
      organizationSlug: identity.organizationSlug,
      userId: identity.userId,
      runId,
      instrumentId,
      role,
    });
  }

  @Get('runs/:runId/evaluations')
  async listRunEvaluations(
    @Req() req: { user?: AuthenticatedUser },
    @Param('runId') runId: string,
    @Query('organizationSlug') orgSlug: string,
  ) {
    const user = this.getUser(req);
    if (!runId) {
      throw new BadRequestException('runId is required');
    }
    const identity = this.resolveIdentity(user, { query: orgSlug });
    return this.markets.listRunEvaluations(
      identity.organizationSlug,
      identity.userId,
      runId,
    );
  }

  @Get('runs/:runId/replays')
  async listRunReplays(
    @Req() req: { user?: AuthenticatedUser },
    @Param('runId') runId: string,
    @Query('organizationSlug') orgSlug: string,
  ) {
    const user = this.getUser(req);
    if (!runId) {
      throw new BadRequestException('runId is required');
    }
    const identity = this.resolveIdentity(user, { query: orgSlug });
    return this.markets.listRunReplays(
      identity.organizationSlug,
      identity.userId,
      runId,
    );
  }

  // ─── Risk Details ──────────────────────────────────────────────

  @Get('risk-dimensions')
  async listRiskDimensions(
    @Req() req: { user?: AuthenticatedUser },
    @Query('organizationSlug') orgSlug: string,
  ) {
    const user = this.getUser(req);
    const identity = this.resolveIdentity(user, { query: orgSlug });
    return this.markets.listRiskDimensions(identity.organizationSlug, identity.userId);
  }

  @Post('risk-dimensions')
  async upsertRiskDimension(
    @Req() req: { user?: AuthenticatedUser },
    @Body() body: {
      organizationSlug: string;
      slug: string;
      name: string;
      description?: string;
      weight: number;
      displayOrder?: number;
      systemPrompt?: string;
      isActive?: boolean;
    },
  ) {
    const user = this.getUser(req);
    if (!body?.slug || !body?.name || body?.weight === undefined) {
      throw new BadRequestException('slug, name, and weight are required');
    }
    const identity = this.resolveIdentity(user, { body: body.organizationSlug });
    return this.markets.upsertRiskDimension({
      organizationSlug: identity.organizationSlug,
      userId: identity.userId,
      slug: body.slug,
      name: body.name,
      description: body.description,
      weight: body.weight,
      displayOrder: body.displayOrder,
      systemPrompt: body.systemPrompt,
      isActive: body.isActive,
    });
  }

  @Get('runs/:runId/risk-details')
  async getRunRiskDetails(
    @Req() req: { user?: AuthenticatedUser },
    @Param('runId') runId: string,
    @Query('organizationSlug') orgSlug: string,
  ) {
    const user = this.getUser(req);
    if (!runId) throw new BadRequestException('runId is required');
    const identity = this.resolveIdentity(user, { query: orgSlug });
    return this.markets.getRunRiskDetails(identity.organizationSlug, identity.userId, runId);
  }

  @Get('instruments/:instrumentId/composite-score')
  async getInstrumentCompositeScore(
    @Req() req: { user?: AuthenticatedUser },
    @Param('instrumentId') instrumentId: string,
    @Query('organizationSlug') orgSlug: string,
  ) {
    const user = this.getUser(req);
    if (!instrumentId) throw new BadRequestException('instrumentId is required');
    const identity = this.resolveIdentity(user, { query: orgSlug });
    return this.markets.getInstrumentCompositeScore(identity.organizationSlug, identity.userId, instrumentId);
  }

  // ─── Admin: Learning & Evaluation ──────────────────────────────

  // ─── Learning Proposals ─────────────────────────────────────────

  @Get('learning/proposals')
  async listLearningProposals(
    @Req() req: { user?: AuthenticatedUser },
    @Query('organizationSlug') orgSlug: string,
    @Query('status') status?: string,
  ) {
    const user = this.getUser(req);
    const identity = this.resolveIdentity(user, { query: orgSlug });
    return this.markets.listLearningProposals(identity.organizationSlug, identity.userId, status);
  }

  @Post('learning/proposals/:proposalId/approve')
  async approveProposal(
    @Req() req: { user?: AuthenticatedUser },
    @Param('proposalId') proposalId: string,
    @Body() body: { organizationSlug: string },
  ) {
    const user = this.getUser(req);
    if (!proposalId) throw new BadRequestException('proposalId is required');
    const identity = this.resolveIdentity(user, { body: body.organizationSlug });
    return this.markets.approveProposal(identity.organizationSlug, identity.userId, proposalId);
  }

  @Post('learning/proposals/:proposalId/reject')
  async rejectProposal(
    @Req() req: { user?: AuthenticatedUser },
    @Param('proposalId') proposalId: string,
    @Body() body: { organizationSlug: string; reason?: string },
  ) {
    const user = this.getUser(req);
    if (!proposalId) throw new BadRequestException('proposalId is required');
    const identity = this.resolveIdentity(user, { body: body.organizationSlug });
    return this.markets.rejectProposal(identity.organizationSlug, identity.userId, proposalId, body.reason);
  }

  @Get('learning/reports')
  async listLearningReports(
    @Req() req: { user?: AuthenticatedUser },
    @Query('organizationSlug') orgSlug: string,
    @Query('limit') limit?: string,
  ) {
    const user = this.getUser(req);
    const identity = this.resolveIdentity(user, { query: orgSlug });
    const parsedLimit = limit ? Math.min(50, Math.max(1, Number(limit) || 10)) : 10;
    return this.markets.listLearningReports(identity.organizationSlug, identity.userId, parsedLimit);
  }

  // ─── Portfolios ────────────────────────────────────────────────

  @Get('portfolios/analysts')
  async listAnalystPortfolios(@Req() req: { user?: AuthenticatedUser }, @Query('organizationSlug') orgSlug: string) {
    const user = this.getUser(req);
    const identity = this.resolveIdentity(user, { query: orgSlug });
    return this.analystPortfolio.listPortfolios(identity.organizationSlug);
  }

  @Get('portfolios/analysts/:analystId')
  async getAnalystPortfolio(
    @Req() req: { user?: AuthenticatedUser },
    @Param('analystId') analystId: string,
    @Query('organizationSlug') orgSlug: string,
  ) {
    this.getUser(req);
    return this.analystPortfolio.getPortfolio(analystId, orgSlug);
  }

  @Get('portfolios/analysts/:analystId/positions')
  async listAnalystPositions(
    @Req() req: { user?: AuthenticatedUser },
    @Param('analystId') analystId: string,
    @Query('organizationSlug') orgSlug: string,
    @Query('status') status?: string,
  ) {
    this.getUser(req);
    return this.analystPortfolio.listPositions(analystId, orgSlug, status);
  }

  @Get('portfolios/leaderboard')
  async getLeaderboard(@Req() req: { user?: AuthenticatedUser }, @Query('organizationSlug') orgSlug: string) {
    const user = this.getUser(req);
    const identity = this.resolveIdentity(user, { query: orgSlug });
    return this.analystPortfolio.getLeaderboard(identity.organizationSlug);
  }

  @Get('portfolios/me')
  async getMyPortfolio(@Req() req: { user?: AuthenticatedUser }, @Query('organizationSlug') orgSlug: string) {
    const user = this.getUser(req);
    const identity = this.resolveIdentity(user, { query: orgSlug });
    return this.userPortfolio.ensurePortfolio(identity.userId, identity.organizationSlug);
  }

  @Get('portfolios/me/positions')
  async getMyPositions(
    @Req() req: { user?: AuthenticatedUser },
    @Query('organizationSlug') orgSlug: string,
    @Query('status') status?: string,
  ) {
    const user = this.getUser(req);
    const identity = this.resolveIdentity(user, { query: orgSlug });
    return this.userPortfolio.listPositions(identity.userId, identity.organizationSlug, status);
  }

  @Get('portfolios/me/queue')
  async getMyTradeQueue(@Req() req: { user?: AuthenticatedUser }, @Query('organizationSlug') orgSlug: string) {
    const user = this.getUser(req);
    const identity = this.resolveIdentity(user, { query: orgSlug });
    return this.userPortfolio.getQueuedTrades(identity.userId, identity.organizationSlug);
  }

  @Post('portfolios/me/queue-trade')
  async queueTrade(
    @Req() req: { user?: AuthenticatedUser },
    @Body() body: {
      organizationSlug: string;
      predictionId: string;
      instrumentId: string;
      symbol: string;
      direction: 'long' | 'short';
      quantity: number;
    },
  ) {
    const user = this.getUser(req);
    if (!body?.predictionId || !body?.instrumentId || !body?.direction || !body?.quantity) {
      throw new BadRequestException('predictionId, instrumentId, direction, and quantity are required');
    }
    const identity = this.resolveIdentity(user, { body: body.organizationSlug });
    return this.userPortfolio.queueTrade({
      userId: identity.userId,
      organizationSlug: identity.organizationSlug,
      predictionId: body.predictionId,
      instrumentId: body.instrumentId,
      symbol: body.symbol,
      direction: body.direction,
      quantity: body.quantity,
    });
  }

  @Post('portfolios/me/queue-trade/:tradeId/cancel')
  async cancelTrade(
    @Req() req: { user?: AuthenticatedUser },
    @Param('tradeId') tradeId: string,
    @Body() body: { organizationSlug: string },
  ) {
    const user = this.getUser(req);
    const identity = this.resolveIdentity(user, { body: body.organizationSlug });
    await this.userPortfolio.cancelTrade(tradeId, identity.userId, identity.organizationSlug);
    return { cancelled: true };
  }

  // ─── Base Data (from orchestrator-ai) ───────────────────────────

  @Get('base/summary')
  async getBaseDataSummary(@Req() req: { user?: AuthenticatedUser }) {
    this.getUser(req);
    return this.baseData.getBaseDataSummary();
  }

  @Get('base/sources')
  async getBaseSources(@Req() req: { user?: AuthenticatedUser }) {
    this.getUser(req);
    return this.baseData.getBaseSources();
  }

  @Get('base/articles')
  async getBaseArticles(
    @Req() req: { user?: AuthenticatedUser },
    @Query('sourceId') sourceId?: string,
    @Query('limit') limit?: string,
  ) {
    this.getUser(req);
    return this.baseData.getBaseArticles({
      sourceId,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('base/instruments')
  async getBaseInstruments(@Req() req: { user?: AuthenticatedUser }) {
    this.getUser(req);
    return this.baseData.getBaseInstruments();
  }

  @Get('base/analysts')
  async getBaseAnalysts(@Req() req: { user?: AuthenticatedUser }) {
    this.getUser(req);
    return this.baseData.getBaseAnalysts();
  }

  @Get('base/predictors')
  async getBasePredictors(
    @Req() req: { user?: AuthenticatedUser },
    @Query('targetId') targetId?: string,
    @Query('limit') limit?: string,
  ) {
    this.getUser(req);
    return this.baseData.getBasePredictors({
      targetId,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('base/predictions')
  async getBasePredictions(
    @Req() req: { user?: AuthenticatedUser },
    @Query('targetId') targetId?: string,
    @Query('analystSlug') analystSlug?: string,
    @Query('limit') limit?: string,
  ) {
    this.getUser(req);
    return this.baseData.getBasePredictions({
      targetId,
      analystSlug,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('base/risk-assessments')
  async getBaseRiskAssessments(
    @Req() req: { user?: AuthenticatedUser },
    @Query('limit') limit?: string,
  ) {
    this.getUser(req);
    return this.baseData.getBaseRiskAssessments({
      limit: limit ? Number(limit) : undefined,
    });
  }

  // ─── Admin: Settlement, Learning & Evaluation ─────────────────

  @Post('admin/run-settlement')
  async triggerSettlement(@Req() req: { user?: AuthenticatedUser }) {
    this.getUser(req);
    return this.eodSettlement.runSettlement();
  }

  @Post('admin/run-nightly-evaluation')
  async triggerNightlyEvaluation(@Req() req: { user?: AuthenticatedUser }) {
    this.getUser(req);
    return this.nightlyEvaluation.runNightlyEvaluation();
  }

  @Post('admin/run-learning-cycle')
  async triggerLearningCycle(@Req() req: { user?: AuthenticatedUser }) {
    this.getUser(req);
    return this.learningEngine.runLearningCycle();
  }

  @Post('admin/run-crawl')
  async triggerCrawl(@Req() req: { user?: AuthenticatedUser }) {
    this.getUser(req);
    return this.crawler.runCrawl();
  }

  @Post('admin/run-predictor-generation')
  async triggerPredictorGeneration(@Req() req: { user?: AuthenticatedUser }) {
    this.getUser(req);
    return this.predictorGenerator.runGeneration();
  }

  @Post('admin/run-prediction-generation')
  async triggerPredictionGeneration(@Req() req: { user?: AuthenticatedUser }) {
    this.getUser(req);
    return this.predictionGenerator.runGeneration();
  }

  @Post('admin/run-outcome-tracking')
  async triggerOutcomeTracking(@Req() req: { user?: AuthenticatedUser }) {
    this.getUser(req);
    return this.outcomeTracking.runTracking();
  }

  @Post('admin/run-pipeline')
  async triggerFullPipeline(@Req() req: { user?: AuthenticatedUser }) {
    this.getUser(req);
    const crawlResult = await this.crawler.runCrawl();
    const predictorResult = await this.predictorGenerator.runGeneration();
    const predictionResult = await this.predictionGenerator.runGeneration();
    const outcomeResult = await this.outcomeTracking.runTracking();
    return {
      crawl: crawlResult,
      predictors: predictorResult,
      predictions: predictionResult,
      outcomes: outcomeResult,
    };
  }
}
