import { Injectable, Inject, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DATABASE_SERVICE, type DatabaseService } from '@orchestratorai/planes/database';
import { ClubSchemaService } from './club-schema.service';
import { ClubService } from './club.service';
import { MessagingService } from '../messaging/messaging.service';

interface ClubMentor {
  id: string;
  club_id: string;
  user_id: string;
  status: 'pending' | 'approved' | 'rejected' | 'inactive';
  tournament_count: number | null;
  win_rate: number | null;
  avg_return_pct: number | null;
  applied_at: string;
  approved_at: string | null;
  approved_by: string | null;
  display_name?: string;
}

interface MentorPairing {
  id: string;
  club_id: string;
  mentor_id: string;
  mentee_user_id: string;
  dm_channel_id: string | null;
  status: 'active' | 'ended';
  paired_at: string;
  ended_at: string | null;
  display_name?: string;
}

interface MenteeRequest {
  id: string;
  club_id: string;
  user_id: string;
  status: 'pending' | 'matched' | 'cancelled';
  requested_at: string;
  display_name?: string;
}

interface MentorFeedback {
  id: string;
  pairing_id: string;
  mentee_user_id: string;
  rating: number;
  comment: string | null;
  period_label: string;
  created_at: string;
}

@Injectable()
export class ClubMentorService {
  private readonly logger = new Logger(ClubMentorService.name);

  constructor(
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
    @Inject(ClubSchemaService) private readonly schema: ClubSchemaService,
    @Inject(ClubService) private readonly clubService: ClubService,
    @Inject(MessagingService) private readonly messaging: MessagingService,
  ) {}

  // ─── Eligibility & Application ─────────────────────────────────

  async checkEligibility(clubId: string, userId: string): Promise<{
    eligible: boolean;
    tournament_count: number;
    win_rate: number | null;
    avg_return_pct: number | null;
    reasons: string[];
  }> {
    await this.clubService.requireMembership(clubId, userId);

    // Count completed club-scoped tournaments this user participated in
    const countResult = await this.db.rawQuery(
      `SELECT COUNT(*)::int as count
       FROM prediction.tournament_entries te
       JOIN prediction.tournaments t ON t.id = te.tournament_id
       WHERE te.user_id = $1 AND t.scope = 'club' AND t.scope_id = $2
         AND t.status IN ('completed', 'archived')`,
      [userId, clubId],
    );
    const tournament_count = ((countResult.data as Array<{ count: number }> | null) ?? [])[0]?.count ?? 0;

    // Win rate from closed positions in club tournaments
    const winResult = await this.db.rawQuery(
      `SELECT
         CASE WHEN COUNT(*) > 0
           THEN (COUNT(CASE WHEN tpos.realized_pnl > 0 THEN 1 END)::float8 / COUNT(*)::float8 * 100)
           ELSE NULL END as win_rate
       FROM prediction.tournament_positions tpos
       JOIN prediction.tournaments t ON t.id = tpos.tournament_id
       WHERE tpos.user_id = $1 AND t.scope = 'club' AND t.scope_id = $2
         AND tpos.status = 'closed'`,
      [userId, clubId],
    );
    const win_rate = ((winResult.data as Array<{ win_rate: number | null }> | null) ?? [])[0]?.win_rate ?? null;

    // Avg return % across completed tournaments
    const returnResult = await this.db.rawQuery(
      `SELECT AVG(CASE WHEN tp.initial_balance > 0
         THEN ((tp.total_realized_pnl + tp.total_unrealized_pnl) / tp.initial_balance) * 100
         ELSE 0 END)::float8 as avg_return_pct
       FROM prediction.tournament_portfolios tp
       JOIN prediction.tournaments t ON t.id = tp.tournament_id
       WHERE tp.user_id = $1 AND t.scope = 'club' AND t.scope_id = $2
         AND t.status IN ('completed', 'archived')`,
      [userId, clubId],
    );
    const avg_return_pct = ((returnResult.data as Array<{ avg_return_pct: number | null }> | null) ?? [])[0]?.avg_return_pct ?? null;

    const reasons: string[] = [];
    if (tournament_count < 2) reasons.push(`Need at least 2 completed tournaments (have ${tournament_count})`);
    if (win_rate !== null && win_rate < 50) reasons.push(`Need at least 50% win rate (have ${win_rate.toFixed(1)}%)`);
    if (win_rate === null && tournament_count > 0) reasons.push('No closed positions yet — complete some trades');

    // Must have 2+ tournaments AND a measurable win rate >= 50%
    const eligible = tournament_count >= 2 && win_rate !== null && win_rate >= 50;

    return { eligible, tournament_count, win_rate, avg_return_pct, reasons };
  }

  async applyToMentor(clubId: string, userId: string): Promise<ClubMentor> {
    await this.clubService.requireMembership(clubId, userId);

    const eligibility = await this.checkEligibility(clubId, userId);
    if (!eligibility.eligible) {
      throw new Error(`Not eligible to be a mentor: ${eligibility.reasons.join('; ')}`);
    }

    const id = randomUUID();
    const result = await this.db.rawQuery(
      `INSERT INTO prediction.club_mentors (id, club_id, user_id, tournament_count, win_rate, avg_return_pct)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [id, clubId, userId, eligibility.tournament_count, eligibility.win_rate, eligibility.avg_return_pct],
    );
    if (result.error) {
      if (result.error.message.includes('unique') || result.error.message.includes('duplicate')) {
        throw new Error('Already applied to be a mentor in this club');
      }
      throw new Error(result.error.message);
    }
    return ((result.data as ClubMentor[] | null) ?? [])[0]!;
  }

  async listApplications(clubId: string, userId: string): Promise<ClubMentor[]> {
    await this.clubService.requireRole(clubId, userId, ['owner', 'admin']);

    const result = await this.db.rawQuery(
      `SELECT m.*, u.display_name
       FROM prediction.club_mentors m
       LEFT JOIN authz.users u ON u.id = m.user_id
       WHERE m.club_id = $1 AND m.status = 'pending'
       ORDER BY m.applied_at ASC`,
      [clubId],
    );
    if (result.error) throw new Error(result.error.message);
    return (result.data as ClubMentor[] | null) ?? [];
  }

  async approveApplication(clubId: string, mentorId: string, adminUserId: string): Promise<void> {
    await this.clubService.requireRole(clubId, adminUserId, ['owner', 'admin']);

    const result = await this.db.rawQuery(
      `UPDATE prediction.club_mentors
       SET status = 'approved', approved_at = now(), approved_by = $1
       WHERE id = $2 AND club_id = $3 AND status = 'pending'
       RETURNING id`,
      [adminUserId, mentorId, clubId],
    );
    if (result.error) throw new Error(result.error.message);
    if (((result.data as unknown[] | null) ?? []).length === 0) {
      throw new Error('Mentor application not found or not pending');
    }
  }

  async rejectApplication(clubId: string, mentorId: string, adminUserId: string): Promise<void> {
    await this.clubService.requireRole(clubId, adminUserId, ['owner', 'admin']);

    const result = await this.db.rawQuery(
      `UPDATE prediction.club_mentors
       SET status = 'rejected'
       WHERE id = $1 AND club_id = $2 AND status = 'pending'
       RETURNING id`,
      [mentorId, clubId],
    );
    if (result.error) throw new Error(result.error.message);
    if (((result.data as unknown[] | null) ?? []).length === 0) {
      throw new Error('Mentor application not found or not pending');
    }
  }

  // ─── Mentee Requests & Pairing ─────────────────────────────────

  async requestMentor(clubId: string, userId: string): Promise<MenteeRequest> {
    await this.clubService.requireMembership(clubId, userId);

    // Check not already in an active pairing
    const existingPairing = await this.db.rawQuery(
      `SELECT id FROM prediction.club_mentor_pairings
       WHERE club_id = $1 AND mentee_user_id = $2 AND status = 'active'`,
      [clubId, userId],
    );
    if (((existingPairing.data as unknown[] | null) ?? []).length > 0) {
      throw new Error('Already paired with a mentor in this club');
    }

    const id = randomUUID();
    const result = await this.db.rawQuery(
      `INSERT INTO prediction.club_mentee_requests (id, club_id, user_id)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [id, clubId, userId],
    );
    if (result.error) {
      if (result.error.message.includes('unique') || result.error.message.includes('duplicate')) {
        throw new Error('Already requested a mentor in this club');
      }
      throw new Error(result.error.message);
    }
    return ((result.data as MenteeRequest[] | null) ?? [])[0]!;
  }

  async listRequests(clubId: string, userId: string): Promise<MenteeRequest[]> {
    await this.clubService.requireRole(clubId, userId, ['owner', 'admin']);

    const result = await this.db.rawQuery(
      `SELECT r.*, u.display_name
       FROM prediction.club_mentee_requests r
       LEFT JOIN authz.users u ON u.id = r.user_id
       WHERE r.club_id = $1 AND r.status = 'pending'
       ORDER BY r.requested_at ASC`,
      [clubId],
    );
    if (result.error) throw new Error(result.error.message);
    return (result.data as MenteeRequest[] | null) ?? [];
  }

  async pairMentorToMentee(clubId: string, mentorId: string, menteeUserId: string, adminUserId: string): Promise<MentorPairing> {
    await this.clubService.requireRole(clubId, adminUserId, ['owner', 'admin']);

    // Verify mentor is approved
    const mentorResult = await this.db.rawQuery(
      `SELECT * FROM prediction.club_mentors WHERE id = $1 AND club_id = $2 AND status = 'approved'`,
      [mentorId, clubId],
    );
    const mentors = (mentorResult.data as ClubMentor[] | null) ?? [];
    if (mentors.length === 0) throw new Error('Mentor not found or not approved');
    const mentor = mentors[0]!;

    // Enforce 1:3 ratio
    const countResult = await this.db.rawQuery(
      `SELECT COUNT(*)::int as count FROM prediction.club_mentor_pairings
       WHERE mentor_id = $1 AND status = 'active'`,
      [mentorId],
    );
    const activeCount = ((countResult.data as Array<{ count: number }> | null) ?? [])[0]?.count ?? 0;
    if (activeCount >= 3) throw new Error('Mentor already has 3 active mentees');

    // Verify mentee has a pending request
    const reqResult = await this.db.rawQuery(
      `SELECT id FROM prediction.club_mentee_requests
       WHERE club_id = $1 AND user_id = $2 AND status = 'pending'`,
      [clubId, menteeUserId],
    );
    const requests = (reqResult.data as Array<{ id: string }> | null) ?? [];
    if (requests.length === 0) throw new Error('No pending mentee request found');

    // Create DM channel
    const dmChannel = await this.messaging.getOrCreateDmChannel(mentor.user_id, menteeUserId);

    // Create pairing
    const id = randomUUID();
    const result = await this.db.rawQuery(
      `INSERT INTO prediction.club_mentor_pairings (id, club_id, mentor_id, mentee_user_id, dm_channel_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [id, clubId, mentorId, menteeUserId, dmChannel.id],
    );
    if (result.error) throw new Error(result.error.message);

    // Update mentee request to matched
    await this.db.rawQuery(
      `UPDATE prediction.club_mentee_requests SET status = 'matched'
       WHERE club_id = $1 AND user_id = $2 AND status = 'pending'`,
      [clubId, menteeUserId],
    );

    return ((result.data as MentorPairing[] | null) ?? [])[0]!;
  }

  async endPairing(clubId: string, pairingId: string, adminUserId: string): Promise<void> {
    await this.clubService.requireRole(clubId, adminUserId, ['owner', 'admin']);

    const result = await this.db.rawQuery(
      `UPDATE prediction.club_mentor_pairings
       SET status = 'ended', ended_at = now()
       WHERE id = $1 AND club_id = $2 AND status = 'active'
       RETURNING id`,
      [pairingId, clubId],
    );
    if (result.error) throw new Error(result.error.message);
    if (((result.data as unknown[] | null) ?? []).length === 0) {
      throw new Error('Pairing not found or not active');
    }
  }

  // ─── Status & Dashboards ───────────────────────────────────────

  async getMentoringStatus(clubId: string, userId: string): Promise<{
    is_mentor: boolean;
    is_mentee: boolean;
    mentor_info: ClubMentor | null;
    mentees: MentorPairing[];
    my_mentor: (MentorPairing & { mentor_user_id: string; mentor_display_name: string | null }) | null;
    pending_application: ClubMentor | null;
    pending_request: MenteeRequest | null;
  }> {
    await this.clubService.requireMembership(clubId, userId);

    // Check if user is a mentor
    const mentorResult = await this.db.rawQuery(
      `SELECT * FROM prediction.club_mentors WHERE club_id = $1 AND user_id = $2`,
      [clubId, userId],
    );
    const mentorRows = (mentorResult.data as ClubMentor[] | null) ?? [];
    const mentor_info = mentorRows.find(m => m.status === 'approved') ?? null;
    const pending_application = mentorRows.find(m => m.status === 'pending') ?? null;

    // Get mentees if mentor
    let mentees: MentorPairing[] = [];
    if (mentor_info) {
      const menteesResult = await this.db.rawQuery(
        `SELECT p.*, u.display_name
         FROM prediction.club_mentor_pairings p
         LEFT JOIN authz.users u ON u.id = p.mentee_user_id
         WHERE p.mentor_id = $1 AND p.status = 'active'`,
        [mentor_info.id],
      );
      mentees = (menteesResult.data as MentorPairing[] | null) ?? [];
    }

    // Check if user is a mentee
    const menteeResult = await this.db.rawQuery(
      `SELECT p.*, m.user_id as mentor_user_id, u.display_name as mentor_display_name
       FROM prediction.club_mentor_pairings p
       JOIN prediction.club_mentors m ON m.id = p.mentor_id
       LEFT JOIN authz.users u ON u.id = m.user_id
       WHERE p.club_id = $1 AND p.mentee_user_id = $2 AND p.status = 'active'`,
      [clubId, userId],
    );
    const menteeRows = (menteeResult.data as Array<MentorPairing & { mentor_user_id: string; mentor_display_name: string | null }> | null) ?? [];
    const my_mentor = menteeRows[0] ?? null;

    // Check pending request
    const reqResult = await this.db.rawQuery(
      `SELECT * FROM prediction.club_mentee_requests
       WHERE club_id = $1 AND user_id = $2 AND status = 'pending'`,
      [clubId, userId],
    );
    const pending_request = ((reqResult.data as MenteeRequest[] | null) ?? [])[0] ?? null;

    return {
      is_mentor: mentor_info !== null,
      is_mentee: my_mentor !== null,
      mentor_info,
      mentees,
      my_mentor,
      pending_application,
      pending_request,
    };
  }

  async getMentorDashboard(clubId: string, userId: string): Promise<{
    mentees: Array<{
      user_id: string;
      display_name: string | null;
      dm_channel_id: string | null;
      challenges: unknown[];
      journals: unknown[];
      tournaments: unknown[];
    }>;
  }> {

    await this.clubService.requireMembership(clubId, userId);

    // Verify user is an approved mentor
    const mentorResult = await this.db.rawQuery(
      `SELECT id FROM prediction.club_mentors
       WHERE club_id = $1 AND user_id = $2 AND status = 'approved'`,
      [clubId, userId],
    );
    const mentors = (mentorResult.data as Array<{ id: string }> | null) ?? [];
    if (mentors.length === 0) throw new Error('Not an approved mentor in this club');
    const mentorId = mentors[0]!.id;

    // Get active pairings
    const pairingsResult = await this.db.rawQuery(
      `SELECT p.*, u.display_name
       FROM prediction.club_mentor_pairings p
       LEFT JOIN authz.users u ON u.id = p.mentee_user_id
       WHERE p.mentor_id = $1 AND p.status = 'active'`,
      [mentorId],
    );
    const pairings = (pairingsResult.data as MentorPairing[] | null) ?? [];
    if (pairings.length === 0) return { mentees: [] };

    const menteeUserIds = pairings.map(p => p.mentee_user_id);

    // Batch-fetch mentee activity
    const challengesResult = await this.db.rawQuery(
      `SELECT cr.*, c.symbol, c.prompt
       FROM prediction.club_challenge_responses cr
       JOIN prediction.club_prediction_challenges c ON c.id = cr.challenge_id
       WHERE c.club_id = $1 AND cr.user_id = ANY($2)
       ORDER BY cr.submitted_at DESC`,
      [clubId, menteeUserIds],
    );
    const allChallenges = (challengesResult.data as Array<{ user_id: string }> | null) ?? [];

    const journalsResult = await this.db.rawQuery(
      `SELECT * FROM prediction.club_strategy_journals
       WHERE club_id = $1 AND user_id = ANY($2)
       ORDER BY created_at DESC`,
      [clubId, menteeUserIds],
    );
    const allJournals = (journalsResult.data as Array<{ user_id: string }> | null) ?? [];

    const tournamentsResult = await this.db.rawQuery(
      `SELECT te.*, tp.current_balance, tp.total_realized_pnl, tp.total_unrealized_pnl, tp.initial_balance, t.name as tournament_name
       FROM prediction.tournament_entries te
       JOIN prediction.tournaments t ON t.id = te.tournament_id
       LEFT JOIN prediction.tournament_portfolios tp ON tp.id = te.portfolio_id
       WHERE t.scope = 'club' AND t.scope_id = $1 AND te.user_id = ANY($2)
       ORDER BY te.joined_at DESC`,
      [clubId, menteeUserIds],
    );
    const allTournaments = (tournamentsResult.data as Array<{ user_id: string }> | null) ?? [];

    // Group by mentee
    const mentees = pairings.map(p => ({
      user_id: p.mentee_user_id,
      display_name: p.display_name ?? null,
      dm_channel_id: p.dm_channel_id,
      challenges: allChallenges.filter(c => c.user_id === p.mentee_user_id).slice(0, 10),
      journals: allJournals.filter(j => j.user_id === p.mentee_user_id).slice(0, 10),
      tournaments: allTournaments.filter(t => t.user_id === p.mentee_user_id).slice(0, 10),
    }));

    return { mentees };
  }

  async getMyMentor(clubId: string, userId: string): Promise<{
    mentor: {
      user_id: string;
      display_name: string | null;
      dm_channel_id: string | null;
      journals: unknown[];
      tournaments: unknown[];
    };
  }> {

    await this.clubService.requireMembership(clubId, userId);

    const pairingResult = await this.db.rawQuery(
      `SELECT p.*, m.user_id as mentor_user_id, u.display_name
       FROM prediction.club_mentor_pairings p
       JOIN prediction.club_mentors m ON m.id = p.mentor_id
       LEFT JOIN authz.users u ON u.id = m.user_id
       WHERE p.club_id = $1 AND p.mentee_user_id = $2 AND p.status = 'active'`,
      [clubId, userId],
    );
    const pairings = (pairingResult.data as Array<MentorPairing & { mentor_user_id: string; display_name: string | null }> | null) ?? [];
    if (pairings.length === 0) throw new Error('Not paired with a mentor in this club');
    const pairing = pairings[0]!;

    // Mentor's public journals
    const journalsResult = await this.db.rawQuery(
      `SELECT * FROM prediction.club_strategy_journals
       WHERE club_id = $1 AND user_id = $2
       ORDER BY created_at DESC LIMIT 20`,
      [clubId, pairing.mentor_user_id],
    );

    // Mentor's tournament history
    const tournamentsResult = await this.db.rawQuery(
      `SELECT te.*, tp.initial_balance, tp.total_realized_pnl, tp.total_unrealized_pnl, t.name as tournament_name, t.status as tournament_status
       FROM prediction.tournament_entries te
       JOIN prediction.tournaments t ON t.id = te.tournament_id
       LEFT JOIN prediction.tournament_portfolios tp ON tp.id = te.portfolio_id
       WHERE t.scope = 'club' AND t.scope_id = $1 AND te.user_id = $2
       ORDER BY te.joined_at DESC LIMIT 20`,
      [clubId, pairing.mentor_user_id],
    );

    return {
      mentor: {
        user_id: pairing.mentor_user_id,
        display_name: pairing.display_name,
        dm_channel_id: pairing.dm_channel_id,
        journals: (journalsResult.data as unknown[] | null) ?? [],
        tournaments: (tournamentsResult.data as unknown[] | null) ?? [],
      },
    };
  }

  async getMentorLeaderboard(clubId: string, userId: string): Promise<Array<{
    mentor_id: string;
    user_id: string;
    display_name: string | null;
    mentee_count: number;
    avg_rating: number | null;
    tournament_count: number | null;
    win_rate: number | null;
  }>> {
    await this.clubService.requireMembership(clubId, userId);

    const result = await this.db.rawQuery(
      `SELECT m.id as mentor_id, m.user_id, u.display_name,
              m.tournament_count, m.win_rate,
              (SELECT COUNT(*)::int FROM prediction.club_mentor_pairings p WHERE p.mentor_id = m.id AND p.status = 'active') as mentee_count,
              (SELECT AVG(f.rating)::float8 FROM prediction.club_mentor_feedback f
               JOIN prediction.club_mentor_pairings p ON p.id = f.pairing_id
               WHERE p.mentor_id = m.id) as avg_rating
       FROM prediction.club_mentors m
       LEFT JOIN authz.users u ON u.id = m.user_id
       WHERE m.club_id = $1 AND m.status = 'approved'
       ORDER BY avg_rating DESC NULLS LAST, mentee_count DESC`,
      [clubId],
    );
    if (result.error) throw new Error(result.error.message);
    return (result.data as Array<{
      mentor_id: string; user_id: string; display_name: string | null;
      mentee_count: number; avg_rating: number | null;
      tournament_count: number | null; win_rate: number | null;
    }> | null) ?? [];
  }

  // ─── Feedback ──────────────────────────────────────────────────

  async checkPendingFeedback(clubId: string, userId: string): Promise<Array<{ pairing_id: string; mentor_display_name: string | null; current_quarter: string }>> {
    await this.clubService.requireMembership(clubId, userId);

    const now = new Date();
    const quarter = Math.ceil((now.getMonth() + 1) / 3);
    const currentQuarter = `${now.getFullYear()}-Q${quarter}`;

    // Find active pairings where mentee hasn't given feedback this quarter
    const result = await this.db.rawQuery(
      `SELECT p.id as pairing_id, u.display_name as mentor_display_name
       FROM prediction.club_mentor_pairings p
       JOIN prediction.club_mentors m ON m.id = p.mentor_id
       LEFT JOIN authz.users u ON u.id = m.user_id
       WHERE p.club_id = $1 AND p.mentee_user_id = $2 AND p.status = 'active'
         AND NOT EXISTS (
           SELECT 1 FROM prediction.club_mentor_feedback f
           WHERE f.pairing_id = p.id AND f.period_label = $3
         )`,
      [clubId, userId, currentQuarter],
    );
    if (result.error) throw new Error(result.error.message);
    return ((result.data as Array<{ pairing_id: string; mentor_display_name: string | null }> | null) ?? [])
      .map(r => ({ ...r, current_quarter: currentQuarter }));
  }

  async submitFeedback(clubId: string, pairingId: string, userId: string, rating: number, comment?: string): Promise<MentorFeedback> {

    // Verify user is the mentee in this pairing
    const pairingResult = await this.db.rawQuery(
      `SELECT * FROM prediction.club_mentor_pairings
       WHERE id = $1 AND club_id = $2 AND mentee_user_id = $3 AND status = 'active'`,
      [pairingId, clubId, userId],
    );
    if (((pairingResult.data as unknown[] | null) ?? []).length === 0) {
      throw new Error('Pairing not found or you are not the mentee');
    }

    const now = new Date();
    const quarter = Math.ceil((now.getMonth() + 1) / 3);
    const periodLabel = `${now.getFullYear()}-Q${quarter}`;

    const id = randomUUID();
    const result = await this.db.rawQuery(
      `INSERT INTO prediction.club_mentor_feedback (id, pairing_id, mentee_user_id, rating, comment, period_label)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [id, pairingId, userId, rating, comment ?? null, periodLabel],
    );
    if (result.error) {
      if (result.error.message.includes('unique') || result.error.message.includes('duplicate')) {
        throw new Error('Already submitted feedback for this quarter');
      }
      throw new Error(result.error.message);
    }
    return ((result.data as MentorFeedback[] | null) ?? [])[0]!;
  }
}
