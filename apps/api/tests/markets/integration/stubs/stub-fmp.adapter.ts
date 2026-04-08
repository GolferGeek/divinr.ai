import { join } from 'node:path';
import { Injectable } from '@nestjs/common';
import { FmpAdapter } from '../../../../src/markets/adapters/fmp.adapter';
import { StubAdapterBase } from './stub-adapter-base';

const FIXTURES_DIR = join(__dirname, '..', '..', '..', 'fixtures', 'markets', 'fmp');

@Injectable()
export class StubFmpAdapter extends StubAdapterBase {
  constructor() {
    super({
      id: 'ds-fmp',
      name: 'Financial Modeling Prep',
      provider: 'fmp',
      tier: 'free',
      rateLimitPerMinute: 4,
      fixturesDir: FIXTURES_DIR,
      realAdapterFactory: () => new FmpAdapter(),
    });
  }
}
