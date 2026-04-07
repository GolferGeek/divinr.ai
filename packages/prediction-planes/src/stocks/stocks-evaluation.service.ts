import type {
  ActualOutcome,
  EvaluationHorizon,
  EvaluationScore,
  PredictionPlaneEvaluation,
} from '../prediction-plane.interface';

/**
 * Threshold (in percent) below which a price move is treated as flat.
 * Anything within ±FLAT_THRESHOLD_PCT is considered no directional change.
 */
const FLAT_THRESHOLD_PCT = 0.25;

declare const process: { env: Record<string, string | undefined> };

/**
 * Thrown when the underlying data source has no bars covering the requested
 * window — typically because the evaluation date is in the future relative to
 * the provider's available history. Caller should treat as "not yet evaluable",
 * not as a real failure.
 */
export class OutcomeDataNotAvailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OutcomeDataNotAvailableError';
  }
}

interface PolygonAggBar {
  c: number; // close
  o: number; // open
  h: number; // high
  l: number; // low
  t: number; // timestamp ms
}

interface PolygonAggResponse {
  results?: PolygonAggBar[];
  status?: string;
  resultsCount?: number;
}

export class StocksEvaluationService implements PredictionPlaneEvaluation {
  // Per-instance cache: symbol → bars for the latest requested window.
  // Avoids hammering Polygon when many analysts predict the same instrument.
  private barsCache = new Map<string, { from: string; to: string; bars: PolygonAggBar[] }>();

  /**
   * Look up the actual price movement for an instrument between predictionDate
   * and evaluationDate. Uses Polygon's daily aggregates endpoint.
   *
   * Throws if no price data is available for the requested range — caller is
   * expected to catch and skip the prediction.
   */
  async evaluateOutcome(
    instrumentId: string,
    predictionDate: Date,
    evaluationDate: Date,
  ): Promise<ActualOutcome> {
    const apiKey = process.env.POLYGON_API_KEY;
    if (!apiKey) {
      throw new Error('POLYGON_API_KEY not configured — cannot evaluate outcomes');
    }

    // The instrumentId is a UUID; symbol resolution happens in the caller.
    // We accept either symbol or UUID and treat the input as a symbol if it
    // looks like a ticker. Caller is responsible for passing a symbol-like value.
    const symbol = instrumentId;

    // Fetch a broad window so the cache covers many horizons of the same symbol.
    const from = isoDate(addDays(predictionDate, -14));
    const to = isoDate(addDays(evaluationDate, 14));

    // Check cache: reuse bars if a previous fetch covers this window.
    const cached = this.barsCache.get(symbol);
    let bars: PolygonAggBar[] | null = null;
    if (cached && cached.from <= from && cached.to >= to) {
      bars = cached.bars;
    }

    if (!bars) {
      const url =
        `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(symbol)}` +
        `/range/1/day/${from}/${to}?adjusted=true&sort=asc&limit=120&apiKey=${apiKey}`;

      const response = await this.fetchBars(url, symbol);
      const data = (await response.json()) as PolygonAggResponse;
      bars = data.results ?? [];
      this.barsCache.set(symbol, { from, to, bars });
    }

    return this.scoreFromBars(symbol, predictionDate, evaluationDate, bars);
  }

  private async fetchBars(url: string, symbol: string): Promise<Response> {
    const response = await fetch(url);
    if (response.status === 429) {
      // Rate limited — transient, retry on next nightly cycle.
      throw new OutcomeDataNotAvailableError(
        `Polygon rate limited for ${symbol} — will retry next cycle`,
      );
    }
    if (!response.ok) {
      throw new Error(`Polygon ${response.status} ${response.statusText} for ${symbol}`);
    }
    return response;
  }

  private scoreFromBars(
    symbol: string,
    predictionDate: Date,
    evaluationDate: Date,
    bars: PolygonAggBar[],
  ): ActualOutcome {
    if (bars.length === 0) {
      throw new OutcomeDataNotAvailableError(
        `No price bars for ${symbol} around ${isoDate(predictionDate)}–${isoDate(evaluationDate)}`,
      );
    }

    const startBar = pickBarOnOrAfter(bars, predictionDate.getTime());
    const endBar = pickBarOnOrBefore(bars, evaluationDate.getTime());

    if (!startBar || !endBar || startBar.t === endBar.t) {
      throw new OutcomeDataNotAvailableError(
        `Insufficient bars for ${symbol}: prediction=${predictionDate.toISOString()} ` +
          `evaluation=${evaluationDate.toISOString()}`,
      );
    }

    const startPrice = startBar.c;
    const endPrice = endBar.c;
    const changePct = startPrice > 0 ? ((endPrice - startPrice) / startPrice) * 100 : 0;

    let direction: 'up' | 'down' | 'flat';
    if (changePct > FLAT_THRESHOLD_PCT) direction = 'up';
    else if (changePct < -FLAT_THRESHOLD_PCT) direction = 'down';
    else direction = 'flat';

    return {
      data: {
        symbol,
        priceAtPrediction: startPrice,
        priceAtHorizon: endPrice,
        changePercent: Number(changePct.toFixed(4)),
        startBarTimestamp: new Date(startBar.t).toISOString(),
        endBarTimestamp: new Date(endBar.t).toISOString(),
      },
      direction,
      determinedAt: new Date().toISOString(),
    };
  }

  scorePrediction(
    predicted: { direction: string; confidence: number },
    actual: ActualOutcome,
  ): EvaluationScore {
    const wasCorrect = predicted.direction === actual.direction;
    const normalizedConfidence = Math.min(Math.max(predicted.confidence, 0), 100) / 100;

    // Calibration: how well did confidence predict accuracy?
    // For a single prediction, calibration = 1 - |confidence - accuracy|
    const accuracy = wasCorrect ? 1 : 0;
    const calibration = 1 - Math.abs(normalizedConfidence - accuracy);

    return {
      wasCorrect,
      accuracy,
      calibration,
      details: {
        predictedDirection: predicted.direction,
        actualDirection: actual.direction,
        confidenceAtPrediction: predicted.confidence,
      },
    };
  }

  getDefaultHorizons(): EvaluationHorizon[] {
    return [
      { value: 1, unit: 'days', label: '1 Day' },
      { value: 3, unit: 'days', label: '3 Days' },
      { value: 5, unit: 'days', label: '5 Days' },
    ];
  }
}

// ─── helpers ──────────────────────────────────────────────────────

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, days: number): Date {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + days);
  return r;
}

function pickBarOnOrAfter(bars: PolygonAggBar[], targetMs: number): PolygonAggBar | null {
  for (const b of bars) if (b.t >= targetMs) return b;
  return null;
}

function pickBarOnOrBefore(bars: PolygonAggBar[], targetMs: number): PolygonAggBar | null {
  let last: PolygonAggBar | null = null;
  for (const b of bars) {
    if (b.t <= targetMs) last = b;
    else break;
  }
  return last;
}
