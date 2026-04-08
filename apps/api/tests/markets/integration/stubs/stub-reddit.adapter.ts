import { join } from 'node:path';
import { Injectable } from '@nestjs/common';
import { RedditAdapter } from '../../../../src/markets/adapters/reddit.adapter';
import { StubAdapterBase } from './stub-adapter-base';

const FIXTURES_DIR = join(__dirname, '..', '..', '..', 'fixtures', 'markets', 'reddit');

@Injectable()
export class StubRedditAdapter extends StubAdapterBase {
  constructor() {
    super({
      id: 'ds-reddit',
      name: 'Reddit',
      provider: 'reddit',
      tier: 'free',
      rateLimitPerMinute: 100,
      fixturesDir: FIXTURES_DIR,
      realAdapterFactory: () => new RedditAdapter(),
    });
  }
}
