export type TournamentScope = 'system' | 'club' | 'invitation';
export type TournamentType = 'weekly_sprint' | 'sector_challenge' | 'analyst_draft';
export type TournamentStatus = 'upcoming' | 'active' | 'completed' | 'archived';

export interface Tournament {
  id: string;
  name: string;
  description: string | null;
  scope: TournamentScope;
  scope_id: string | null;
  tournament_type: TournamentType;
  status: TournamentStatus;
  created_by: string;
  starting_balance: number;
  allowed_instruments: string[] | null;
  analyst_draft_config: { pick_count: number } | null;
  starts_at: string;
  ends_at: string;
  channel_id: string | null;
  created_at: string;
  player_count?: number;
}

export interface TournamentEntry {
  id: string;
  tournament_id: string;
  user_id: string;
  portfolio_id: string;
  drafted_analysts: string[] | null;
  final_rank: number | null;
  joined_at: string;
}

export interface TournamentPortfolio {
  id: string;
  tournament_id: string;
  user_id: string;
  initial_balance: number;
  current_balance: number;
  total_realized_pnl: number;
  total_unrealized_pnl: number;
  created_at: string;
}

export interface TournamentPosition {
  id: string;
  tournament_id: string;
  portfolio_id: string;
  user_id: string;
  symbol: string;
  direction: 'long' | 'short';
  quantity: number;
  entry_price: number | null;
  current_price: number | null;
  exit_price: number | null;
  unrealized_pnl: number;
  realized_pnl: number;
  status: 'open' | 'closed';
  opened_at: string | null;
  closed_at: string | null;
}

export interface TournamentTradeQueueEntry {
  id: string;
  tournament_id: string;
  portfolio_id: string;
  user_id: string;
  prediction_id: string | null;
  symbol: string;
  direction: 'long' | 'short';
  quantity: number;
  status: 'queued' | 'executed' | 'cancelled';
  queued_at: string;
  execution_price: number | null;
  executed_at: string | null;
}

export interface TournamentInvite {
  id: string;
  tournament_id: string;
  invite_token: string;
  invited_by: string;
  invited_user_id: string | null;
  invited_email: string | null;
  status: 'pending' | 'accepted' | 'expired';
  created_at: string;
}

export interface CreateTournamentInput {
  name: string;
  description?: string;
  scope: TournamentScope;
  scope_id?: string;
  tournament_type: TournamentType;
  starting_balance: number;
  allowed_instruments?: string[];
  analyst_draft_config?: { pick_count: number };
  starts_at: string;
  ends_at: string;
}

export interface UpdateTournamentInput {
  name?: string;
  description?: string;
  starting_balance?: number;
  allowed_instruments?: string[];
  analyst_draft_config?: { pick_count: number };
  starts_at?: string;
  ends_at?: string;
}

export interface ListTournamentsFilters {
  scope?: TournamentScope;
  status?: TournamentStatus;
  tournament_type?: TournamentType;
}
