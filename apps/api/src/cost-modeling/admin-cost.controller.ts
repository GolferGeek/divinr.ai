import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { DATABASE_SERVICE, type DatabaseService } from '@orchestratorai/planes/database';
import { CostCalibrationService } from './cost-calibration.service';
import { PricingDefensibilityService } from './pricing-defensibility.service';
import {
  CostExperimentationService,
  type CreateExperimentArgs,
  type ExperimentInput,
  type ExperimentModel,
} from './cost-experimentation.service';

interface AuthenticatedUser {
  id: string;
  email?: string;
}

@Controller('admin/cost')
export class AdminCostController {
  constructor(
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
    @Inject(CostCalibrationService) private readonly calibration: CostCalibrationService,
    @Inject(PricingDefensibilityService) private readonly defensibility: PricingDefensibilityService,
    @Inject(CostExperimentationService) private readonly experimentation: CostExperimentationService,
  ) {}

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

  @Get('calibration')
  async getCalibration(@Req() req: { user?: AuthenticatedUser }) {
    const user = this.getUser(req);
    await this.requireAdmin(user);
    return this.calibration.getCalibration();
  }

  @Post('calibration/refresh')
  async refreshCalibration(@Req() req: { user?: AuthenticatedUser }) {
    const user = this.getUser(req);
    await this.requireAdmin(user);
    const summary = await this.calibration.runWeeklyCalibration();
    return {
      refreshedModels: summary.refreshedModels,
      alertsRaised: summary.alertsRaised,
      skippedModels: summary.skippedModels,
    };
  }

  @Get('drift-alerts')
  async getDriftAlerts(@Req() req: { user?: AuthenticatedUser }) {
    const user = this.getUser(req);
    await this.requireAdmin(user);
    return this.calibration.getDriftAlerts();
  }

  @Post('drift-alerts/:id/acknowledge')
  async acknowledgeDriftAlert(
    @Req() req: { user?: AuthenticatedUser },
    @Param('id') id: string,
    @Body() _body: unknown,
  ) {
    const user = this.getUser(req);
    await this.requireAdmin(user);
    const result = await this.calibration.acknowledgeDriftAlert(id, user.id);
    if (!result) throw new BadRequestException('Alert not found');
    return { acknowledged_at: result.acknowledged_at };
  }

  @Get('defensibility')
  async getDefensibility(@Req() req: { user?: AuthenticatedUser }) {
    const user = this.getUser(req);
    await this.requireAdmin(user);
    return this.defensibility.summarizeByItemKind();
  }

  @Post('experiments')
  async createExperiment(
    @Req() req: { user?: AuthenticatedUser },
    @Body() body: { name: string; stage: string; inputPayload: ExperimentInput; models: ExperimentModel[] },
  ) {
    const user = this.getUser(req);
    await this.requireAdmin(user);
    if (!body?.name || !body?.stage || !body?.inputPayload || !Array.isArray(body?.models)) {
      throw new BadRequestException('name, stage, inputPayload, and models[] required');
    }
    const args: CreateExperimentArgs = {
      name: body.name,
      stage: body.stage,
      inputPayload: body.inputPayload,
      models: body.models,
      userId: user.id,
    };
    try {
      return await this.experimentation.createExperiment(args);
    } catch (err) {
      throw new BadRequestException(err instanceof Error ? err.message : 'Failed to create experiment');
    }
  }

  @Get('experiments')
  async listExperiments(@Req() req: { user?: AuthenticatedUser }) {
    const user = this.getUser(req);
    await this.requireAdmin(user);
    return this.experimentation.getExperiments();
  }

  @Get('experiments/:id')
  async getExperimentDetail(
    @Req() req: { user?: AuthenticatedUser },
    @Param('id') id: string,
  ) {
    const user = this.getUser(req);
    await this.requireAdmin(user);
    const detail = await this.experimentation.getExperimentDetail(id);
    if (!detail) throw new BadRequestException('Experiment not found');
    return detail;
  }
}
