import {
  BadRequestException,
  Body,
  Controller,
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
import { TournamentService } from './tournament.service';
import { TournamentPortfolioService } from './tournament-portfolio.service';
import { TournamentLeaderboardService } from './tournament-leaderboard.service';
import { TournamentInviteService } from './tournament-invite.service';
import type {
  CreateTournamentInput,
  UpdateTournamentInput,
  TournamentScope,
  TournamentStatus,
  TournamentType,
} from './tournament.types';

interface AuthenticatedUser {
  id: string;
  email?: string;
  role?: string;
}

@UseGuards(JwtAuthGuard)
@Controller('tournaments')
export class TournamentController {
  constructor(
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
    @Inject(TournamentService) private readonly tournamentService: TournamentService,
    @Inject(TournamentPortfolioService) private readonly portfolioService: TournamentPortfolioService,
    @Inject(TournamentLeaderboardService) private readonly leaderboardService: TournamentLeaderboardService,
    @Inject(TournamentInviteService) private readonly inviteService: TournamentInviteService,
  ) {}

  private getUser(req: { user?: AuthenticatedUser }): AuthenticatedUser {
    if (!req.user?.id) {
      throw new BadRequestException('Authentication required');
    }
    return req.user;
  }

  private async requireWriteAccess(user: AuthenticatedUser): Promise<void> {
    const result = await this.db.rawQuery(
      `SELECT rr.name FROM authz.rbac_user_roles r
       JOIN authz.rbac_roles rr ON rr.id = r.role_id
       WHERE r.user_id = $1
       ORDER BY CASE rr.name
         WHEN 'super-admin' THEN 1
         WHEN 'owner' THEN 2
         WHEN 'admin' THEN 3
         WHEN 'member' THEN 4
         WHEN 'beta_reader' THEN 5
         ELSE 6
       END
       LIMIT 1`,
      [user.id],
    );
    const rows = (result.data as Array<{ name: string }> | null) ?? [];
    const role = rows.length > 0 ? rows[0].name : null;
    const writableRoles = ['super-admin', 'owner', 'member', 'admin'];
    if (role && writableRoles.includes(role)) return;
    throw new ForbiddenException('Read-only access — beta readers cannot perform this action');
  }

  // ─── Tournament CRUD ───────────────────────────────────────────

  @Post()
  async createTournament(
    @Req() req: { user?: AuthenticatedUser },
    @Body() body: CreateTournamentInput,
  ) {
    const user = this.getUser(req);
    await this.requireWriteAccess(user);

    if (!body?.name) throw new BadRequestException('name is required');
    if (!body?.scope) throw new BadRequestException('scope is required');
    if (!body?.tournament_type) throw new BadRequestException('tournament_type is required');
    if (!body?.starting_balance) throw new BadRequestException('starting_balance is required');
    if (!body?.starts_at) throw new BadRequestException('starts_at is required');
    if (!body?.ends_at) throw new BadRequestException('ends_at is required');

    try {
      return await this.tournamentService.createTournament(body, user.id, user.role);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('Only admins')) throw new ForbiddenException(message);
      throw new BadRequestException(message);
    }
  }

  @Get()
  async listTournaments(
    @Req() req: { user?: AuthenticatedUser },
    @Query('scope') scope?: TournamentScope,
    @Query('status') status?: TournamentStatus,
    @Query('tournament_type') tournamentType?: TournamentType,
  ) {
    const user = this.getUser(req);
    return this.tournamentService.listTournaments(user.id, {
      scope,
      status,
      tournament_type: tournamentType,
    });
  }

  @Get('me')
  async getMyTournaments(
    @Req() req: { user?: AuthenticatedUser },
  ) {
    const user = this.getUser(req);
    return this.portfolioService.getMyEntries(user.id);
  }

  @Get('history')
  async getHistory(
    @Req() req: { user?: AuthenticatedUser },
  ) {
    const user = this.getUser(req);
    return this.leaderboardService.getHistory(user.id);
  }

  // ─── Invite routes (must be before :id to avoid conflict) ──────

  @Get('invite/:token')
  async getInviteDetails(
    @Param('token') token: string,
  ) {
    try {
      return await this.inviteService.getInviteDetails(token);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('Invalid')) throw new NotFoundException(message);
      throw new BadRequestException(message);
    }
  }

  @Post('invite/:token/accept')
  async acceptInvite(
    @Req() req: { user?: AuthenticatedUser },
    @Param('token') token: string,
  ) {
    const user = this.getUser(req);
    try {
      return await this.inviteService.acceptInvite(token, user.id);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('Invalid') || message.includes('not found')) throw new NotFoundException(message);
      if (message.includes('already')) throw new BadRequestException(message);
      throw new BadRequestException(message);
    }
  }

  @Get(':id')
  async getTournament(
    @Req() req: { user?: AuthenticatedUser },
    @Param('id') id: string,
  ) {
    const user = this.getUser(req);
    const tournament = await this.tournamentService.getTournament(id, user.id);
    if (!tournament) throw new NotFoundException('Tournament not found');
    return tournament;
  }

  @Patch(':id')
  async updateTournament(
    @Req() req: { user?: AuthenticatedUser },
    @Param('id') id: string,
    @Body() body: UpdateTournamentInput,
  ) {
    const user = this.getUser(req);
    await this.requireWriteAccess(user);

    try {
      return await this.tournamentService.updateTournament(id, body, user.id, user.role);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('not found')) throw new NotFoundException(message);
      if (message.includes('Only the creator')) throw new ForbiddenException(message);
      throw new BadRequestException(message);
    }
  }

  @Post(':id/archive')
  async archiveTournament(
    @Req() req: { user?: AuthenticatedUser },
    @Param('id') id: string,
  ) {
    const user = this.getUser(req);
    await this.requireWriteAccess(user);

    try {
      return await this.tournamentService.archiveTournament(id, user.id, user.role);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('not found')) throw new NotFoundException(message);
      if (message.includes('Only the creator')) throw new ForbiddenException(message);
      throw new BadRequestException(message);
    }
  }

  // ─── Leaderboard & Results ──────────────────────────────────────

  @Get(':id/leaderboard')
  async getLeaderboard(
    @Req() req: { user?: AuthenticatedUser },
    @Param('id') id: string,
  ) {
    const user = this.getUser(req);
    const tournament = await this.tournamentService.getTournament(id, user.id);
    if (!tournament) throw new NotFoundException('Tournament not found');
    return this.leaderboardService.getLeaderboard(id, user.id);
  }

  @Get(':id/results')
  async getResults(
    @Req() req: { user?: AuthenticatedUser },
    @Param('id') id: string,
  ) {
    const user = this.getUser(req);
    const tournament = await this.tournamentService.getTournament(id, user.id);
    if (!tournament) throw new NotFoundException('Tournament not found');
    const results = await this.leaderboardService.getResults(id, user.id);
    if (!results) throw new NotFoundException('Results not available — tournament not completed');
    return results;
  }

  // ─── Invitations ────────────────────────────────────────────────

  @Post(':id/invites')
  async createInvite(
    @Req() req: { user?: AuthenticatedUser },
    @Param('id') id: string,
    @Body() body: { username?: string; email?: string },
  ) {
    const user = this.getUser(req);
    await this.requireWriteAccess(user);

    try {
      if (body?.username) {
        return await this.inviteService.inviteByUsername(id, user.id, body.username);
      } else if (body?.email) {
        return await this.inviteService.inviteByEmail(id, user.id, body.email);
      } else {
        return await this.inviteService.createInviteLink(id, user.id);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('not found')) throw new NotFoundException(message);
      throw new BadRequestException(message);
    }
  }

  // ─── Entry & Registration ──────────────────────────────────────

  @Post(':id/enter')
  async enterTournament(
    @Req() req: { user?: AuthenticatedUser },
    @Param('id') id: string,
  ) {
    const user = this.getUser(req);
    await this.requireWriteAccess(user);

    try {
      return await this.portfolioService.enterTournament(id, user.id);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('not found')) throw new NotFoundException(message);
      throw new BadRequestException(message);
    }
  }

  @Get(':id/entries')
  async listEntries(
    @Req() req: { user?: AuthenticatedUser },
    @Param('id') id: string,
  ) {
    const user = this.getUser(req);
    const tournament = await this.tournamentService.getTournament(id, user.id);
    if (!tournament) throw new NotFoundException('Tournament not found');
    return this.portfolioService.listEntries(id, user.id);
  }

  // ─── Trading ───────────────────────────────────────────────────

  @Post(':id/queue-trade')
  async queueTrade(
    @Req() req: { user?: AuthenticatedUser },
    @Param('id') id: string,
    @Body() body: { symbol: string; direction: 'long' | 'short'; quantity: number; predictionId?: string },
  ) {
    const user = this.getUser(req);
    await this.requireWriteAccess(user);

    if (!body?.symbol) throw new BadRequestException('symbol is required');
    if (!body?.direction) throw new BadRequestException('direction is required');
    if (!body?.quantity || body.quantity <= 0) throw new BadRequestException('quantity must be positive');

    try {
      return await this.portfolioService.queueTrade(id, user.id, body);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('not found')) throw new NotFoundException(message);
      throw new BadRequestException(message);
    }
  }

  @Get(':id/positions')
  async listPositions(
    @Req() req: { user?: AuthenticatedUser },
    @Param('id') id: string,
    @Query('status') status?: 'open' | 'closed',
  ) {
    const user = this.getUser(req);
    return this.portfolioService.listPositions(id, user.id, status);
  }

  @Post(':id/positions/:positionId/close')
  async closePosition(
    @Req() req: { user?: AuthenticatedUser },
    @Param('id') id: string,
    @Param('positionId') positionId: string,
  ) {
    const user = this.getUser(req);
    await this.requireWriteAccess(user);

    try {
      return await this.portfolioService.closePosition(id, positionId, user.id);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('not found')) throw new NotFoundException(message);
      throw new BadRequestException(message);
    }
  }
}
