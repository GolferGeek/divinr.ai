import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '@orchestratorai/planes/auth';
import { DATABASE_SERVICE, type DatabaseService } from '@orchestratorai/planes/database';
import { MarketsService } from './markets.service';
import { NightlyEvaluationService } from './services/nightly-evaluation.service';
import { LearningEngineService } from './services/learning-engine.service';
import { AnalystPortfolioService } from './services/analyst-portfolio.service';
import { UserPortfolioService } from './services/user-portfolio.service';
import { LeaderboardService } from './services/leaderboard.service';
import { MonthlyResetService } from './services/monthly-reset.service';
import { BenchmarkIngestService } from './services/benchmark-ingest.service';
import { EodSettlementService } from './services/eod-settlement.service';
import { OrchestratorBaseDataService } from './services/orchestrator-base-data.service';
import { AnalystPipelineService } from './services/analyst-pipeline.service';
import { CrawlerService } from './services/crawler.service';
import { PredictorGeneratorService } from './services/predictor-generator.service';
import { PredictionGeneratorService } from './services/prediction-generator.service';
import { OutcomeTrackingService } from './services/outcome-tracking.service';
import { StopLossWatcherService } from './services/stop-loss-watcher.service';
import { EodForcedBuyService } from './services/eod-forced-buy.service';
import { DayTraderRunnerService } from './services/day-trader-runner.service';
import { DayTraderSchedulerService } from './services/day-trader-scheduler.service';
import { MarketsBarsService } from './services/markets-bars.service';
import { AuditService } from './services/audit.service';
import { StrategicOverhaulService } from './services/strategic-overhaul.service';
import { AffinityService } from './services/affinity.service';
import { NotificationService } from './services/notification.service';
import { FearGreedAlertService } from './services/fear-greed-alert.service';
import { CoordinationService } from './services/coordination.service';
import { PerformanceService } from './services/performance.service';
import { WiringService } from './services/wiring.service';
import { EnablementService } from './services/enablement.service';
import { LlmUsageQueryService } from './services/llm-usage-query.service';
import { AnalysisPreferencesService } from './services/analysis-preferences.service';
import { MessagingService } from '../messaging/messaging.service';
import { SkipReadOnly } from '../billing/skip-read-only.decorator';
import { LearningPanelService } from '../learning-panel/learning-panel.service';
import type { ChannelScope } from '../messaging/messaging.types';
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

const SYMBOL_PATTERN = /^[A-Z0-9.\-]{1,10}$/;

function parseSymbolsParam(raw: string | undefined): string[] {
  if (!raw || typeof raw !== 'string') {
    throw new BadRequestException('symbols query param is required');
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new BadRequestException('symbols query param is required');
  }
  const parts = trimmed
    .split(',')
    .map(s => s.trim().toUpperCase())
    .filter(s => s.length > 0);
  if (parts.length === 0) {
    throw new BadRequestException('symbols query param is required');
  }
  if (parts.length > 50) {
    throw new BadRequestException('symbols supports at most 50 entries');
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const sym of parts) {
    if (!SYMBOL_PATTERN.test(sym)) {
      throw new BadRequestException(`invalid symbol: ${sym}`);
    }
    if (!seen.has(sym)) {
      seen.add(sym);
      out.push(sym);
    }
  }
  return out;
}

@UseGuards(JwtAuthGuard)
@Controller('markets')
export class MarketsController {
  private readonly markets: MarketsService;

  constructor(
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
    @Inject(MarketsService) markets: MarketsService,
    @Inject(NightlyEvaluationService) private readonly nightlyEvaluation: NightlyEvaluationService,
    @Inject(LearningEngineService) private readonly learningEngine: LearningEngineService,
    @Inject(AnalystPortfolioService) private readonly analystPortfolio: AnalystPortfolioService,
    @Inject(UserPortfolioService) private readonly userPortfolio: UserPortfolioService,
    @Inject(LeaderboardService) private readonly leaderboard: LeaderboardService,
    @Inject(MonthlyResetService) private readonly monthlyReset: MonthlyResetService,
    @Inject(BenchmarkIngestService) private readonly benchmarkIngest: BenchmarkIngestService,
    @Inject(EodSettlementService) private readonly eodSettlement: EodSettlementService,
    @Inject(OrchestratorBaseDataService) private readonly baseData: OrchestratorBaseDataService,
    @Inject(AnalystPipelineService) private readonly analystPipeline: AnalystPipelineService,
    @Inject(CrawlerService) private readonly crawler: CrawlerService,
    @Inject(PredictorGeneratorService) private readonly predictorGenerator: PredictorGeneratorService,
    @Inject(PredictionGeneratorService) private readonly predictionGenerator: PredictionGeneratorService,
    @Inject(OutcomeTrackingService) private readonly outcomeTracking: OutcomeTrackingService,
    @Inject(StopLossWatcherService) private readonly stopLossWatcher: StopLossWatcherService,
    @Inject(EodForcedBuyService) private readonly eodForcedBuy: EodForcedBuyService,
    @Inject(DayTraderRunnerService) private readonly dayTraderRunner: DayTraderRunnerService,
    @Inject(DayTraderSchedulerService) private readonly dayTraderScheduler: DayTraderSchedulerService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(StrategicOverhaulService) private readonly strategicOverhaul: StrategicOverhaulService,
    @Inject(AffinityService) private readonly affinityService: AffinityService,
    @Inject(NotificationService) private readonly notificationService: NotificationService,
    @Inject(FearGreedAlertService) private readonly fearGreedAlertService: FearGreedAlertService,
    @Inject(CoordinationService) private readonly coordination: CoordinationService,
    @Inject(PerformanceService) private readonly performance: PerformanceService,
    @Inject(WiringService) private readonly wiring: WiringService,
    @Inject(EnablementService) private readonly enablement: EnablementService,
    @Inject(MessagingService) private readonly messaging: MessagingService,
    @Inject(LlmUsageQueryService) private readonly usageQuery: LlmUsageQueryService,
    @Inject(MarketsBarsService) private readonly marketsBars: MarketsBarsService,
    @Inject(LearningPanelService) private readonly learningPanel: LearningPanelService,
    @Inject(AnalysisPreferencesService) private readonly analysisPreferences: AnalysisPreferencesService,
  ) {
    this.markets = markets;
  }

  private getUser(req: { user?: AuthenticatedUser }): AuthenticatedUser {
    if (!req.user?.id) {
      throw new BadRequestException('Authentication required');
    }
    return req.user;
  }

  private async requireAdmin(user: AuthenticatedUser): Promise<void> {
    const result = await this.db.rawQuery(
      `SELECT r.name FROM authz.rbac_user_roles ur
       JOIN authz.rbac_roles r ON r.id = ur.role_id
       WHERE ur.user_id = $1 AND r.name IN ('super-admin', 'admin', 'owner')
       LIMIT 1`,
      [user.id],
    );
    const rows = (result.data as Array<{ name: string }> | null) ?? [];
    if (rows.length === 0) throw new ForbiddenException('Admin access required');
  }

  /**
   * Block beta_reader users from mutation endpoints.
   * Effort: beta-user-share-path.
   */
  private async requireWriteAccess(user: AuthenticatedUser): Promise<void> {
    const result = await this.db.rawQuery(
      `SELECT rr.name FROM authz.rbac_user_roles r
       JOIN authz.rbac_roles rr ON rr.id = r.role_id
       WHERE r.user_id = $1
       ORDER BY CASE rr.name
         WHEN 'super-admin' THEN 1
         WHEN 'owner' THEN 2
         WHEN 'admin' THEN 3
         WHEN 'builder' THEN 4
         WHEN 'member' THEN 5
         WHEN 'beta_reader' THEN 6
         ELSE 7
       END
       LIMIT 1`,
      [user.id],
    );
    const rows = (result.data as Array<{ name: string }> | null) ?? [];
    const role = rows.length > 0 ? rows[0].name : null;
    const writableRoles = ['super-admin', 'owner', 'admin', 'builder', 'member'];
    if (role && writableRoles.includes(role)) return;
    throw new ForbiddenException('Read-only access — beta readers cannot perform this action');
  }

  private async requireAuthoringAccess(user: AuthenticatedUser): Promise<void> {
    const result = await this.db.rawQuery(
      `SELECT rr.name FROM authz.rbac_user_roles r
       JOIN authz.rbac_roles rr ON rr.id = r.role_id
       WHERE r.user_id = $1
       ORDER BY CASE rr.name
         WHEN 'super-admin' THEN 1
         WHEN 'owner' THEN 2
         WHEN 'admin' THEN 3
         WHEN 'builder' THEN 4
         WHEN 'member' THEN 5
         WHEN 'beta_reader' THEN 6
         ELSE 7
       END
       LIMIT 1`,
      [user.id],
    );
    const rows = (result.data as Array<{ name: string }> | null) ?? [];
    const role = rows.length > 0 ? rows[0].name : null;
    if (role && ['super-admin', 'owner', 'admin', 'builder'].includes(role)) return;
    throw new ForbiddenException('Builder access required to create custom analysts or instruments');
  }

  // ─── Market Bars ───────────────────────────────────────────────

  @Get('bars/latest')
  async getLatestBars(
    @Req() req: { user?: AuthenticatedUser },
    @Query('symbols') symbolsParam?: string,
  ): Promise<Record<string, unknown>> {
    this.getUser(req);
    const symbols = parseSymbolsParam(symbolsParam);
    const barsMap = await this.marketsBars.getIntradayBarsForSymbols(symbols);
    const out: Record<string, unknown> = {};
    for (const sym of symbols) {
      const bars = barsMap.get(sym) ?? [];
      out[sym] = bars.length > 0 ? bars[bars.length - 1] : null;
    }
    return out;
  }

  // ─── Instruments ───────────────────────────────────────────────

  @Get('instruments')
  async listInstruments(
    @Req() req: { user?: AuthenticatedUser },
  ) {
    const user = this.getUser(req);
    return this.markets.listInstruments(user.id);
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
    await this.requireAuthoringAccess(user);
    return this.markets.createInstrument({
      ...body,
      userId: user.id,
    });
  }

  @Get('instruments/mine')
  async listMyInstruments(@Req() req: { user?: AuthenticatedUser }) {
    const user = this.getUser(req);
    return this.markets.listMyInstruments(user.id);
  }

  @Delete('instruments/:instrumentId')
  async deleteInstrument(
    @Req() req: { user?: AuthenticatedUser },
    @Param('instrumentId') instrumentId: string,
  ) {
    const user = this.getUser(req);
    await this.requireWriteAccess(user);
    await this.markets.softDeleteInstrument(instrumentId, user.id);
    return { deleted: true };
  }

  // ─── Analysts ──────────────────────────────────────────────────

  @Get('analysts')
  async listAnalysts(
    @Req() req: { user?: AuthenticatedUser },
  ) {
    const user = this.getUser(req);
    return this.markets.listAnalysts(user.id);
  }

  @Get('analysts/mine')
  async listMyAnalysts(@Req() req: { user?: AuthenticatedUser }) {
    const user = this.getUser(req);
    return this.markets.listMyAnalysts(user.id);
  }

  @Get('instruments/:instrumentId/analysts')
  async listInstrumentAnalysts(
    @Req() req: { user?: AuthenticatedUser },
    @Param('instrumentId') instrumentId: string,
    @Query('analystId') analystId?: string,
  ) {
    const user = this.getUser(req);
    if (!instrumentId) {
      throw new BadRequestException('instrumentId is required');
    }
    let results = await this.markets.listAnalystsForInstrument(
      user.id,
      instrumentId,
    );
    if (analystId) {
      results = (results as any[]).filter((a: any) => a['id'] === analystId);
    }
    return results;
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
    await this.requireAuthoringAccess(user);
    return this.markets.createAnalyst({
      userId: user.id,
      slug: body.slug,
      displayName: body.displayName,
      personaPrompt: body.personaPrompt,
    });
  }

  @Delete('analysts/:analystId')
  async deleteAnalyst(
    @Req() req: { user?: AuthenticatedUser },
    @Param('analystId') analystId: string,
  ) {
    const user = this.getUser(req);
    await this.requireWriteAccess(user);
    await this.markets.softDeleteAnalyst(analystId, user.id);
    return { deleted: true };
  }

  @Patch('analysts/:analystId/metadata')
  async updateAnalystMetadata(
    @Req() req: { user?: AuthenticatedUser },
    @Param('analystId') analystId: string,
    @Body() body: {
      displayName?: string;
      llmProvider?: string | null;
      llmModel?: string | null;
      byoCredentialId?: string | null;
    },
  ) {
    const user = this.getUser(req);
    await this.requireWriteAccess(user);
    await this.markets.updateAnalystMetadata(analystId, user.id, body);
    return { updated: true };
  }

  @Put('analysts/:analystId')
  async updateAnalyst(
    @Req() req: { user?: AuthenticatedUser },
    @Param('analystId') analystId: string,
    @Body() body: {
      personaPrompt?: string;
      defaultWeight?: number;
      tierInstructions?: Record<string, string>;
      isEnabled?: boolean;
      changeReason?: string;
    },
  ) {
    const user = this.getUser(req);
    if (!analystId) throw new BadRequestException('analystId is required');
    await this.requireWriteAccess(user);
    return this.markets.updateAnalyst({
      userId: user.id,
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
  ) {
    const user = this.getUser(req);
    if (!analystId) throw new BadRequestException('analystId is required');
    await this.requireWriteAccess(user);
    return this.markets.rollbackAnalyst({
      userId: user.id,
      analystId,
    });
  }

  @Get('analysts/:analystId/contract')
  async getAnalystContract(
    @Req() req: { user?: AuthenticatedUser },
    @Param('analystId') analystId: string,
  ) {
    const user = this.getUser(req);
    return this.markets.getAnalystContract(analystId, user.id);
  }

  @Put('analysts/:analystId/contract')
  async saveAnalystContract(
    @Req() req: { user?: AuthenticatedUser },
    @Param('analystId') analystId: string,
    @Body() body: { markdown: string; changeReason?: string },
  ) {
    const user = this.getUser(req);
    await this.requireWriteAccess(user);
    return this.markets.saveAnalystContract({
      analystId,
      userId: user.id,
      markdown: body.markdown,
      changeReason: body.changeReason,
    });
  }

  /**
   * Preflight validation for the contract editor — returns the same shape as
   * the save-time validation error without creating a new version.
   * Effort: stage-keyed-analyst-contracts (Phase 5).
   */
  @Post('analysts/:analystId/contract/validate')
  async validateAnalystContract(
    @Req() req: { user?: AuthenticatedUser },
    @Param('analystId') analystId: string,
    @Body() body: { markdown: string },
  ) {
    const user = this.getUser(req);
    if (!body?.markdown || typeof body.markdown !== 'string') {
      throw new BadRequestException('markdown is required');
    }
    return this.markets.validateAnalystContract(analystId, user.id, body.markdown);
  }

  @Get('analysts/:analystId/contract/versions')
  async getAnalystContractVersions(
    @Req() req: { user?: AuthenticatedUser },
    @Param('analystId') analystId: string,
    @Query('authorUserId') authorUserId?: string,
  ) {
    const user = this.getUser(req);
    return this.markets.getAnalystContractVersions(analystId, user.id, authorUserId);
  }

  @Post('analysts/:analystId/contract/scaffold')
  async scaffoldAnalystContract(
    @Req() req: { user?: AuthenticatedUser },
    @Param('analystId') analystId: string,
  ) {
    const user = this.getUser(req);
    await this.requireWriteAccess(user);
    return this.markets.scaffoldAnalystContract(analystId, user.id);
  }

  @Get('instruments/:instrumentId/contract')
  async getInstrumentContract(
    @Req() req: { user?: AuthenticatedUser },
    @Param('instrumentId') instrumentId: string,
  ) {
    const user = this.getUser(req);
    if (!instrumentId) throw new BadRequestException('instrumentId is required');
    return this.markets.getInstrumentContract(instrumentId, user.id);
  }

  @Put('instruments/:instrumentId/contract')
  async saveInstrumentContract(
    @Req() req: { user?: AuthenticatedUser },
    @Param('instrumentId') instrumentId: string,
    @Body() body: { markdown: string; changeReason?: string },
  ) {
    const user = this.getUser(req);
    if (!instrumentId) throw new BadRequestException('instrumentId is required');
    await this.requireWriteAccess(user);
    return this.markets.saveInstrumentContract({
      instrumentId,
      userId: user.id,
      markdown: body.markdown,
      changeReason: body.changeReason,
    });
  }

  @Post('instruments/:instrumentId/contract/validate')
  async validateInstrumentContract(
    @Req() req: { user?: AuthenticatedUser },
    @Param('instrumentId') instrumentId: string,
    @Body() body: { markdown: string },
  ) {
    const user = this.getUser(req);
    if (!instrumentId) throw new BadRequestException('instrumentId is required');
    if (!body?.markdown || typeof body.markdown !== 'string') {
      throw new BadRequestException('markdown is required');
    }
    return this.markets.validateInstrumentContract(instrumentId, user.id, body.markdown);
  }

  @Post('instruments/:instrumentId/contract/scaffold')
  async scaffoldInstrumentContract(
    @Req() req: { user?: AuthenticatedUser },
    @Param('instrumentId') instrumentId: string,
  ) {
    const user = this.getUser(req);
    await this.requireWriteAccess(user);
    return this.markets.scaffoldInstrumentContract(instrumentId, user.id);
  }

  @Post('analysts/assign')
  async assignAnalyst(
    @Req() req: { user?: AuthenticatedUser },
    @Body() body: { instrumentId: string; analystId: string },
  ) {
    const user = this.getUser(req);
    if (!body?.instrumentId || !body?.analystId) {
      throw new BadRequestException('instrumentId and analystId are required');
    }
    await this.requireWriteAccess(user);
    return this.markets.assignAnalystToInstrument({
      userId: user.id,
      instrumentId: body.instrumentId,
      analystId: body.analystId,
    });
  }

  // ─── Sources & Articles ────────────────────────────────────────

  @Get('sources')
  async listSources(
    @Req() req: { user?: AuthenticatedUser },
  ) {
    const user = this.getUser(req);
    return this.markets.listEntitledSources(user.id);
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
    await this.requireWriteAccess(user);
    return this.markets.upsertSourceEntitlement({
      ...body,
      userId: user.id,
    });
  }

  @Get('sources/:sourceId/articles')
  async listSourceArticles(
    @Req() req: { user?: AuthenticatedUser },
    @Param('sourceId') sourceId: string,
    @Query('limit') limit?: string,
  ) {
    const user = this.getUser(req);
    return this.markets.listSourceArticles(user.id, sourceId, parseInt(limit || '20', 10));
  }

  @Get('sources/data-adapters')
  async listDataAdapters(
    @Req() req: { user?: AuthenticatedUser },
  ) {
    const user = this.getUser(req);
    return this.markets.listDataAdapters(user.id);
  }

  @Post('data/sync/external-crawler')
  async syncExternalCrawlerData(
    @Req() req: { user?: AuthenticatedUser },
    @Body() body: ExternalCrawlerSyncInput,
  ) {
    const user = this.getUser(req);
    await this.requireWriteAccess(user);
    return this.markets.syncExternalCrawlerData({
      ...body,
      userId: user.id,
    });
  }

  @Get('articles')
  async listArticles(
    @Req() req: { user?: AuthenticatedUser },
    @Query('sourceId') sourceId?: string,
    @Query('limit') limit?: string,
  ) {
    const user = this.getUser(req);
    const parsedLimit =
      limit === undefined
        ? undefined
        : Number.isNaN(Number(limit))
          ? undefined
          : Number(limit);
    const request: ListMarketArticlesInput = {
      userId: user.id,
      sourceId,
      limit: parsedLimit,
    };
    return this.markets.listMarketArticles(request);
  }

  // ─── Predictors ────────────────────────────────────────────────

  @Post('predictors/score')
  async scorePredictor(
    @Req() req: { user?: AuthenticatedUser },
    @Body() body: { instrumentId: string; articleId: string },
  ) {
    const user = this.getUser(req);
    if (!body?.instrumentId || !body?.articleId) {
      throw new BadRequestException('instrumentId and articleId are required');
    }
    await this.requireWriteAccess(user);
    return this.markets.scoreArticleForInstrument({
      userId: user.id,
      instrumentId: body.instrumentId,
      articleId: body.articleId,
    });
  }

  @Post('predictors/score-batch')
  async scorePredictorBatch(
    @Req() req: { user?: AuthenticatedUser },
    @Body() body: { instrumentId: string; articleIds: string[] },
  ) {
    const user = this.getUser(req);
    if (!body?.instrumentId || !Array.isArray(body?.articleIds) || body.articleIds.length === 0) {
      throw new BadRequestException('instrumentId and articleIds (non-empty array) are required');
    }
    await this.requireWriteAccess(user);
    return this.markets.scoreArticleBatch({
      userId: user.id,
      instrumentId: body.instrumentId,
      articleIds: body.articleIds,
    });
  }

  @Get('predictors')
  async listPredictors(
    @Req() req: { user?: AuthenticatedUser },
    @Query('instrumentId') instrumentId: string,
    @Query('status') status?: 'active' | 'dismissed' | 'all',
  ) {
    const user = this.getUser(req);
    if (!instrumentId) {
      throw new BadRequestException('instrumentId is required');
    }
    const request: ListPredictorsInput = {
      userId: user.id,
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
    await this.requireWriteAccess(user);
    return this.markets.upsertPredictor({
      ...body,
      userId: user.id,
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
    await this.requireWriteAccess(user);
    return this.markets.enqueueRun({
      ...body,
      userId: user.id,
    });
  }

  @Get('runs')
  async listRuns(
    @Req() req: { user?: AuthenticatedUser },
    @Query('status') status?: RunStatus,
  ) {
    const user = this.getUser(req);
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
      userId: user.id,
      status,
    });
  }

  @Get('runs/:runId')
  async getRun(
    @Req() req: { user?: AuthenticatedUser },
    @Param('runId') runId: string,
    @Query('detail') detail?: string,
  ) {
    const user = this.getUser(req);
    if (!runId) throw new BadRequestException('runId is required');
    if (detail === 'true') {
      return this.markets.getRunDetail(user.id, runId);
    }
    return this.markets.getRun(user.id, runId);
  }

  @Post('runs/:runId/status')
  async updateRunStatus(
    @Req() req: { user?: AuthenticatedUser },
    @Param('runId') runId: string,
    @Body() body: { status: RunStatus; errorMessage?: string },
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
    await this.requireWriteAccess(user);
    return this.markets.updateRunStatus({
      userId: user.id,
      runId,
      status: body.status,
      errorMessage: body.errorMessage,
    });
  }

  @Post('runs/process-next')
  async processNextRun(
    @Req() req: { user?: AuthenticatedUser },
  ) {
    const user = this.getUser(req);
    await this.requireWriteAccess(user);
    return this.markets.processNextQueuedRun({
      userId: user.id,
    });
  }

  @Post('runs/process')
  async processRuns(
    @Req() req: { user?: AuthenticatedUser },
    @Body() body: { maxRuns?: number },
  ) {
    const user = this.getUser(req);
    await this.requireWriteAccess(user);
    if (
      body.maxRuns !== undefined &&
      (!Number.isInteger(body.maxRuns) || body.maxRuns < 1 || body.maxRuns > 100)
    ) {
      throw new BadRequestException('maxRuns must be an integer between 1 and 100');
    }
    return this.markets.processQueuedRuns({
      userId: user.id,
      maxRuns: body.maxRuns,
    });
  }

  // ─── Evaluation & Replay ───────────────────────────────────────

  @Post('runs/:runId/evaluate')
  async evaluateRun(
    @Req() req: { user?: AuthenticatedUser },
    @Param('runId') runId: string,
    @Body() body: { actualDirection: 'up' | 'down' | 'flat' },
  ) {
    const user = this.getUser(req);
    if (!runId || !body?.actualDirection) {
      throw new BadRequestException('runId and actualDirection are required');
    }
    await this.requireWriteAccess(user);
    return this.markets.evaluateRun({
      userId: user.id,
      runId,
      actualDirection: body.actualDirection,
    });
  }

  @Post('runs/:runId/replay')
  async replayRun(
    @Req() req: { user?: AuthenticatedUser },
    @Param('runId') runId: string,
    @Body() body: { scenario: string },
  ) {
    const user = this.getUser(req);
    if (!runId || !body?.scenario) {
      throw new BadRequestException('runId and scenario are required');
    }
    await this.requireWriteAccess(user);
    return this.markets.replayRun({
      userId: user.id,
      runId,
      scenario: body.scenario,
    });
  }

  // ─── Artifacts & Outcomes ──────────────────────────────────────

  @Get('runs/:runId/artifacts')
  async listRunArtifacts(
    @Req() req: { user?: AuthenticatedUser },
    @Param('runId') runId: string,
  ) {
    const user = this.getUser(req);
    if (!runId) {
      throw new BadRequestException('runId is required');
    }
    return this.markets.listRunArtifacts({
      userId: user.id,
      runId,
    });
  }

  @Get('predictions/dashboard')
  async getDashboardPredictions(
    @Req() req: { user?: AuthenticatedUser },
  ) {
    const user = this.getUser(req);
    return this.markets.getDashboardPredictions(user.id);
  }

  @Get('preferences/analysis')
  async getAnalysisPreferences(
    @Req() req: { user?: AuthenticatedUser },
  ) {
    const user = this.getUser(req);
    return this.analysisPreferences.getPreferences(user.id);
  }

  @Put('preferences/analysis')
  async updateAnalysisPreferences(
    @Req() req: { user?: AuthenticatedUser },
    @Body() body: Record<string, unknown>,
  ) {
    const user = this.getUser(req);
    await this.requireWriteAccess(user);
    return this.analysisPreferences.replacePreferences(user.id, body);
  }

  @Get('runs/:runId/trade-recommendation')
  async getTradeRecommendation(
    @Req() req: { user?: AuthenticatedUser },
    @Param('runId') runId: string,
  ) {
    const user = this.getUser(req);
    return this.markets.getTradeRecommendation(runId, user.id);
  }

  @Get('predictions')
  async listPredictions(
    @Req() req: { user?: AuthenticatedUser },
    @Query('runId') runId?: string,
    @Query('instrumentId') instrumentId?: string,
    @Query('role') role?: 'analyst' | 'arbitrator' | 'all',
    @Query('analystId') analystId?: string,
    @Query('authorUserId') authorUserId?: string,
    @Query('limit') limit?: string,
  ) {
    const user = this.getUser(req);
    if (role) {
      return this.markets.listPredictionsWithRole({
        userId: user.id,
        runId,
        instrumentId,
        role,
        analystId,
        authorUserId: authorUserId !== undefined ? (authorUserId || null) : undefined,
        limit: limit ? parseInt(limit, 10) : undefined,
      });
    }
    return this.markets.listPredictionOutcomes({
      userId: user.id,
      runId,
      instrumentId,
    });
  }

  @Get('risk-assessments')
  async listRiskAssessments(
    @Req() req: { user?: AuthenticatedUser },
    @Query('runId') runId?: string,
    @Query('instrumentId') instrumentId?: string,
    @Query('role') role?: string,
    @Query('analystId') analystId?: string,
    @Query('authorUserId') authorUserId?: string,
  ) {
    const user = this.getUser(req);
    if (!runId && !instrumentId) {
      return this.markets.getDashboardRiskSummary(user.id);
    }
    return this.markets.listRiskAssessments({
      userId: user.id,
      runId,
      instrumentId,
      role,
      analystId,
      authorUserId: authorUserId !== undefined ? (authorUserId || null) : undefined,
    });
  }

  @Get('runs/:runId/evaluations')
  async listRunEvaluations(
    @Req() req: { user?: AuthenticatedUser },
    @Param('runId') runId: string,
  ) {
    const user = this.getUser(req);
    if (!runId) {
      throw new BadRequestException('runId is required');
    }
    return this.markets.listRunEvaluations(
      user.id,
      runId,
    );
  }

  @Get('runs/:runId/replays')
  async listRunReplays(
    @Req() req: { user?: AuthenticatedUser },
    @Param('runId') runId: string,
  ) {
    const user = this.getUser(req);
    if (!runId) {
      throw new BadRequestException('runId is required');
    }
    return this.markets.listRunReplays(
      user.id,
      runId,
    );
  }

  // ─── Risk Details ──────────────────────────────────────────────

  @Get('risk-dimensions')
  async listRiskDimensions(
    @Req() req: { user?: AuthenticatedUser },
  ) {
    const user = this.getUser(req);
    return this.markets.listRiskDimensions(user.id);
  }

  @Post('risk-dimensions')
  async upsertRiskDimension(
    @Req() req: { user?: AuthenticatedUser },
    @Body() body: {
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
    await this.requireWriteAccess(user);
    return this.markets.upsertRiskDimension({
      userId: user.id,
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
  ) {
    const user = this.getUser(req);
    if (!runId) throw new BadRequestException('runId is required');
    return this.markets.getRunRiskDetails(user.id, runId);
  }

  @Get('instruments/:instrumentId/composite-score')
  async getInstrumentCompositeScore(
    @Req() req: { user?: AuthenticatedUser },
    @Param('instrumentId') instrumentId: string,
  ) {
    const user = this.getUser(req);
    if (!instrumentId) throw new BadRequestException('instrumentId is required');
    return this.markets.getInstrumentCompositeScore(user.id, instrumentId);
  }

  // ─── Admin: Learning & Evaluation ──────────────────────────────

  // ─── Learning Proposals ─────────────────────────────────────────

  @Get('learning/proposals')
  async listLearningProposals(
    @Req() req: { user?: AuthenticatedUser },
    @Query('status') status?: string,
    @Query('tier') tier?: string,
  ) {
    const user = this.getUser(req);
    const tierNum = tier ? Number(tier) : undefined;
    return this.markets.listLearningProposals(user.id, status, tierNum);
  }

  @Get('learning/proposals/:proposalId')
  async getProposalDetail(
    @Req() req: { user?: AuthenticatedUser },
    @Param('proposalId') proposalId: string,
  ) {
    const user = this.getUser(req);
    return this.markets.getProposalDetail(user.id, proposalId);
  }

  @Post('learning/proposals/:proposalId/approve')
  async approveProposal(
    @Req() req: { user?: AuthenticatedUser },
    @Param('proposalId') proposalId: string,
  ) {
    const user = this.getUser(req);
    if (!proposalId) throw new BadRequestException('proposalId is required');
    await this.requireWriteAccess(user);
    return this.markets.approveProposal(user.id, proposalId);
  }

  @Post('learning/proposals/:proposalId/reject')
  async rejectProposal(
    @Req() req: { user?: AuthenticatedUser },
    @Param('proposalId') proposalId: string,
    @Body() body: { reason?: string },
  ) {
    const user = this.getUser(req);
    if (!proposalId) throw new BadRequestException('proposalId is required');
    await this.requireWriteAccess(user);
    return this.markets.rejectProposal(user.id, proposalId, body.reason);
  }

  @Get('learning/reports')
  async listLearningReports(
    @Req() req: { user?: AuthenticatedUser },
    @Query('limit') limit?: string,
  ) {
    const user = this.getUser(req);
    const parsedLimit = limit ? Math.min(50, Math.max(1, Number(limit) || 10)) : 10;
    return this.markets.listLearningReports(user.id, parsedLimit);
  }

  // ─── Portfolios ────────────────────────────────────────────────

  @Get('portfolios/analysts')
  async listAnalystPortfolios(@Req() req: { user?: AuthenticatedUser }) {
    this.getUser(req);
    return this.analystPortfolio.listPortfolios();
  }

  @Get('portfolios/analysts/:analystId')
  async getAnalystPortfolio(
    @Req() req: { user?: AuthenticatedUser },
    @Param('analystId') analystId: string,
  ) {
    this.getUser(req);
    return this.analystPortfolio.getPortfolio(analystId);
  }

  @Get('portfolios/analysts/:analystId/positions')
  async listAnalystPositions(
    @Req() req: { user?: AuthenticatedUser },
    @Param('analystId') analystId: string,
    @Query('status') status?: string,
  ) {
    this.getUser(req);
    return this.analystPortfolio.listPositions(analystId, status);
  }

  @Get('portfolios/leaderboard')
  async getLeaderboard(@Req() req: { user?: AuthenticatedUser }) {
    this.getUser(req);
    return this.analystPortfolio.getLeaderboard();
  }

  @Get('portfolios/me')
  async getMyPortfolio(@Req() req: { user?: AuthenticatedUser }) {
    const user = this.getUser(req);
    return this.userPortfolio.ensurePortfolio(user.id);
  }

  @Get('portfolios/me/positions')
  async getMyPositions(
    @Req() req: { user?: AuthenticatedUser },
    @Query('status') status?: string,
  ) {
    const user = this.getUser(req);
    return this.userPortfolio.listPositions(user.id, status);
  }

  @Get('portfolios/me/queue')
  async getMyTradeQueue(@Req() req: { user?: AuthenticatedUser }) {
    const user = this.getUser(req);
    return this.userPortfolio.getQueuedTrades(user.id);
  }

  @Get('portfolios/me/trade-destinations')
  async getTradeDestinations(
    @Req() req: { user?: AuthenticatedUser },
    @Query('instrumentId') instrumentId?: string,
    @Query('symbol') symbol?: string,
  ) {
    const user = this.getUser(req);
    if (!instrumentId || !symbol) {
      throw new BadRequestException('instrumentId and symbol are required');
    }
    return this.userPortfolio.getTradeDestinations({
      userId: user.id,
      instrumentId,
      symbol,
    });
  }

  @Post('portfolios/me/queue-trade')
  async queueTrade(
    @Req() req: { user?: AuthenticatedUser },
    @Body() body: {
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
    await this.requireWriteAccess(user);
    return this.userPortfolio.queueTrade({
      userId: user.id,
      predictionId: body.predictionId,
      instrumentId: body.instrumentId,
      symbol: body.symbol,
      direction: body.direction,
      quantity: body.quantity,
    });
  }

  @Post('portfolios/me/execute-trade')
  async executeTrade(
    @Req() req: { user?: AuthenticatedUser },
    @Body() body: {
      predictionId: string;
      instrumentId: string;
      direction: 'long' | 'short';
      quantity: number;
    },
  ) {
    const user = this.getUser(req);
    if (!body?.predictionId || !body?.instrumentId || !body?.direction || !body?.quantity) {
      throw new BadRequestException('predictionId, instrumentId, direction, and quantity are required');
    }
    await this.requireWriteAccess(user);

    // Disclaimer-ack guard — same shape as confirmTrade in markets.service.ts.
    await this.userPortfolio.ensurePortfolio(user.id);
    const ack = await this.userPortfolio.isDisclaimerAcknowledged(user.id);
    if (!ack) return { requiresDisclaimer: true };

    return this.userPortfolio.executeImmediate({
      userId: user.id,
      predictionId: body.predictionId,
      instrumentId: body.instrumentId,
      direction: body.direction,
      quantity: body.quantity,
    });
  }

  @Post('portfolios/me/execute-destinations')
  async executeTradeDestinations(
    @Req() req: { user?: AuthenticatedUser },
    @Body() body: {
      predictionId: string;
      instrumentId: string;
      direction: 'long' | 'short';
      destinations: Array<{
        destinationType: 'user' | 'tournament';
        portfolioId?: string;
        tournamentId?: string;
        quantity: number;
      }>;
    },
  ) {
    const user = this.getUser(req);
    if (!body?.predictionId || !body?.instrumentId || !body?.direction || !Array.isArray(body?.destinations)) {
      throw new BadRequestException('predictionId, instrumentId, direction, and destinations are required');
    }
    await this.requireWriteAccess(user);

    await this.userPortfolio.ensurePortfolio(user.id);
    const ack = await this.userPortfolio.isDisclaimerAcknowledged(user.id);
    if (!ack) return { requiresDisclaimer: true };

    return this.userPortfolio.executeTradeDestinations({
      userId: user.id,
      predictionId: body.predictionId,
      instrumentId: body.instrumentId,
      direction: body.direction,
      destinations: body.destinations,
    });
  }

  @Post('portfolios/me/positions/:positionId/close')
  async closeMyPosition(
    @Req() req: { user?: AuthenticatedUser },
    @Param('positionId') positionId: string,
  ) {
    const user = this.getUser(req);
    await this.requireWriteAccess(user);
    return this.userPortfolio.closePosition({ userId: user.id, positionId });
  }

  @Get('portfolios')
  async getAllPortfolios(@Req() req: { user?: AuthenticatedUser }) {
    this.getUser(req);
    return this.leaderboard.getAllPortfoliosSummary();
  }

  @Get('portfolios/:kind/:id')
  async getPortfolioDetail(
    @Req() req: { user?: AuthenticatedUser },
    @Param('kind') kind: string,
    @Param('id') id: string,
    @Query('days') days?: string,
  ) {
    this.getUser(req);
    const daysNum = days ? Number(days) : undefined;
    return this.leaderboard.getPortfolioDetail({ kind, id, days: daysNum });
  }

  @Post('portfolios/me/queue-trade/:tradeId/cancel')
  async cancelTrade(
    @Req() req: { user?: AuthenticatedUser },
    @Param('tradeId') tradeId: string,
  ) {
    const user = this.getUser(req);
    await this.requireWriteAccess(user);
    await this.userPortfolio.cancelTrade(tradeId, user.id);
    return { cancelled: true };
  }

  // ─── Prediction Provenance & Challenges ──────────────────────────

  @Get('predictions/:predictionId/provenance')
  async getPredictionProvenance(
    @Req() req: { user?: AuthenticatedUser },
    @Param('predictionId') predictionId: string,
  ) {
    const user = this.getUser(req);
    return this.markets.getPredictionProvenance(user.id, predictionId);
  }

  // Effort: see-your-reasoning. Returns the captured LLM call(s) backing the
  // prediction so the modal's Reasoning tab can render the model's thinking.
  // See markets.service.ts:getPredictionLlmCalls for the IDOR-safe SQL.
  @Get('predictions/:predictionId/llm-calls')
  async getPredictionLlmCalls(
    @Req() req: { user?: AuthenticatedUser },
    @Param('predictionId') predictionId: string,
  ) {
    const user = this.getUser(req);
    return this.markets.getPredictionLlmCalls(user.id, predictionId);
  }

  // Effort: calibration-drilldown. Returns headline metrics, per-instrument
  // breakdown, and the resolved-prediction history (wrong-first) for one
  // analyst. Backs AnalystPerformanceView's calibration section.
  @Get('analysts/:analystId/calibration')
  async getAnalystCalibration(
    @Req() req: { user?: AuthenticatedUser },
    @Param('analystId') analystId: string,
  ) {
    const user = this.getUser(req);
    return this.markets.getAnalystCalibration(user.id, analystId);
  }

  @Post('predictions/:predictionId/challenge')
  async challengePrediction(
    @Req() req: { user?: AuthenticatedUser },
    @Param('predictionId') predictionId: string,
    @Res() res: any,
  ) {
    const user = this.getUser(req);
    await this.requireWriteAccess(user);

    // Stream results as each analyst completes
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    try {
      for await (const challenge of this.markets.challengePredictionStream(user.id, predictionId)) {
        res.write(`data: ${JSON.stringify(challenge)}\n\n`);
      }
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    } catch (err) {
      res.write(`data: ${JSON.stringify({ error: err instanceof Error ? err.message : String(err) })}\n\n`);
    }
    res.end();
  }

  @Get('predictions/:predictionId/challenges')
  async getChallenges(
    @Req() req: { user?: AuthenticatedUser },
    @Param('predictionId') predictionId: string,
  ) {
    const user = this.getUser(req);
    return this.markets.getChallenges(user.id, predictionId);
  }

  // ─── Trade Decisions ─────────────────────────────────────────────

  @Post('trades/acknowledge-disclaimer')
  async acknowledgeDisclaimer(
    @Req() req: { user?: AuthenticatedUser },
  ) {
    const user = this.getUser(req);
    await this.requireWriteAccess(user);
    return this.markets.acknowledgeDisclaimer(user.id);
  }

  @Post('trades/confirm')
  async confirmTrade(
    @Req() req: { user?: AuthenticatedUser },
    @Body() body: { predictionId: string; analystId: string; direction: string },
  ) {
    const user = this.getUser(req);
    if (!body?.predictionId || !body?.direction) {
      throw new BadRequestException('predictionId and direction are required');
    }
    await this.requireWriteAccess(user);
    return this.markets.confirmTrade(user.id, body);
  }

  @Post('trades/skip')
  async skipTrade(
    @Req() req: { user?: AuthenticatedUser },
    @Body() body: { predictionId: string },
  ) {
    const user = this.getUser(req);
    if (!body?.predictionId) {
      throw new BadRequestException('predictionId is required');
    }
    await this.requireWriteAccess(user);
    return this.markets.skipTrade(user.id, body.predictionId);
  }

  @Get('trades/decisions')
  async getTradeDecisions(
    @Req() req: { user?: AuthenticatedUser },
  ) {
    const user = this.getUser(req);
    return this.markets.getTradeDecisions(user.id);
  }

  // ─── Affinity ─────────────────────────────────────────────────

  @Get('affinity')
  async getAffinityProfile(@Req() req: { user?: AuthenticatedUser }) {
    const user = this.getUser(req);
    const affinities = await this.affinityService.getUserAffinityProfile(user.id);
    return { affinities };
  }

  @Get('affinity/alerts')
  async getContrarianAlerts(
    @Req() req: { user?: AuthenticatedUser },
    @Query('unread_only') unreadOnly?: string,
  ) {
    const user = this.getUser(req);
    const alerts = await this.affinityService.getContrarianAlerts(
      user.id,
      unreadOnly === 'true',
    );
    return { alerts };
  }

  @Post('affinity/signals/browse')
  @HttpCode(204)
  async recordBrowseSignal(
    @Req() req: { user?: AuthenticatedUser },
    @Body() body: { analyst_id: string },
  ) {
    const user = this.getUser(req);
    await this.requireWriteAccess(user);
    if (!body?.analyst_id) {
      throw new BadRequestException('analyst_id is required');
    }
    await this.affinityService.recordSignal(user.id, body.analyst_id, 'browse_interest');
  }

  @Patch('affinity/alerts/:id/read')
  async markAlertRead(
    @Req() req: { user?: AuthenticatedUser },
    @Param('id') alertId: string,
  ) {
    const user = this.getUser(req);
    await this.requireWriteAccess(user);
    await this.affinityService.markAlertRead(alertId, user.id);
    return { success: true };
  }

  // ─── Notifications ───────────────────────────────────────────────

  @Get('notifications')
  async getNotifications(
    @Req() req: { user?: AuthenticatedUser },
    @Query('unread_only') unreadOnly?: string,
  ) {
    const user = this.getUser(req);
    const notifications = await this.notificationService.getNotifications(
      user.id,
      unreadOnly === 'true',
    );
    return { notifications };
  }

  @Get('notifications/unread-count')
  async getNotificationUnreadCount(@Req() req: { user?: AuthenticatedUser }) {
    const user = this.getUser(req);
    const count = await this.notificationService.getUnreadCount(user.id);
    return { count };
  }

  @Patch('notifications/:id/read')
  @HttpCode(204)
  async markNotificationRead(
    @Req() req: { user?: AuthenticatedUser },
    @Param('id') id: string,
  ) {
    const user = this.getUser(req);
    await this.requireWriteAccess(user);
    await this.notificationService.markRead(id, user.id);
  }

  @Patch('notifications/read-all')
  @HttpCode(204)
  async markAllNotificationsRead(@Req() req: { user?: AuthenticatedUser }) {
    const user = this.getUser(req);
    await this.requireWriteAccess(user);
    await this.notificationService.markAllRead(user.id);
  }

  // ─── Fear/Greed Alerts ──────────────────────────────────────────

  @Get('fear-greed-alerts')
  async getFearGreedAlerts(
    @Req() req: { user?: AuthenticatedUser },
    @Query('unread_only') unreadOnly?: string,
  ) {
    const user = this.getUser(req);
    const alerts = await this.fearGreedAlertService.getAlerts(
      user.id,
      unreadOnly === 'true',
    );
    return { alerts };
  }

  @Get('fear-greed-alerts/unread-count')
  async getFearGreedUnreadCount(@Req() req: { user?: AuthenticatedUser }) {
    const user = this.getUser(req);
    const count = await this.fearGreedAlertService.getUnreadCount(user.id);
    return { count };
  }

  @Patch('fear-greed-alerts/:id/read')
  @HttpCode(204)
  async markFearGreedRead(
    @Req() req: { user?: AuthenticatedUser },
    @Param('id') id: string,
  ) {
    const user = this.getUser(req);
    await this.requireWriteAccess(user);
    await this.fearGreedAlertService.markRead(id, user.id);
  }

  @Patch('fear-greed-alerts/read-all')
  @HttpCode(204)
  async markAllFearGreedRead(@Req() req: { user?: AuthenticatedUser }) {
    const user = this.getUser(req);
    await this.requireWriteAccess(user);
    await this.fearGreedAlertService.markAllRead(user.id);
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

  @Post('instruments/:instrumentId/rerun-risk')
  async rerunRisk(
    @Req() req: { user?: AuthenticatedUser },
    @Param('instrumentId') instrumentId: string,
  ) {
    const user = this.getUser(req);
    await this.requireWriteAccess(user);
    // All pipeline runs use __base__ — instruments and analysts are base-level
    const enqueued = await this.markets.enqueueRun({
      userId: user.id,
      instrumentId,
      runType: 'risk',
    });
    const processed = await this.markets.processNextQueuedRun({
      userId: user.id,
      runId: enqueued.runId,
      runType: 'risk',
    });
    return { enqueued, processed };
  }

  @Get('risk-debates/:debateId/reasoning')
  async getDebateReasoning(
    @Req() req: { user?: AuthenticatedUser },
    @Param('debateId') debateId: string,
  ) {
    this.getUser(req);
    return this.markets.getDebateReasoning(debateId);
  }

  @Post('runs/:runId/rerun-debate')
  async rerunDebate(
    @Req() req: { user?: AuthenticatedUser },
    @Param('runId') runId: string,
  ) {
    const user = this.getUser(req);
    await this.requireWriteAccess(user);
    return this.markets.rerunDebate(user.id, runId);
  }

  // ─── Admin: Settlement, Learning & Evaluation ─────────────────

  @Post('admin/run-settlement')
  async triggerSettlement(@Req() req: { user?: AuthenticatedUser }) {
    const user = this.getUser(req);
    await this.requireAdmin(user);
    return this.eodSettlement.runSettlement();
  }

  @Post('admin/run-nightly-evaluation')
  async triggerNightlyEvaluation(@Req() req: { user?: AuthenticatedUser }) {
    const user = this.getUser(req);
    await this.requireAdmin(user);
    return this.nightlyEvaluation.runNightlyEvaluation();
  }

  @Post('admin/run-learning-cycle')
  async triggerLearningCycle(@Req() req: { user?: AuthenticatedUser }) {
    const user = this.getUser(req);
    await this.requireAdmin(user);
    return this.learningEngine.runLearningCycle();
  }

  // ─── Tier 2 Audit (effort: tier-2-audit) ─────────────────────

  @Get('audit/findings')
  async getAuditFindings(
    @Req() req: { user?: AuthenticatedUser },
  ) {
    const user = this.getUser(req);
    const findings = await this.audit.getFindings(user.id);
    return { findings };
  }

  @Post('audit/findings/:findingId/review')
  async reviewAuditFinding(
    @Req() req: { user?: AuthenticatedUser },
    @Param('findingId') findingId: string,
    @Body() body: { action: string; reviewText?: string },
  ) {
    const user = this.getUser(req);
    await this.requireWriteAccess(user);
    return this.audit.reviewFinding(user.id, findingId, body.action, body.reviewText);
  }

  @Get('audit/policy')
  async getAuditPolicy(
    @Req() req: { user?: AuthenticatedUser },
  ) {
    this.getUser(req);
    const policy = await this.audit.getAuditPolicy();
    return { policy };
  }

  // Effort: automated-meta-loop. Trigger policy generation manually.
  @Post('admin/run-audit-policy-update')
  async triggerAuditPolicyUpdate(@Req() req: { user?: AuthenticatedUser }) {
    const user = this.getUser(req);
    await this.requireAdmin(user);
    return this.audit.updateAuditPolicy();
  }

  // Effort: tier-2-audit. Trigger the Tier 2 audit cycle manually.
  @Post('admin/run-tier2-audit')
  async triggerTier2Audit(@Req() req: { user?: AuthenticatedUser }) {
    const user = this.getUser(req);
    await this.requireAdmin(user);
    return this.audit.runAuditCycle();
  }

  // Effort: tier3-strategic-overhauls. Trigger the Tier 3 overhaul cycle manually.
  @Post('admin/run-tier3-overhaul')
  async triggerTier3Overhaul(@Req() req: { user?: AuthenticatedUser }) {
    const user = this.getUser(req);
    await this.requireAdmin(user);
    return this.strategicOverhaul.runStrategicOverhaulCycle();
  }

  @Post('admin/run-crawl')
  async triggerCrawl(@Req() req: { user?: AuthenticatedUser }) {
    const user = this.getUser(req);
    await this.requireAdmin(user);
    return this.crawler.runCrawl();
  }

  @Post('admin/run-predictor-generation')
  async triggerPredictorGeneration(@Req() req: { user?: AuthenticatedUser }) {
    const user = this.getUser(req);
    await this.requireAdmin(user);
    return this.predictorGenerator.runGeneration();
  }

  @Post('admin/run-prediction-generation')
  async triggerPredictionGeneration(@Req() req: { user?: AuthenticatedUser }) {
    const user = this.getUser(req);
    await this.requireAdmin(user);
    return this.predictionGenerator.runGeneration();
  }

  @Post('admin/run-outcome-tracking')
  async triggerOutcomeTracking(@Req() req: { user?: AuthenticatedUser }) {
    const user = this.getUser(req);
    await this.requireAdmin(user);
    return this.outcomeTracking.runTracking();
  }

  @Post('admin/run-stop-loss-sweep')
  async triggerStopLossSweep(@Req() req: { user?: AuthenticatedUser }) {
    const user = this.getUser(req);
    await this.requireAdmin(user);
    return this.stopLossWatcher.sweep();
  }

  @Post('portfolios/admin/monthly-reset')
  async triggerMonthlyReset(@Req() req: { user?: AuthenticatedUser }) {
    const user = this.getUser(req);
    await this.requireAdmin(user);
    return this.monthlyReset.runReset({ manual: true });
  }

  @Post('admin/run-daily-snapshots')
  async triggerDailySnapshots(@Req() req: { user?: AuthenticatedUser }) {
    const user = this.getUser(req);
    await this.requireAdmin(user);
    const prices = await this.eodSettlement.captureClosingPrices();
    return this.eodSettlement.writeDailySnapshots(prices);
  }

  @Post('admin/run-benchmark-ingest')
  async triggerBenchmarkIngest(@Req() req: { user?: AuthenticatedUser }) {
    const user = this.getUser(req);
    await this.requireAdmin(user);
    return this.benchmarkIngest.ingestSpy();
  }

  // Deprecated: prefer POST /markets/admin/day-trader/run-now which also
  // refreshes intraday bars, respects market hours, and writes an audit row.
  @Post('admin/run-day-trader-strategies')
  async triggerDayTraderStrategies(@Req() req: { user?: AuthenticatedUser }) {
    const user = this.getUser(req);
    await this.requireAdmin(user);
    return this.dayTraderRunner.runStrategies();
  }

  @Post('admin/day-trader/run-now')
  async triggerDayTraderRunNow(@Req() req: { user?: AuthenticatedUser }) {
    const user = this.getUser(req);
    await this.requireAdmin(user);
    return this.dayTraderScheduler.handleCron({ manual: true });
  }

  @Post('admin/run-eod-forced-buy')
  async triggerEodForcedBuy(@Req() req: { user?: AuthenticatedUser }) {
    const user = this.getUser(req);
    await this.requireAdmin(user);
    return this.eodForcedBuy.runSweep({ manual: true });
  }

  @Post('admin/run-pipeline')
  async triggerFullPipeline(@Req() req: { user?: AuthenticatedUser }) {
    const user = this.getUser(req);
    await this.requireAdmin(user);
    return this.analystPipeline.runPipeline();
  }

  // ─── Coordination ───────────────────────────────────────────

  @Post('coordination/compute')
  async triggerCoordinationCompute(@Req() req: { user?: AuthenticatedUser }) {
    const user = this.getUser(req);
    await this.requireWriteAccess(user);
    return this.coordination.computeAll();
  }

  @Get('coordination/correlations')
  async getCorrelations(
    @Req() req: { user?: AuthenticatedUser },
    @Query('period') period?: string,
    @Query('instrument_id') instrumentId?: string,
    @Query('flagOnly') flagOnly?: string,
  ) {
    this.getUser(req);
    return this.coordination.getCorrelations(
      period || '30d',
      instrumentId || undefined,
      flagOnly === 'true',
    );
  }

  @Get('coordination/coverage')
  async getCoverage(
    @Req() req: { user?: AuthenticatedUser },
    @Query('period') period?: string,
    @Query('gapsOnly') gapsOnly?: string,
  ) {
    this.getUser(req);
    return this.coordination.getCoverage(
      period || '30d',
      gapsOnly === 'true',
    );
  }

  @Get('coordination/contributions')
  async getContributions(
    @Req() req: { user?: AuthenticatedUser },
    @Query('period') period?: string,
    @Query('instrument_id') instrumentId?: string,
  ) {
    this.getUser(req);
    return this.coordination.getContributions(
      period || '30d',
      instrumentId || undefined,
    );
  }

  // ─── Performance Dashboard ──────────────────────────────────

  @Get('performance')
  async getPerformanceDashboard(
    @Req() req: { user?: AuthenticatedUser },
    @Query('days') daysParam?: string,
  ) {
    const user = this.getUser(req);
    const days = Math.max(1, Math.min(365, Number(daysParam) || 30));
    return this.performance.getDashboardData(user.id, days);
  }

  // ─── Wiring (analyst↔instrument assignments) ───────────────

  @Get('wiring/mine')
  async listMyWirings(@Req() req: { user?: AuthenticatedUser }) {
    const user = this.getUser(req);
    return this.wiring.listMyWirings(user.id);
  }

  @Post('wiring')
  async addWiring(
    @Req() req: { user?: AuthenticatedUser },
    @Body() body: { analystId: string; instrumentId: string },
  ) {
    const user = this.getUser(req);
    if (!body?.analystId || !body?.instrumentId) {
      throw new BadRequestException('analystId and instrumentId are required');
    }
    return this.wiring.addWiring(user.id, body.analystId, body.instrumentId);
  }

  @Post('wiring/remove')
  async removeWiring(
    @Req() req: { user?: AuthenticatedUser },
    @Body() body: { analystId: string; instrumentId: string },
  ) {
    const user = this.getUser(req);
    if (!body?.analystId || !body?.instrumentId) {
      throw new BadRequestException('analystId and instrumentId are required');
    }
    return this.wiring.removeWiring(user.id, body.analystId, body.instrumentId);
  }

  // ─── Triple Enablement (portfolio composition) ──────────────

  @Get('portfolio/enabled-triples')
  async listEnabledTriples(@Req() req: { user?: AuthenticatedUser }) {
    const user = this.getUser(req);
    return this.enablement.listEnabledTriples(user.id);
  }

  @Post('portfolio/enable-triple')
  async enableTriple(
    @Req() req: { user?: AuthenticatedUser },
    @Body() body: { analystId: string; instrumentId: string; authorUserId?: string },
  ) {
    const user = this.getUser(req);
    await this.requireWriteAccess(user);
    if (!body?.analystId || !body?.instrumentId) {
      throw new BadRequestException('analystId and instrumentId are required');
    }
    return this.enablement.enableTriple(user.id, body.analystId, body.instrumentId, body.authorUserId);
  }

  @Post('portfolio/disable-triple')
  async disableTriple(
    @Req() req: { user?: AuthenticatedUser },
    @Body() body: { analystId: string; instrumentId: string; authorUserId?: string },
  ) {
    const user = this.getUser(req);
    await this.requireWriteAccess(user);
    if (!body?.analystId || !body?.instrumentId) {
      throw new BadRequestException('analystId and instrumentId are required');
    }
    await this.enablement.disableTriple(user.id, body.analystId, body.instrumentId, body.authorUserId);
    return { disabled: true };
  }

  @Get('portfolio/available-triples')
  async listAvailableTriples(
    @Req() req: { user?: AuthenticatedUser },
    @Query('instrumentId') instrumentId?: string,
  ) {
    const user = this.getUser(req);
    return this.enablement.listAvailableTriples(user.id, instrumentId || undefined);
  }

  // ─── Messaging ──────────────────────────────────────────────

  @Post('messaging/channels')
  async createChannel(
    @Req() req: { user?: AuthenticatedUser },
    @Body() body: { scope: ChannelScope; scope_id?: string; name?: string },
  ) {
    const user = this.getUser(req);
    await this.requireWriteAccess(user);
    const channel = await this.messaging.createChannel(body.scope, body.scope_id, body.name);
    await this.messaging.addChannelMember(channel.id, user.id, 'admin');
    return { data: channel };
  }

  @Get('messaging/channels')
  async listChannels(@Req() req: { user?: AuthenticatedUser }) {
    const user = this.getUser(req);
    const channels = await this.messaging.listChannels(user.id);
    return { data: channels };
  }

  @Get('messaging/channels/:channelId')
  async getChannel(
    @Req() req: { user?: AuthenticatedUser },
    @Param('channelId') channelId: string,
  ) {
    const user = this.getUser(req);
    const channel = await this.messaging.getChannel(channelId, user.id);
    return { data: channel };
  }

  @Post('messaging/channels/:channelId/messages')
  async sendMessage(
    @Req() req: { user?: AuthenticatedUser },
    @Param('channelId') channelId: string,
    @Body() body: {
      body: string;
      parent_message_id?: string;
      attached_entity_type?: string;
      attached_entity_id?: string;
    },
  ) {
    const user = this.getUser(req);
    await this.requireWriteAccess(user);
    const message = await this.messaging.sendMessage(channelId, user.id, body.body, {
      parent_message_id: body.parent_message_id,
      attached_entity_type: body.attached_entity_type as any,
      attached_entity_id: body.attached_entity_id,
    });
    return { data: message };
  }

  @Get('messaging/channels/:channelId/messages')
  async listMessages(
    @Req() req: { user?: AuthenticatedUser },
    @Param('channelId') channelId: string,
    @Query('before') before?: string,
    @Query('limit') limitParam?: string,
  ) {
    const user = this.getUser(req);
    const limit = limitParam ? Math.max(1, Math.min(100, Number(limitParam))) : undefined;
    return this.messaging.listMessages(channelId, user.id, { before, limit });
  }

  @Post('messaging/channels/dm')
  async createDmChannel(
    @Req() req: { user?: AuthenticatedUser },
    @Body() body: { target_user_id: string },
  ) {
    const user = this.getUser(req);
    await this.requireWriteAccess(user);
    const channel = await this.messaging.getOrCreateDmChannel(user.id, body.target_user_id);
    return { data: channel };
  }

  @Patch('messaging/channels/:channelId/read')
  async markChannelRead(
    @Req() req: { user?: AuthenticatedUser },
    @Param('channelId') channelId: string,
  ) {
    const user = this.getUser(req);
    await this.messaging.updateLastRead(channelId, user.id);
    return { success: true };
  }

  @Get('messaging/unread-counts')
  async getUnreadCounts(@Req() req: { user?: AuthenticatedUser }) {
    const user = this.getUser(req);
    const counts = await this.messaging.getUnreadCounts(user.id);
    return { data: counts };
  }

  @Post('messaging/blocks')
  async blockUser(
    @Req() req: { user?: AuthenticatedUser },
    @Body() body: { blocked_id: string },
  ) {
    const user = this.getUser(req);
    await this.requireWriteAccess(user);
    await this.messaging.blockUser(user.id, body.blocked_id);
    return { success: true };
  }

  @Delete('messaging/blocks/:blockedId')
  async unblockUser(
    @Req() req: { user?: AuthenticatedUser },
    @Param('blockedId') blockedId: string,
  ) {
    const user = this.getUser(req);
    await this.requireWriteAccess(user);
    await this.messaging.unblockUser(user.id, blockedId);
    return { success: true };
  }

  @Get('messaging/channels/:channelId/threads/:messageId')
  async getThreadReplies(
    @Req() req: { user?: AuthenticatedUser },
    @Param('channelId') channelId: string,
    @Param('messageId') messageId: string,
  ) {
    const user = this.getUser(req);
    const replies = await this.messaging.getThreadReplies(channelId, messageId, user.id);
    return { data: replies };
  }

  @Post('messaging/messages/:messageId/reactions')
  async addReaction(
    @Req() req: { user?: AuthenticatedUser },
    @Param('messageId') messageId: string,
    @Body() body: { emoji: string },
  ) {
    const user = this.getUser(req);
    await this.requireWriteAccess(user);
    await this.messaging.addReaction(messageId, user.id, body.emoji);
    return { success: true };
  }

  @Delete('messaging/messages/:messageId/reactions/:emoji')
  async removeReaction(
    @Req() req: { user?: AuthenticatedUser },
    @Param('messageId') messageId: string,
    @Param('emoji') emoji: string,
  ) {
    const user = this.getUser(req);
    await this.requireWriteAccess(user);
    await this.messaging.removeReaction(messageId, user.id, decodeURIComponent(emoji));
    return { success: true };
  }

  @Patch('messaging/messages/:messageId/pin')
  async togglePin(
    @Req() req: { user?: AuthenticatedUser },
    @Param('messageId') messageId: string,
  ) {
    const user = this.getUser(req);
    await this.requireWriteAccess(user);
    const result = await this.messaging.togglePin(messageId, user.id);
    return { data: result };
  }

  @Get('messaging/channels/:channelId/pinned')
  async getPinnedMessages(
    @Req() req: { user?: AuthenticatedUser },
    @Param('channelId') channelId: string,
  ) {
    const user = this.getUser(req);
    const messages = await this.messaging.getPinnedMessages(channelId, user.id);
    return { data: messages };
  }

  @Delete('messaging/channels/:channelId/messages/:messageId')
  async deleteMessage(
    @Req() req: { user?: AuthenticatedUser },
    @Param('channelId') channelId: string,
    @Param('messageId') messageId: string,
  ) {
    const user = this.getUser(req);
    await this.requireWriteAccess(user);
    await this.messaging.deleteMessage(messageId, channelId, user.id, user.role);
    return { success: true };
  }

  @Get('messaging/users')
  async searchMessagingUsers(
    @Req() req: { user?: AuthenticatedUser },
    @Query('q') query?: string,
  ) {
    const user = this.getUser(req);
    const users = await this.messaging.searchUsers(query || '', user.id);
    return { data: users };
  }

  @Get('reports/daily-analyst-summary')
  async getDailyAnalystSummary(@Req() req: { user?: AuthenticatedUser }) {
    const user = this.getUser(req);
    return this.markets.getDailyAnalystSummary(user.id);
  }

  @SkipReadOnly()
  @Post('chat/ask')
  async chatAsk(
    @Req() req: { user?: AuthenticatedUser },
    @Body() body: { message: string; instrumentId?: string },
  ) {
    const user = this.getUser(req);
    return this.learningPanel.createLegacyReply(user.id, body.message, body.instrumentId);
  }

  // ─── LLM Usage Endpoints ────────────────────────────────────

  @Get('usage/summary')
  async usageSummary(
    @Req() req: { user?: AuthenticatedUser },
    @Query('userId') userId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('stage') stage?: string,
    @Query('model') model?: string,
  ) {
    const user = this.getUser(req);
    await this.requireAdmin(user);
    return this.usageQuery.getSummary({ userId, startDate, endDate, stage, model });
  }

  @Get('usage/by-user')
  async usageByUser(
    @Req() req: { user?: AuthenticatedUser },
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
  ) {
    const user = this.getUser(req);
    await this.requireAdmin(user);
    return this.usageQuery.getByUser(startDate, endDate);
  }

  @Get('usage/by-stage')
  async usageByStage(
    @Req() req: { user?: AuthenticatedUser },
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
  ) {
    const user = this.getUser(req);
    await this.requireAdmin(user);
    return this.usageQuery.getByStage(startDate, endDate);
  }

  @Get('usage/by-model')
  async usageByModel(
    @Req() req: { user?: AuthenticatedUser },
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
  ) {
    const user = this.getUser(req);
    await this.requireAdmin(user);
    return this.usageQuery.getByModel(startDate, endDate);
  }

  @Get('usage/by-triple')
  async usageByTriple(
    @Req() req: { user?: AuthenticatedUser },
    @Query('userId') userId: string,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
  ) {
    const user = this.getUser(req);
    await this.requireAdmin(user);
    return this.usageQuery.getByTriple(userId, startDate, endDate);
  }

  @Get('usage/base-vs-extension')
  async usageBaseVsExtension(
    @Req() req: { user?: AuthenticatedUser },
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
  ) {
    const user = this.getUser(req);
    await this.requireAdmin(user);
    return this.usageQuery.getBaseVsExtension(startDate, endDate);
  }

  @Get('usage/my-usage')
  async usageMyUsage(
    @Req() req: { user?: AuthenticatedUser },
  ) {
    const user = this.getUser(req);
    return this.usageQuery.getMyUsage(user.id);
  }
}
