import { join } from 'node:path';
import { Injectable } from '@nestjs/common';
import { FinnhubAdapter } from '../../../../src/markets/adapters/finnhub.adapter';
import { StubAdapterBase } from './stub-adapter-base';

const FIXTURES_DIR = join(__dirname, '..', '..', '..', 'fixtures', 'markets', 'finnhub');

@Injectable()
export class StubFinnhubAdapter extends StubAdapterBase {
  constructor() {
    super({
      id: 'ds-finnhub',
      name: 'Finnhub',
      provider: 'finnhub',
      tier: 'free',
      rateLimitPerMinute: 60,
      fixturesDir: FIXTURES_DIR,
      realAdapterFactory: () => new FinnhubAdapter(),
    });
  }
}
