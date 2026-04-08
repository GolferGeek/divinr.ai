import { join } from 'node:path';
import { Injectable } from '@nestjs/common';
import { FredAdapter } from '../../../../src/markets/adapters/fred.adapter';
import { StubAdapterBase } from './stub-adapter-base';

const FIXTURES_DIR = join(__dirname, '..', '..', '..', 'fixtures', 'markets', 'fred');

@Injectable()
export class StubFredAdapter extends StubAdapterBase {
  constructor() {
    super({
      id: 'ds-fred',
      name: 'FRED',
      provider: 'fred',
      tier: 'free',
      rateLimitPerMinute: 120,
      fixturesDir: FIXTURES_DIR,
      realAdapterFactory: () => new FredAdapter(),
    });
  }
}
