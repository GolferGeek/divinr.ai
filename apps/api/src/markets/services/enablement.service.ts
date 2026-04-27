import { Injectable, Inject } from '@nestjs/common';
import { DATABASE_SERVICE, type DatabaseService } from '@orchestratorai/planes/database';
import { MarketsSchemaService } from '../schema/markets-schema.service';

export interface EnabledTriple {
  id: string;
  authorUserId: string | null;
  analystId: string;
  analystName: string;
  analystSlug: string;
  isAuthoredAnalyst: boolean;
  instrumentId: string;
  instrumentSymbol: string;
  instrumentName: string;
  isAuthoredInstrument: boolean;
  enabledAt: string;
}

export interface AvailableTriple {
  analystId: string;
  analystName: string;
  analystSlug: string;
  isAuthoredAnalyst: boolean;
  instrumentId: string;
  instrumentSymbol: string;
  instrumentName: string;
  isAuthoredInstrument: boolean;
  isEnabled: boolean;
  authorUserId: string | null;
}

@Injectable()
export class EnablementService {
  constructor(
    @Inject(DATABASE_SERVICE) private readonly db: DatabaseService,
    @Inject(MarketsSchemaService) private readonly schema: MarketsSchemaService,
  ) {}

  async listEnabledTriples(userId: string): Promise<EnabledTriple[]> {

    const result = await this.db.rawQuery(
      `SELECT
         uet.id,
         uet.author_user_id   AS "authorUserId",
         uet.analyst_id       AS "analystId",
         ma.display_name      AS "analystName",
         ma.slug              AS "analystSlug",
         (ma.user_id IS NOT NULL) AS "isAuthoredAnalyst",
         uet.instrument_id    AS "instrumentId",
         i.symbol             AS "instrumentSymbol",
         i.name               AS "instrumentName",
         (i.user_id IS NOT NULL) AS "isAuthoredInstrument",
         uet.enabled_at       AS "enabledAt"
       FROM prediction.user_enabled_triples uet
       JOIN prediction.market_analysts ma ON ma.id = uet.analyst_id
       JOIN prediction.instruments i      ON i.id  = uet.instrument_id
       WHERE uet.user_id = $1
         AND uet.disabled_at IS NULL
         AND ma.is_active = true
         AND i.is_active  = true
       ORDER BY i.symbol, ma.display_name`,
      [userId],
    );

    const rows = (result.data as EnabledTriple[] | null) ?? [];

    if (rows.length === 0) {
      await this.seedStarterTriples(userId);
      return this.listEnabledTriples(userId);
    }

    return rows;
  }

  async enableTriple(
    userId: string,
    analystId: string,
    instrumentId: string,
    authorUserId?: string | null,
  ): Promise<EnabledTriple> {

    await this.db.rawQuery(
      `INSERT INTO prediction.user_enabled_triples
         (user_id, author_user_id, analyst_id, instrument_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, COALESCE(author_user_id, 'base'), analyst_id, instrument_id)
       DO UPDATE SET disabled_at = NULL, enabled_at = now()`,
      [userId, authorUserId ?? null, analystId, instrumentId],
    );

    const result = await this.db.rawQuery(
      `SELECT
         uet.id,
         uet.author_user_id   AS "authorUserId",
         uet.analyst_id       AS "analystId",
         ma.display_name      AS "analystName",
         ma.slug              AS "analystSlug",
         (ma.user_id IS NOT NULL) AS "isAuthoredAnalyst",
         uet.instrument_id    AS "instrumentId",
         i.symbol             AS "instrumentSymbol",
         i.name               AS "instrumentName",
         (i.user_id IS NOT NULL) AS "isAuthoredInstrument",
         uet.enabled_at       AS "enabledAt"
       FROM prediction.user_enabled_triples uet
       JOIN prediction.market_analysts ma ON ma.id = uet.analyst_id
       JOIN prediction.instruments i      ON i.id  = uet.instrument_id
       WHERE uet.user_id = $1
         AND uet.analyst_id = $3
         AND uet.instrument_id = $4
         AND COALESCE(uet.author_user_id, 'base') = COALESCE($2, 'base')`,
      [userId, authorUserId ?? null, analystId, instrumentId],
    );

    return ((result.data as EnabledTriple[] | null) ?? [])[0];
  }

  async disableTriple(
    userId: string,
    analystId: string,
    instrumentId: string,
    authorUserId?: string | null,
  ): Promise<void> {

    await this.db.rawQuery(
      `UPDATE prediction.user_enabled_triples
       SET disabled_at = now()
       WHERE user_id = $1
         AND analyst_id = $2
         AND instrument_id = $3
         AND COALESCE(author_user_id, 'base') = COALESCE($4, 'base')
         AND disabled_at IS NULL`,
      [userId, analystId, instrumentId, authorUserId ?? null],
    );
  }

  async listAvailableTriples(
    userId: string,
    instrumentId?: string,
  ): Promise<AvailableTriple[]> {

    const instrumentFilter = instrumentId
      ? `AND i.id = $2`
      : '';
    const params: string[] = instrumentId ? [userId, instrumentId] : [userId];

    const result = await this.db.rawQuery(
      `WITH available AS (
         -- Base analyst x base instrument (all combinations)
         SELECT
           ma.id          AS analyst_id,
           ma.display_name AS analyst_name,
           ma.slug        AS analyst_slug,
           false          AS is_authored_analyst,
           i.id           AS instrument_id,
           i.symbol       AS instrument_symbol,
           i.name         AS instrument_name,
           false          AS is_authored_instrument,
           NULL::text     AS author_user_id
         FROM prediction.market_analysts ma
         CROSS JOIN prediction.instruments i
         WHERE ma.user_id IS NULL AND ma.is_active = true
           AND i.user_id IS NULL  AND i.is_active  = true
           ${instrumentFilter}

         UNION ALL

         -- Authored content via wiring assignments
         SELECT
           ma.id          AS analyst_id,
           ma.display_name AS analyst_name,
           ma.slug        AS analyst_slug,
           (ma.user_id IS NOT NULL) AS is_authored_analyst,
           i.id           AS instrument_id,
           i.symbol       AS instrument_symbol,
           i.name         AS instrument_name,
           (i.user_id IS NOT NULL) AS is_authored_instrument,
           COALESCE(ma.user_id, i.user_id) AS author_user_id
         FROM prediction.viewer_instrument_analyst_assignments viaa
         JOIN prediction.market_analysts ma ON ma.id = viaa.analyst_id
         JOIN prediction.instruments i      ON i.id  = viaa.instrument_id
         WHERE viaa.viewer_user_id = $1
           AND ma.is_active = true
           AND i.is_active  = true
           AND (ma.user_id IS NOT NULL OR i.user_id IS NOT NULL)
           ${instrumentFilter}
       )
       SELECT
         a.analyst_id      AS "analystId",
         a.analyst_name    AS "analystName",
         a.analyst_slug    AS "analystSlug",
         a.is_authored_analyst AS "isAuthoredAnalyst",
         a.instrument_id   AS "instrumentId",
         a.instrument_symbol AS "instrumentSymbol",
         a.instrument_name AS "instrumentName",
         a.is_authored_instrument AS "isAuthoredInstrument",
         (uet.id IS NOT NULL AND uet.disabled_at IS NULL) AS "isEnabled",
         a.author_user_id  AS "authorUserId"
       FROM available a
       LEFT JOIN prediction.user_enabled_triples uet
         ON uet.user_id = $1
         AND uet.analyst_id = a.analyst_id
         AND uet.instrument_id = a.instrument_id
         AND COALESCE(uet.author_user_id, 'base') = COALESCE(a.author_user_id, 'base')
       ORDER BY a.instrument_symbol, a.analyst_name`,
      params,
    );

    return (result.data as AvailableTriple[] | null) ?? [];
  }

  async seedStarterTriples(userId: string): Promise<void> {

    const hasRows = await this.db.rawQuery(
      `SELECT 1 FROM prediction.user_enabled_triples
       WHERE user_id = $1 LIMIT 1`,
      [userId],
    );

    if (((hasRows.data as any[] | null) ?? []).length > 0) return;

    await this.db.rawQuery(
      `INSERT INTO prediction.user_enabled_triples
         (user_id, author_user_id, analyst_id, instrument_id)
       SELECT $1, NULL, ma.id, i.id
       FROM prediction.market_analysts ma
       CROSS JOIN (
         SELECT id FROM prediction.instruments
         WHERE user_id IS NULL AND is_active = true
         ORDER BY symbol
         LIMIT 5
       ) i
       WHERE ma.user_id IS NULL AND ma.is_active = true
       ON CONFLICT DO NOTHING`,
      [userId],
    );
  }
}
