import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { DATABASE_SERVICE, type DatabaseService } from '@orchestratorai/planes/database';
import {
  AttributionQueryService,
  type AttributionWindow,
  type CommonFilters,
  type SliceDimension,
} from './attribution-query.service';
import { AttributionAggregationService } from './attribution-aggregation.service';

interface AuthenticatedUser {
  id: string;
  email?: string;
}

const VALID_DIMENSIONS: readonly SliceDimension[] = [
  'triple',
  'analyst',
  'instrument',
  'source',
  'author',
];
const VALID_WINDOWS: readonly AttributionWindow[] = ['7d', '30d', '90d'];

@Controller('admin/attribution')
export class AdminAttributionController {
  constructor(
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
    @Inject(AttributionQueryService) private readonly query: AttributionQueryService,
    @Inject(AttributionAggregationService) private readonly aggregation: AttributionAggregationService,
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

  private buildFilters(q: Record<string, string | undefined>): CommonFilters {
    return {
      yearMonth: q.yearMonth,
      from: q.from,
      to: q.to,
      authorUserId: q.authorUserId,
      analystId: q.analystId,
      instrumentId: q.instrumentId,
      sourceKey: q.sourceKey,
      limit: q.limit ? Number(q.limit) : undefined,
      offset: q.offset ? Number(q.offset) : undefined,
    };
  }

  @Get('per-triple')
  async perTriple(
    @Req() req: { user?: AuthenticatedUser },
    @Query() q: Record<string, string | undefined>,
  ) {
    await this.requireAdmin(this.getUser(req));
    return this.query.queryPerTriple(this.buildFilters(q));
  }

  @Get('per-analyst')
  async perAnalyst(
    @Req() req: { user?: AuthenticatedUser },
    @Query() q: Record<string, string | undefined>,
  ) {
    await this.requireAdmin(this.getUser(req));
    return this.query.queryPerAnalyst(this.buildFilters(q));
  }

  @Get('per-instrument')
  async perInstrument(
    @Req() req: { user?: AuthenticatedUser },
    @Query() q: Record<string, string | undefined>,
  ) {
    await this.requireAdmin(this.getUser(req));
    return this.query.queryPerInstrument(this.buildFilters(q));
  }

  @Get('per-source')
  async perSource(
    @Req() req: { user?: AuthenticatedUser },
    @Query() q: Record<string, string | undefined>,
  ) {
    await this.requireAdmin(this.getUser(req));
    return this.query.queryPerSource(this.buildFilters(q));
  }

  @Get('per-author')
  async perAuthor(
    @Req() req: { user?: AuthenticatedUser },
    @Query() q: Record<string, string | undefined>,
  ) {
    await this.requireAdmin(this.getUser(req));
    return this.query.queryPerAuthor(this.buildFilters(q));
  }

  @Get('graduation-candidates')
  async graduationCandidates(
    @Req() req: { user?: AuthenticatedUser },
    @Query('window') windowRaw?: string,
    @Query('top') topRaw?: string,
    @Query('minPredictions') minPredictionsRaw?: string,
  ) {
    await this.requireAdmin(this.getUser(req));
    const window = (windowRaw ?? '30d') as AttributionWindow;
    if (!VALID_WINDOWS.includes(window)) {
      throw new BadRequestException(`window must be one of ${VALID_WINDOWS.join(', ')}`);
    }
    return this.query.queryGraduationCandidates({
      window,
      top: topRaw ? Number(topRaw) : undefined,
      minPredictions: minPredictionsRaw ? Number(minPredictionsRaw) : undefined,
    });
  }

  @Get('slice')
  async slice(
    @Req() req: { user?: AuthenticatedUser },
    @Query('dimX') dimX?: string,
    @Query('dimY') dimY?: string,
    @Query() q: Record<string, string | undefined> = {},
  ) {
    await this.requireAdmin(this.getUser(req));
    if (!dimX || !dimY) {
      throw new BadRequestException('dimX and dimY are required');
    }
    if (!VALID_DIMENSIONS.includes(dimX as SliceDimension)) {
      throw new BadRequestException(`dimX must be one of ${VALID_DIMENSIONS.join(', ')}`);
    }
    if (!VALID_DIMENSIONS.includes(dimY as SliceDimension)) {
      throw new BadRequestException(`dimY must be one of ${VALID_DIMENSIONS.join(', ')}`);
    }
    if (dimX === dimY) {
      throw new BadRequestException('dimX and dimY must differ');
    }
    return this.query.querySlice({
      dimX: dimX as SliceDimension,
      dimY: dimY as SliceDimension,
      filters: this.buildFilters(q),
    });
  }

  @Post('refresh-views')
  async refreshViews(@Req() req: { user?: AuthenticatedUser }) {
    await this.requireAdmin(this.getUser(req));
    return this.aggregation.refreshViews();
  }
}
