import type { InstrumentState, PrimaryMetric, PredictionPlaneState } from '../prediction-plane.interface';

export class StocksStateService implements PredictionPlaneState {
  getPrimaryMetric(state: InstrumentState): PrimaryMetric {
    const price = typeof state.data['price'] === 'number' ? state.data['price'] : 0;
    const changePct = typeof state.data['change_pct'] === 'number' ? state.data['change_pct'] : undefined;

    return {
      value: price,
      label: 'Price',
      changePct,
    };
  }

  formatMetric(metric: PrimaryMetric): string {
    const price = `$${metric.value.toFixed(2)}`;
    if (metric.changePct !== undefined) {
      const sign = metric.changePct >= 0 ? '+' : '';
      return `${price} (${sign}${metric.changePct.toFixed(1)}%)`;
    }
    return price;
  }

  getPromptContext(symbol: string, name: string, state: InstrumentState): string {
    const parts: string[] = [`${symbol} (${name})`];

    const price = state.data['price'];
    if (typeof price === 'number') {
      parts.push(`is trading at $${price.toFixed(2)}`);
    }

    const changePct = state.data['change_pct'];
    if (typeof changePct === 'number') {
      const sign = changePct >= 0 ? 'up' : 'down';
      parts.push(`${sign} ${Math.abs(changePct).toFixed(1)}% today`);
    }

    const marketCap = state.data['market_cap'];
    if (typeof marketCap === 'number') {
      const formatted = marketCap >= 1e12 ? `$${(marketCap / 1e12).toFixed(1)}T` : `$${(marketCap / 1e9).toFixed(1)}B`;
      parts.push(`Market cap ${formatted}`);
    }

    const pe = state.data['pe_ratio'];
    if (typeof pe === 'number') {
      parts.push(`P/E ${pe.toFixed(1)}`);
    }

    return parts.join('. ') + '.';
  }
}
