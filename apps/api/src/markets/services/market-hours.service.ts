import { Injectable } from '@nestjs/common';

const ET_TZ = 'America/New_York';
const OPEN_ET_MINUTES = 9 * 60 + 30;
const CLOSE_ET_MINUTES = 16 * 60;

@Injectable()
export class MarketHoursService {
  isUsEquityMarketOpen(now: Date): boolean {
    if (process.env.DAY_TRADER_IGNORE_MARKET_HOURS === 'true') return true;

    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: ET_TZ,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(now);

    const by = (type: string) => parts.find(p => p.type === type)?.value ?? '';
    const weekday = by('weekday');
    if (weekday === 'Sat' || weekday === 'Sun') return false;

    const hour = Number(by('hour'));
    const minute = Number(by('minute'));
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return false;

    const etMinutes = (hour % 24) * 60 + minute;
    return etMinutes >= OPEN_ET_MINUTES && etMinutes < CLOSE_ET_MINUTES;
  }
}
