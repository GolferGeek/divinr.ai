import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Inject,
  Put,
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
import { ClubService } from './club.service';
import { ClubAnalystService } from './club-analyst.service';
import { ClubActivityService } from './club-activity.service';
import { ClubAnalyticsService } from './club-analytics.service';
import { ClubRankingService } from './club-ranking.service';
import { ClubMentorService } from './club-mentor.service';
import type { CreateClubInput, UpdateClubInput } from './club.types';

interface AuthenticatedUser {
  id: string;
  email?: string;
  role?: string;
}

@UseGuards(JwtAuthGuard)
@Controller('clubs')
export class ClubController {
  constructor(
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
    @Inject(ClubService) private readonly clubService: ClubService,
    @Inject(ClubAnalystService) private readonly analystService: ClubAnalystService,
    @Inject(ClubActivityService) private readonly activityService: ClubActivityService,
    @Inject(ClubAnalyticsService) private readonly analyticsService: ClubAnalyticsService,
    @Inject(ClubRankingService) private readonly rankingService: ClubRankingService,
    @Inject(ClubMentorService) private readonly mentorService: ClubMentorService,
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
    if (message.includes('Requires') || message.includes('Cannot') || message.includes('Owner cannot')) throw new ForbiddenException(message);
    throw new BadRequestException(message);
  }

  // ─── Club CRUD ─────────────────────────────────────────────────

  @Post()
  async createClub(@Req() req: { user?: AuthenticatedUser }, @Body() body: CreateClubInput) {
    const user = this.getUser(req);
    await this.requireWriteAccess(user);
    if (!body?.name) throw new BadRequestException('name is required');
    try { return await this.clubService.createClub(body, user.id); }
    catch (err) { this.handleError(err); }
  }

  @Get()
  async listMyClubs(@Req() req: { user?: AuthenticatedUser }) {
    const user = this.getUser(req);
    return this.clubService.listMyClubs(user.id);
  }

  @Get('discover')
  async discoverClubs(@Req() req: { user?: AuthenticatedUser }, @Query('sort_by') sortBy?: string) {
    this.getUser(req);
    return this.clubService.discoverClubs(sortBy);
  }

  // ─── Rankings (before :id routes) ──────────────────────────────

  @Get('rankings/leaderboard')
  async getLeaderboard(
    @Req() req: { user?: AuthenticatedUser },
    @Query('sort_by') sortBy?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    this.getUser(req);
    return this.rankingService.getLeaderboard(sortBy ?? 'ranking_score', Number(limit) || 50, Number(offset) || 0);
  }

  @Get('rankings/badges')
  async getBadgeTypes(@Req() req: { user?: AuthenticatedUser }) {
    this.getUser(req);
    return this.rankingService.getBadgeTypes();
  }

  @Get('rankings/compare')
  async compareClubs(
    @Req() req: { user?: AuthenticatedUser },
    @Query('club_a') clubA?: string,
    @Query('club_b') clubB?: string,
  ) {
    this.getUser(req);
    if (!clubA || !clubB) throw new BadRequestException('club_a and club_b query params are required');
    try { return await this.rankingService.compareClubs(clubA, clubB); }
    catch (err) { this.handleError(err); }
  }

  @Get('rankings/:clubId/history')
  async getRankingHistory(@Req() req: { user?: AuthenticatedUser }, @Param('clubId') clubId: string) {
    this.getUser(req);
    return this.rankingService.getRankingHistory(clubId);
  }

  // Invite routes before :id
  @Get('invite/:token')
  async getInviteDetails(@Param('token') token: string) {
    try { return await this.clubService.getInviteDetails(token); }
    catch (err) { this.handleError(err); }
  }

  @Post('invite/:token/accept')
  async acceptInvite(@Req() req: { user?: AuthenticatedUser }, @Param('token') token: string) {
    const user = this.getUser(req);
    try { return await this.clubService.acceptInvite(token, user.id); }
    catch (err) { this.handleError(err); }
  }

  @Get(':id')
  async getClub(@Req() req: { user?: AuthenticatedUser }, @Param('id') id: string) {
    const user = this.getUser(req);
    const club = await this.clubService.getClub(id, user.id);
    if (!club) throw new NotFoundException('Club not found or not a member');
    return club;
  }

  @Patch(':id')
  async updateClub(@Req() req: { user?: AuthenticatedUser }, @Param('id') id: string, @Body() body: UpdateClubInput) {
    const user = this.getUser(req);
    await this.requireWriteAccess(user);
    try { return await this.clubService.updateClub(id, body, user.id); }
    catch (err) { this.handleError(err); }
  }

  @Delete(':id')
  async deleteClub(@Req() req: { user?: AuthenticatedUser }, @Param('id') id: string) {
    const user = this.getUser(req);
    await this.requireWriteAccess(user);
    try { await this.clubService.deleteClub(id, user.id); return { deleted: true }; }
    catch (err) { this.handleError(err); }
  }

  // ─── Membership ────────────────────────────────────────────────

  @Post(':id/join')
  async joinClub(@Req() req: { user?: AuthenticatedUser }, @Param('id') id: string, @Body() body: { code: string }) {
    const user = this.getUser(req);
    if (!body?.code) throw new BadRequestException('code is required');
    try { return await this.clubService.joinClub(id, body.code, user.id); }
    catch (err) { this.handleError(err); }
  }

  @Post(':id/leave')
  async leaveClub(@Req() req: { user?: AuthenticatedUser }, @Param('id') id: string) {
    const user = this.getUser(req);
    try { await this.clubService.leaveClub(id, user.id); return { left: true }; }
    catch (err) { this.handleError(err); }
  }

  @Get(':id/members')
  async listMembers(@Req() req: { user?: AuthenticatedUser }, @Param('id') id: string) {
    const user = this.getUser(req);
    return this.clubService.listMembers(id, user.id);
  }

  @Post(':id/members/:userId/promote')
  async promoteMember(@Req() req: { user?: AuthenticatedUser }, @Param('id') id: string, @Param('userId') targetUserId: string) {
    const user = this.getUser(req);
    await this.requireWriteAccess(user);
    try { await this.clubService.promoteMember(id, targetUserId, user.id); return { promoted: true }; }
    catch (err) { this.handleError(err); }
  }

  @Post(':id/members/:userId/demote')
  async demoteMember(@Req() req: { user?: AuthenticatedUser }, @Param('id') id: string, @Param('userId') targetUserId: string) {
    const user = this.getUser(req);
    await this.requireWriteAccess(user);
    try { await this.clubService.demoteMember(id, targetUserId, user.id); return { demoted: true }; }
    catch (err) { this.handleError(err); }
  }

  @Delete(':id/members/:userId')
  async removeMember(@Req() req: { user?: AuthenticatedUser }, @Param('id') id: string, @Param('userId') targetUserId: string) {
    const user = this.getUser(req);
    await this.requireWriteAccess(user);
    try { await this.clubService.removeMember(id, targetUserId, user.id); return { removed: true }; }
    catch (err) { this.handleError(err); }
  }

  // ─── Invites ───────────────────────────────────────────────────

  @Post(':id/invites')
  async createInvite(@Req() req: { user?: AuthenticatedUser }, @Param('id') id: string, @Body() body?: { email?: string; username?: string }) {
    const user = this.getUser(req);
    await this.requireWriteAccess(user);
    try { return await this.clubService.createInvite(id, user.id, body); }
    catch (err) { this.handleError(err); }
  }

  // ─── Club Analysts ─────────────────────────────────────────────

  @Post(':id/analysts')
  async createClubAnalyst(
    @Req() req: { user?: AuthenticatedUser },
    @Param('id') id: string,
    @Body() body: { slug: string; display_name: string; persona_prompt: string; analyst_type?: string; workflow_scope?: string },
  ) {
    const user = this.getUser(req);
    await this.requireWriteAccess(user);
    if (!body?.slug || !body?.display_name || !body?.persona_prompt) {
      throw new BadRequestException('slug, display_name, and persona_prompt are required');
    }
    try { return await this.analystService.createClubAnalyst(id, body, user.id); }
    catch (err) { this.handleError(err); }
  }

  @Get(':id/analysts')
  async listClubAnalysts(@Req() req: { user?: AuthenticatedUser }, @Param('id') id: string) {
    const user = this.getUser(req);
    return this.analystService.listClubAnalysts(id, user.id);
  }

  @Get(':id/analysts/:analystId/contract')
  async getClubAnalystContract(
    @Req() req: { user?: AuthenticatedUser },
    @Param('id') id: string,
    @Param('analystId') analystId: string,
  ) {
    const user = this.getUser(req);
    try { return await this.analystService.getClubAnalystContract(id, analystId, user.id); }
    catch (err) { this.handleError(err); }
  }

  @Put(':id/analysts/:analystId/contract')
  async updateClubAnalystContract(
    @Req() req: { user?: AuthenticatedUser },
    @Param('id') id: string,
    @Param('analystId') analystId: string,
    @Body() body: { persona_prompt?: string; context_markdown?: string; change_reason?: string },
  ) {
    const user = this.getUser(req);
    await this.requireWriteAccess(user);
    try { await this.analystService.updateClubAnalystContract(id, analystId, body, user.id); return { updated: true }; }
    catch (err) { this.handleError(err); }
  }

  // ─── Analytics ──────────────────────────────────────────────────

  @Get(':id/analytics')
  async getClubAnalytics(@Req() req: { user?: AuthenticatedUser }, @Param('id') id: string) {
    const user = this.getUser(req);
    try { return await this.analyticsService.getClubAnalytics(id, user.id); }
    catch (err) { this.handleError(err); }
  }

  @Get(':id/analytics/post-mortem/:tournamentId')
  async getPostMortem(@Req() req: { user?: AuthenticatedUser }, @Param('id') id: string, @Param('tournamentId') tournamentId: string) {
    const user = this.getUser(req);
    try { return await this.analyticsService.getPostMortem(id, tournamentId, user.id); }
    catch (err) { this.handleError(err); }
  }

  // ─── Learning Activities ───────────────────────────────────────

  @Post(':id/challenges')
  async createChallenge(@Req() req: { user?: AuthenticatedUser }, @Param('id') id: string, @Body() body: { instrument_id: string; symbol: string; prompt?: string }) {
    const user = this.getUser(req);
    await this.requireWriteAccess(user);
    if (!body?.instrument_id || !body?.symbol) throw new BadRequestException('instrument_id and symbol are required');
    try { return await this.activityService.createChallenge(id, body, user.id); }
    catch (err) { this.handleError(err); }
  }

  @Get(':id/challenges')
  async listChallenges(@Req() req: { user?: AuthenticatedUser }, @Param('id') id: string) {
    const user = this.getUser(req);
    return this.activityService.listChallenges(id, user.id);
  }

  @Post(':id/challenges/:challengeId/respond')
  async respondToChallenge(@Req() req: { user?: AuthenticatedUser }, @Param('id') _id: string, @Param('challengeId') challengeId: string, @Body() body: { direction: 'bull' | 'bear' | 'neutral'; thesis: string }) {
    const user = this.getUser(req);
    await this.requireWriteAccess(user);
    if (!body?.direction || !body?.thesis) throw new BadRequestException('direction and thesis are required');
    try { return await this.activityService.respondToChallenge(challengeId, body, user.id); }
    catch (err) { this.handleError(err); }
  }

  @Post(':id/challenges/:challengeId/reveal')
  async revealChallenge(@Req() req: { user?: AuthenticatedUser }, @Param('id') _id: string, @Param('challengeId') challengeId: string) {
    const user = this.getUser(req);
    await this.requireWriteAccess(user);
    try { await this.activityService.revealChallenge(challengeId, user.id); return { revealed: true }; }
    catch (err) { this.handleError(err); }
  }

  @Post(':id/polls')
  async createPoll(@Req() req: { user?: AuthenticatedUser }, @Param('id') id: string, @Body() body: { instrument_id: string; symbol: string }) {
    const user = this.getUser(req);
    await this.requireWriteAccess(user);
    if (!body?.instrument_id || !body?.symbol) throw new BadRequestException('instrument_id and symbol are required');
    try { return await this.activityService.createPoll(id, body, user.id); }
    catch (err) { this.handleError(err); }
  }

  @Get(':id/polls')
  async listPolls(@Req() req: { user?: AuthenticatedUser }, @Param('id') id: string) {
    const user = this.getUser(req);
    return this.activityService.listPolls(id, user.id);
  }

  @Post(':id/polls/:pollId/vote')
  async vote(@Req() req: { user?: AuthenticatedUser }, @Param('id') _id: string, @Param('pollId') pollId: string, @Body() body: { direction: 'bull' | 'bear' | 'neutral' }) {
    const user = this.getUser(req);
    await this.requireWriteAccess(user);
    if (!body?.direction) throw new BadRequestException('direction is required');
    try { return await this.activityService.vote(pollId, body.direction, user.id); }
    catch (err) { this.handleError(err); }
  }

  @Post(':id/polls/:pollId/reveal')
  async revealPoll(@Req() req: { user?: AuthenticatedUser }, @Param('id') _id: string, @Param('pollId') pollId: string) {
    const user = this.getUser(req);
    await this.requireWriteAccess(user);
    try { await this.activityService.revealPoll(pollId, user.id); return { revealed: true }; }
    catch (err) { this.handleError(err); }
  }

  @Post(':id/journals')
  async addJournalEntry(@Req() req: { user?: AuthenticatedUser }, @Param('id') id: string, @Body() body: { entry: string; symbol?: string; tournament_id?: string }) {
    const user = this.getUser(req);
    await this.requireWriteAccess(user);
    if (!body?.entry) throw new BadRequestException('entry is required');
    try { return await this.activityService.addJournalEntry(id, body, user.id); }
    catch (err) { this.handleError(err); }
  }

  @Get(':id/journals')
  async listJournals(@Req() req: { user?: AuthenticatedUser }, @Param('id') id: string) {
    const user = this.getUser(req);
    return this.activityService.listJournals(id, user.id);
  }

  // ─── Mentoring ─────────────────────────────────────────────────

  @Get(':id/mentoring/eligibility')
  async checkMentorEligibility(@Req() req: { user?: AuthenticatedUser }, @Param('id') id: string) {
    const user = this.getUser(req);
    try { return await this.mentorService.checkEligibility(id, user.id); }
    catch (err) { this.handleError(err); }
  }

  @Post(':id/mentoring/apply')
  async applyToMentor(@Req() req: { user?: AuthenticatedUser }, @Param('id') id: string) {
    const user = this.getUser(req);
    await this.requireWriteAccess(user);
    try { return await this.mentorService.applyToMentor(id, user.id); }
    catch (err) { this.handleError(err); }
  }

  @Get(':id/mentoring/applications')
  async listMentorApplications(@Req() req: { user?: AuthenticatedUser }, @Param('id') id: string) {
    const user = this.getUser(req);
    try { return await this.mentorService.listApplications(id, user.id); }
    catch (err) { this.handleError(err); }
  }

  @Post(':id/mentoring/applications/:mentorId/approve')
  async approveMentorApplication(@Req() req: { user?: AuthenticatedUser }, @Param('id') id: string, @Param('mentorId') mentorId: string) {
    const user = this.getUser(req);
    await this.requireWriteAccess(user);
    try { await this.mentorService.approveApplication(id, mentorId, user.id); return { approved: true }; }
    catch (err) { this.handleError(err); }
  }

  @Post(':id/mentoring/applications/:mentorId/reject')
  async rejectMentorApplication(@Req() req: { user?: AuthenticatedUser }, @Param('id') id: string, @Param('mentorId') mentorId: string) {
    const user = this.getUser(req);
    await this.requireWriteAccess(user);
    try { await this.mentorService.rejectApplication(id, mentorId, user.id); return { rejected: true }; }
    catch (err) { this.handleError(err); }
  }

  @Post(':id/mentoring/request')
  async requestMentor(@Req() req: { user?: AuthenticatedUser }, @Param('id') id: string) {
    const user = this.getUser(req);
    await this.requireWriteAccess(user);
    try { return await this.mentorService.requestMentor(id, user.id); }
    catch (err) { this.handleError(err); }
  }

  @Get(':id/mentoring/requests')
  async listMenteeRequests(@Req() req: { user?: AuthenticatedUser }, @Param('id') id: string) {
    const user = this.getUser(req);
    try { return await this.mentorService.listRequests(id, user.id); }
    catch (err) { this.handleError(err); }
  }

  @Post(':id/mentoring/pair')
  async pairMentorToMentee(@Req() req: { user?: AuthenticatedUser }, @Param('id') id: string, @Body() body: { mentor_id: string; mentee_user_id: string }) {
    const user = this.getUser(req);
    await this.requireWriteAccess(user);
    if (!body?.mentor_id || !body?.mentee_user_id) throw new BadRequestException('mentor_id and mentee_user_id are required');
    try { return await this.mentorService.pairMentorToMentee(id, body.mentor_id, body.mentee_user_id, user.id); }
    catch (err) { this.handleError(err); }
  }

  @Post(':id/mentoring/pairings/:pairingId/end')
  async endMentorPairing(@Req() req: { user?: AuthenticatedUser }, @Param('id') id: string, @Param('pairingId') pairingId: string) {
    const user = this.getUser(req);
    await this.requireWriteAccess(user);
    try { await this.mentorService.endPairing(id, pairingId, user.id); return { ended: true }; }
    catch (err) { this.handleError(err); }
  }

  @Get(':id/mentoring/status')
  async getMentoringStatus(@Req() req: { user?: AuthenticatedUser }, @Param('id') id: string) {
    const user = this.getUser(req);
    try { return await this.mentorService.getMentoringStatus(id, user.id); }
    catch (err) { this.handleError(err); }
  }

  @Get(':id/mentoring/mentor-dashboard')
  async getMentorDashboard(@Req() req: { user?: AuthenticatedUser }, @Param('id') id: string) {
    const user = this.getUser(req);
    try { return await this.mentorService.getMentorDashboard(id, user.id); }
    catch (err) { this.handleError(err); }
  }

  @Get(':id/mentoring/my-mentor')
  async getMyMentor(@Req() req: { user?: AuthenticatedUser }, @Param('id') id: string) {
    const user = this.getUser(req);
    try { return await this.mentorService.getMyMentor(id, user.id); }
    catch (err) { this.handleError(err); }
  }

  @Get(':id/mentoring/leaderboard')
  async getMentorLeaderboard(@Req() req: { user?: AuthenticatedUser }, @Param('id') id: string) {
    const user = this.getUser(req);
    try { return await this.mentorService.getMentorLeaderboard(id, user.id); }
    catch (err) { this.handleError(err); }
  }

  @Get(':id/mentoring/feedback/pending')
  async getPendingFeedback(@Req() req: { user?: AuthenticatedUser }, @Param('id') id: string) {
    const user = this.getUser(req);
    try { return await this.mentorService.checkPendingFeedback(id, user.id); }
    catch (err) { this.handleError(err); }
  }

  @Post(':id/mentoring/feedback')
  async submitMentorFeedback(@Req() req: { user?: AuthenticatedUser }, @Param('id') id: string, @Body() body: { pairing_id: string; rating: number; comment?: string }) {
    const user = this.getUser(req);
    await this.requireWriteAccess(user);
    if (!body?.pairing_id || !body?.rating) throw new BadRequestException('pairing_id and rating are required');
    if (body.rating < 1 || body.rating > 5) throw new BadRequestException('rating must be between 1 and 5');
    try { return await this.mentorService.submitFeedback(id, body.pairing_id, user.id, body.rating, body.comment); }
    catch (err) { this.handleError(err); }
  }
}
