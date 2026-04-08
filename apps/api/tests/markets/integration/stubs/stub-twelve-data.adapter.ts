import { join } from 'node:path';
import { Injectable } from '@nestjs/common';
import { TwelveDataAdapter } from '../../../../src/markets/adapters/twelve-data.adapter';
import { StubAdapterBase } from './stub-adapter-base';

const FIXTURES_DIR = join(__dirname, '..', '..', '..', 'fixtures', 'markets', 'twelve-data');

@Injectable()
export class StubTwelveDataAdapter extends StubAdapterBase {
  constructor() {
    super({
      id: 'ds-twelve-data',
      name: 'Twelve Data',
      provider: 'twelve-data',
      tier: 'free',
      rateLimitPerMinute: 8,
      fixturesDir: FIXTURES_DIR,
      realAdapterFactory: () => new TwelveDataAdapter(),
    });
  }
}
