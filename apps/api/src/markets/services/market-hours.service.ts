import { Injectable } from '@nestjs/common';

@Injectable()
export class MarketHoursService {
  isUsEquityMarketOpen(now: Date): boolean {
    if (process.env.DAY_TRADER_IGNORE_MARKET_HOURS === 'true') return true;

    const day = now.getUTCDay();
    if (day === 0 || day === 6) return false;

    const minutesUtc = now.getUTCHours() * 60 + now.getUTCMinutes();
    const OPEN_MIN = 14 * 60 + 30;
    const CLOSE_MIN = 21 * 60;
    return minutesUtc >= OPEN_MIN && minutesUtc < CLOSE_MIN;
  }
}
