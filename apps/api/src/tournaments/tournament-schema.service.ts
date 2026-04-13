import { Injectable, Inject, Logger } from '@nestjs/common';
import { DATABASE_SERVICE, type DatabaseService } from '@orchestratorai/planes/database';

@Injectable()
export class TournamentSchemaService {
  private schemaReady = false;
  private readonly logger = new Logger(TournamentSchemaService.name);

  constructor(
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
  ) {}

  async ensureSchema(): Promise<void> {
    if (this.schemaReady) return;

    const ddl = `
      CREATE TABLE IF NOT EXISTS prediction.tournaments (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        name TEXT NOT NULL,
        description TEXT,
        scope TEXT NOT NULL CHECK (scope IN ('system', 'club', 'invitation')),
        scope_id TEXT,
        tournament_type TEXT NOT NULL CHECK (tournament_type IN ('weekly_sprint', 'sector_challenge', 'analyst_draft')),
        status TEXT NOT NULL DEFAULT 'upcoming' CHECK (status IN ('upcoming', 'active', 'completed', 'archived')),
        created_by TEXT NOT NULL,
        starting_balance NUMERIC NOT NULL,
        allowed_instruments JSONB,
        analyst_draft_config JSONB,
        starts_at TIMESTAMPTZ NOT NULL,
        ends_at TIMESTAMPTZ NOT NULL,
        channel_id TEXT,
        created_at TIMESTAMPTZ DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS prediction.tournament_portfolios (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        tournament_id TEXT NOT NULL REFERENCES prediction.tournaments(id),
        user_id TEXT NOT NULL,
        initial_balance NUMERIC NOT NULL,
        current_balance NUMERIC NOT NULL,
        total_realized_pnl NUMERIC DEFAULT 0,
        total_unrealized_pnl NUMERIC DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS prediction.tournament_entries (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        tournament_id TEXT NOT NULL REFERENCES prediction.tournaments(id),
        user_id TEXT NOT NULL,
        portfolio_id TEXT NOT NULL REFERENCES prediction.tournament_portfolios(id),
        drafted_analysts JSONB,
        final_rank INTEGER,
        joined_at TIMESTAMPTZ DEFAULT now(),
        UNIQUE (tournament_id, user_id)
      );

      CREATE TABLE IF NOT EXISTS prediction.tournament_positions (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        tournament_id TEXT NOT NULL REFERENCES prediction.tournaments(id),
        portfolio_id TEXT NOT NULL REFERENCES prediction.tournament_portfolios(id),
        user_id TEXT NOT NULL,
        symbol TEXT NOT NULL,
        direction TEXT NOT NULL CHECK (direction IN ('long', 'short')),
        quantity NUMERIC NOT NULL,
        entry_price NUMERIC,
        current_price NUMERIC,
        exit_price NUMERIC,
        unrealized_pnl NUMERIC DEFAULT 0,
        realized_pnl NUMERIC DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
        opened_at TIMESTAMPTZ,
        closed_at TIMESTAMPTZ
      );

      CREATE TABLE IF NOT EXISTS prediction.tournament_trade_queue (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        tournament_id TEXT NOT NULL REFERENCES prediction.tournaments(id),
        portfolio_id TEXT NOT NULL REFERENCES prediction.tournament_portfolios(id),
        user_id TEXT NOT NULL,
        prediction_id TEXT,
        symbol TEXT NOT NULL,
        direction TEXT NOT NULL CHECK (direction IN ('long', 'short')),
        quantity NUMERIC NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'executed', 'cancelled')),
        queued_at TIMESTAMPTZ DEFAULT now(),
        execution_price NUMERIC,
        executed_at TIMESTAMPTZ
      );

      CREATE TABLE IF NOT EXISTS prediction.tournament_invites (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        tournament_id TEXT NOT NULL REFERENCES prediction.tournaments(id),
        invite_token TEXT NOT NULL UNIQUE,
        invited_by TEXT NOT NULL,
        invited_user_id TEXT,
        invited_email TEXT,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'expired')),
        created_at TIMESTAMPTZ DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS idx_tournaments_status ON prediction.tournaments(status);
      CREATE INDEX IF NOT EXISTS idx_tournament_entries_tournament_user ON prediction.tournament_entries(tournament_id, user_id);
      CREATE INDEX IF NOT EXISTS idx_tournament_portfolios_tournament_user ON prediction.tournament_portfolios(tournament_id, user_id);
      CREATE INDEX IF NOT EXISTS idx_tournament_positions_tournament ON prediction.tournament_positions(tournament_id, status);
      CREATE INDEX IF NOT EXISTS idx_tournament_positions_portfolio ON prediction.tournament_positions(portfolio_id, status);
      CREATE INDEX IF NOT EXISTS idx_tournament_trade_queue_status ON prediction.tournament_trade_queue(tournament_id, status);
      CREATE INDEX IF NOT EXISTS idx_tournament_invites_token ON prediction.tournament_invites(invite_token);
      CREATE INDEX IF NOT EXISTS idx_tournaments_created_by ON prediction.tournaments(created_by);
    `;

    const result = await this.db.rawQuery(ddl);
    if (result.error) {
      throw new Error(`Tournament schema creation failed: ${result.error.message}`);
    }

    this.schemaReady = true;
    this.logger.log('Tournament schema ready');
  }
}
