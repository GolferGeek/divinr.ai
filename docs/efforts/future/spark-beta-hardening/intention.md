# Effort: Spark Beta Hardening

## Problem

The DGX Spark is a workstation pretending to be a server. It runs Divinr today perfectly well during business hours, but as we move to friends-and-family beta with paying customers (St. Thomas club + Ethan's friends + early Stripe subscribers), we need basic 24/7 reliability.

Without hardening:
- A power blip kills the API in the middle of the night
- An OS update reboot takes the system down for an hour
- A disk failure loses everything
- We don't know about outages until users complain
- Travel anxiety: every trip away from home risks downtime

This effort makes Spark "good enough for paying friends" — not datacenter SLA, but reliable enough that you can sleep at night and take a weekend off.

## Intention

Get Spark to a place where:
1. **Power events don't take it down** (UPS)
2. **Crashes auto-recover** (systemd, fixed and verified)
3. **Data is recoverable** (offsite Postgres backups)
4. **You know about outages immediately** (uptime monitoring with phone alerts)
5. **You can recover from anywhere** (Tailscale already in place; verify SSH path)

This is a one-day project: hardware purchase + a few hours of config + setting up monitoring.

## Scope

### Phase 1: Power Protection (Hardware)
- Buy a CyberPower 1500VA UPS (~$200)
- Plug Spark + network gear (router/modem) into UPS
- Configure NUT (Network UPS Tools) on Spark to receive shutdown signal on low battery
- Test: pull the wall plug, verify graceful shutdown after ~10 minutes of battery

### Phase 2: Service Reliability
- Fix the existing `divinr-dev.service` (currently in restart loop per `systemctl status`)
- Replace `pnpm run dev` with production-mode start (built API only, no Vite dev server)
- Add proper `Restart=always` with backoff
- Add `OnFailure=` notification hook (calls health check / sends alert)
- Verify Postgres autostart on boot
- Verify Supabase services autostart on boot
- Test: hard-reboot Spark, confirm everything comes back up within 2 minutes

### Phase 3: Data Backup
- Sign up for Backblaze B2 (~$0.005/GB/month — pennies for our DB)
- Daily cron job: `pg_dump prediction schema` → upload to B2
- Retention: 30 days of daily, 12 months of monthly
- Test: download a backup, restore to a fresh test DB, verify data integrity
- Document recovery procedure in `docs/operations/disaster-recovery.md`

### Phase 4: Monitoring & Alerts
- Sign up for UptimeRobot (free tier: 50 monitors, 5-minute checks)
- Monitor 3 endpoints:
  - `https://divinr.ai/health` (web up via Cloudflare)
  - `https://divinr.ai/api/health` (API up via Cloudflare)
  - Direct Spark IP via Tailscale (catches Cloudflare issues vs Spark issues)
- SMS or push notification to phone on any outage > 2 checks (10 min)
- Optional: Better Stack ($0/mo for basic) for richer status page

### Phase 5: Health Check Hardening
- Existing `/health` endpoint is shallow — just returns OK if API is up
- Extend to verify:
  - Database connection alive
  - Recent prediction run completed (< 24h ago)
  - Disk space > 10% free
  - Ollama responding
- Make health check the early-warning system before users notice

### Phase 6: Recovery Documentation
- Write `docs/operations/runbook.md`:
  - How to SSH in (Tailscale + key)
  - How to restart services
  - How to roll back a bad deployment
  - How to restore from backup
  - Phone numbers / accounts you'd need from a coffee shop
- Print a copy. Put it somewhere physical.

## What This Doesn't Cover

- True high-availability (would need a second machine)
- Sub-minute recovery times (acceptable beta posture: 10-30 min)
- Geographic redundancy
- ECC RAM (Spark's RAM config is fixed)
- Replacing Cloudflare / dynamic DNS — assumes existing setup works

## Cost Summary

| Item | Cost |
|------|------|
| CyberPower 1500VA UPS | ~$200 (one-time) |
| Backblaze B2 backups | ~$2/month |
| UptimeRobot Free | $0 |
| Total | **$200 one-time + $2/month** |

## Success Criteria

- Spark recovers from a hard power-cycle within 2 minutes (services + DB up, health check green)
- Daily Postgres backups verified working (test restore)
- Phone gets alert within 10 minutes of any service going down
- Documented recovery procedures exist (offline copy + repo copy)
- You can take a weekend trip without anxiety

## When to Move Off Spark

This effort makes Spark "good enough for beta." We migrate to cloud (OpenRouter + Google Cloud or similar) when:
- Power-user authorship volume grows (per-item $20/$60 authorships compound Stage-1 fanout beyond Spark's serial inference throughput)
- Sustained traffic exceeds Spark capacity (~40 instruments, ~10 analysts)
- Day trader features need intraday cycles (parallel inference)
- Revenue covers the migration cost (~$1,200/mo at Launch scale)

Until then, hardened Spark is the right answer.
