import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '@orchestratorai/planes/auth';
import { DATABASE_SERVICE, type DatabaseService } from '@orchestratorai/planes/database';
import { CurriculumService } from './curriculum.service';
import type { CreateCurriculumInput, UpdateCurriculumInput, UpdateModuleInput } from './curriculum.types';

interface AuthenticatedUser {
  id: string;
  email?: string;
  role?: string;
}

@UseGuards(JwtAuthGuard)
@Controller('curricula')
export class CurriculumController {
  constructor(
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
    @Inject(CurriculumService) private readonly curriculumService: CurriculumService,
  ) {}

  private getUser(req: { user?: AuthenticatedUser }): AuthenticatedUser {
    if (!req.user?.id) throw new BadRequestException('Authentication required');
    return req.user;
  }

  private async requireWriteAccess(user: AuthenticatedUser): Promise<void> {
    const result = await this.db.rawQuery(
      `SELECT rr.name FROM authz.rbac_user_roles r
       JOIN authz.rbac_roles rr ON rr.id = r.role_id
       WHERE r.user_id = $1
       ORDER BY CASE rr.name
         WHEN 'super-admin' THEN 1 WHEN 'owner' THEN 2 WHEN 'admin' THEN 3
         WHEN 'member' THEN 4 WHEN 'beta_reader' THEN 5 ELSE 6 END
       LIMIT 1`,
      [user.id],
    );
    const rows = (result.data as Array<{ name: string }> | null) ?? [];
    const role = rows.length > 0 ? rows[0].name : null;
    if (role && ['super-admin', 'owner', 'member', 'admin'].includes(role)) return;
    throw new ForbiddenException('Read-only access — beta readers cannot perform this action');
  }

  private handleError(err: unknown): never {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('not found') || message.includes('Not a member') || message.includes('Invalid')) throw new NotFoundException(message);
    if (message.includes('Requires') || message.includes('Cannot') || message.includes('only delete')) throw new ForbiddenException(message);
    throw new BadRequestException(message);
  }

  // ─── Curriculum CRUD ───────────────────────────────────────────

  @Post()
  async createCurriculum(@Req() req: { user?: AuthenticatedUser }, @Body() body: CreateCurriculumInput) {
    const user = this.getUser(req);
    await this.requireWriteAccess(user);
    if (!body?.club_id || !body?.name || !body?.week_count) {
      throw new BadRequestException('club_id, name, and week_count are required');
    }
    if (body.week_count < 1 || body.week_count > 52) {
      throw new BadRequestException('week_count must be between 1 and 52');
    }
    try { return await this.curriculumService.createCurriculum(body, user.id); }
    catch (err) { this.handleError(err); }
  }

  @Get()
  async listCurricula(@Req() req: { user?: AuthenticatedUser }, @Query('club_id') clubId?: string) {
    const user = this.getUser(req);
    if (!clubId) throw new BadRequestException('club_id query parameter is required');
    try { return await this.curriculumService.listCurricula(clubId, user.id); }
    catch (err) { this.handleError(err); }
  }

  // ─── Templates (before :id routes) ─────────────────────────────

  @Get('templates')
  async listTemplates(@Req() req: { user?: AuthenticatedUser }) {
    this.getUser(req);
    return this.curriculumService.listTemplates();
  }

  @Post('from-template')
  async createFromTemplate(@Req() req: { user?: AuthenticatedUser }, @Body() body: { club_id: string; template_slug: string }) {
    const user = this.getUser(req);
    await this.requireWriteAccess(user);
    if (!body?.club_id || !body?.template_slug) {
      throw new BadRequestException('club_id and template_slug are required');
    }
    try { return await this.curriculumService.createFromTemplate(body.club_id, body.template_slug, user.id); }
    catch (err) { this.handleError(err); }
  }

  @Get(':id')
  async getCurriculum(@Req() req: { user?: AuthenticatedUser }, @Param('id') id: string) {
    const user = this.getUser(req);
    try {
      const curriculum = await this.curriculumService.getCurriculum(id, user.id);
      if (!curriculum) throw new NotFoundException('Curriculum not found');
      return curriculum;
    } catch (err) { this.handleError(err); }
  }

  @Patch(':id')
  async updateCurriculum(@Req() req: { user?: AuthenticatedUser }, @Param('id') id: string, @Body() body: UpdateCurriculumInput) {
    const user = this.getUser(req);
    await this.requireWriteAccess(user);
    try { return await this.curriculumService.updateCurriculum(id, body, user.id); }
    catch (err) { this.handleError(err); }
  }

  @Delete(':id')
  async deleteCurriculum(@Req() req: { user?: AuthenticatedUser }, @Param('id') id: string) {
    const user = this.getUser(req);
    await this.requireWriteAccess(user);
    try { await this.curriculumService.deleteCurriculum(id, user.id); return { deleted: true }; }
    catch (err) { this.handleError(err); }
  }

  // ─── Module management ─────────────────────────────────────────

  @Patch(':id/modules/:weekNumber')
  async updateModule(
    @Req() req: { user?: AuthenticatedUser },
    @Param('id') id: string,
    @Param('weekNumber') weekNumber: string,
    @Body() body: UpdateModuleInput,
  ) {
    const user = this.getUser(req);
    await this.requireWriteAccess(user);
    const week = parseInt(weekNumber, 10);
    if (isNaN(week) || week < 1) throw new BadRequestException('Invalid week number');
    try { return await this.curriculumService.updateModule(id, week, body, user.id); }
    catch (err) { this.handleError(err); }
  }

  @Post(':id/modules/:weekNumber/challenge')
  async createModuleChallenge(
    @Req() req: { user?: AuthenticatedUser },
    @Param('id') id: string,
    @Param('weekNumber') weekNumber: string,
    @Body() body: { instrument_id: string; symbol: string; prompt?: string },
  ) {
    const user = this.getUser(req);
    await this.requireWriteAccess(user);
    const week = parseInt(weekNumber, 10);
    if (isNaN(week) || week < 1) throw new BadRequestException('Invalid week number');
    if (!body?.instrument_id || !body?.symbol) throw new BadRequestException('instrument_id and symbol are required');
    try { return await this.curriculumService.createModuleChallenge(id, week, body, user.id); }
    catch (err) { this.handleError(err); }
  }

  @Post(':id/modules/:weekNumber/poll')
  async createModulePoll(
    @Req() req: { user?: AuthenticatedUser },
    @Param('id') id: string,
    @Param('weekNumber') weekNumber: string,
    @Body() body: { instrument_id: string; symbol: string },
  ) {
    const user = this.getUser(req);
    await this.requireWriteAccess(user);
    const week = parseInt(weekNumber, 10);
    if (isNaN(week) || week < 1) throw new BadRequestException('Invalid week number');
    if (!body?.instrument_id || !body?.symbol) throw new BadRequestException('instrument_id and symbol are required');
    try { return await this.curriculumService.createModulePoll(id, week, body, user.id); }
    catch (err) { this.handleError(err); }
  }

  // ─── Dashboard (admin-only) ─────────────────────────────────

  @Get(':id/dashboard')
  async getDashboard(@Req() req: { user?: AuthenticatedUser }, @Param('id') id: string) {
    const user = this.getUser(req);
    try { return await this.curriculumService.getDashboard(id, user.id); }
    catch (err) { this.handleError(err); }
  }

  @Get(':id/dashboard/:userId')
  async getStudentDetail(
    @Req() req: { user?: AuthenticatedUser },
    @Param('id') id: string,
    @Param('userId') studentUserId: string,
  ) {
    const user = this.getUser(req);
    try { return await this.curriculumService.getStudentDetail(id, studentUserId, user.id); }
    catch (err) { this.handleError(err); }
  }

  // ─── Enrollment & Progress ─────────────────────────────────────

  @Post(':id/enroll')
  async enroll(@Req() req: { user?: AuthenticatedUser }, @Param('id') id: string) {
    const user = this.getUser(req);
    await this.requireWriteAccess(user);
    try { return await this.curriculumService.enroll(id, user.id); }
    catch (err) { this.handleError(err); }
  }

  @Get(':id/progress')
  async getProgress(@Req() req: { user?: AuthenticatedUser }, @Param('id') id: string) {
    const user = this.getUser(req);
    try { return await this.curriculumService.getProgress(id, user.id); }
    catch (err) { this.handleError(err); }
  }

  @Post(':id/modules/:weekNumber/complete-activity')
  async completeActivity(
    @Req() req: { user?: AuthenticatedUser },
    @Param('id') id: string,
    @Param('weekNumber') weekNumber: string,
    @Body() body: { activity: 'challenge' | 'poll' | 'journal' | 'tournament' },
  ) {
    const user = this.getUser(req);
    await this.requireWriteAccess(user);
    const week = parseInt(weekNumber, 10);
    if (isNaN(week) || week < 1) throw new BadRequestException('Invalid week number');
    if (!body?.activity || !['challenge', 'poll', 'journal', 'tournament'].includes(body.activity)) {
      throw new BadRequestException('activity must be one of: challenge, poll, journal, tournament');
    }
    try { return await this.curriculumService.completeActivity(id, week, body.activity, user.id); }
    catch (err) { this.handleError(err); }
  }
}
