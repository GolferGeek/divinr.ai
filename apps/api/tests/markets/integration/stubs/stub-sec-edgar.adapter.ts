import { join } from 'node:path';
import { Injectable } from '@nestjs/common';
import { SecEdgarAdapter } from '../../../../src/markets/adapters/sec-edgar.adapter';
import { StubAdapterBase } from './stub-adapter-base';

const FIXTURES_DIR = join(__dirname, '..', '..', '..', 'fixtures', 'markets', 'sec-edgar');

@Injectable()
export class StubSecEdgarAdapter extends StubAdapterBase {
  constructor() {
    super({
      id: 'ds-sec-edgar',
      name: 'SEC EDGAR',
      provider: 'sec-edgar',
      tier: 'free',
      rateLimitPerMinute: 600,
      fixturesDir: FIXTURES_DIR,
      realAdapterFactory: () => new SecEdgarAdapter(),
    });
  }
}
