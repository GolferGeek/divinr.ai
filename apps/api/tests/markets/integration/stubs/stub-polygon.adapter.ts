import { join } from 'node:path';
import { Injectable } from '@nestjs/common';
import { PolygonAdapter } from '../../../../src/markets/adapters/polygon.adapter';
import { StubAdapterBase } from './stub-adapter-base';

const FIXTURES_DIR = join(__dirname, '..', '..', '..', 'fixtures', 'markets', 'polygon');

@Injectable()
export class StubPolygonAdapter extends StubAdapterBase {
  constructor() {
    super({
      id: 'ds-polygon',
      name: 'Polygon.io',
      provider: 'polygon',
      tier: 'free',
      rateLimitPerMinute: 5,
      fixturesDir: FIXTURES_DIR,
      realAdapterFactory: () => new PolygonAdapter(),
    });
  }
}
