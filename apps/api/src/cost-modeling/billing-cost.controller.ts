import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { DATABASE_SERVICE, type DatabaseService } from '@orchestratorai/planes/database';
import { CostPredictionService, type ConfigurationOverride } from './cost-prediction.service';
import { StudentBillingService } from './student-billing.service';

interface AuthenticatedUser {
  id: string;
  email?: string;
}

@Controller('billing')
export class BillingCostController {
  constructor(
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
    @Inject(CostPredictionService) private readonly prediction: CostPredictionService,
    @Inject(StudentBillingService) private readonly studentBilling: StudentBillingService,
  ) {}

  private getUser(req: { user?: AuthenticatedUser }): AuthenticatedUser {
    if (!req.user?.id) throw new BadRequestException('Authentication required');
    return req.user;
  }

  private async isAdmin(userId: string): Promise<boolean> {
    const result = await this.db.rawQuery(
      `SELECT r.name FROM authz.rbac_user_roles ur
       JOIN authz.rbac_roles r ON r.id = ur.role_id
       WHERE ur.user_id = $1 AND r.name IN ('super-admin', 'admin', 'owner')
       LIMIT 1`,
      [userId],
    );
    const rows = (result.data as Array<{ name: string }> | null) ?? [];
    return rows.length > 0;
  }

  @Post('predict-cost')
  async predictCost(
    @Req() req: { user?: AuthenticatedUser },
    @Body() body: { userId: string; configurationOverride?: ConfigurationOverride },
  ) {
    const user = this.getUser(req);
    if (!body?.userId) throw new BadRequestException('userId required');

    if (body.userId !== user.id) {
      const isAdmin = await this.isAdmin(user.id);
      if (!isAdmin) throw new ForbiddenException('Admin access required to predict for another user');
    }

    return this.prediction.predictForUser(body.userId, body.configurationOverride);
  }

  @Get('student-accrual')
  async studentAccrual(
    @Req() req: { user?: AuthenticatedUser },
    @Query('userId') userId: string,
  ) {
    const user = this.getUser(req);
    if (!userId) throw new BadRequestException('userId required');
    if (userId !== user.id) {
      const isAdmin = await this.isAdmin(user.id);
      if (!isAdmin) throw new ForbiddenException('Cannot view another user accrual');
    }
    return this.studentBilling.getStudentAccrual(userId);
  }

  @Get('my-summary')
  async mySummary(
    @Req() req: { user?: AuthenticatedUser },
    @Query('yearMonth') yearMonth?: string,
  ) {
    const user = this.getUser(req);
    return this.studentBilling.getMySummary(user.id, yearMonth);
  }
}
