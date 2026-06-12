/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Scheduled jobs — protect with CRON_SECRET (Cloud Scheduler sends X-Cron-Secret).
 */

import { Router, type NextFunction, type Request, type Response } from 'express';
import type { CandleSyncService } from '../services/candleSyncService.js';
import type { NewsSyncService } from '../services/newsSyncService.js';

function verifyCronSecret(req: Request, res: Response, next: NextFunction): void {
  const secret = process.env.CRON_SECRET?.trim();

  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      res.status(503).json({ error: 'CRON_SECRET is not configured on the server' });
      return;
    }
    console.warn('[Cron] CRON_SECRET unset — allowing request in non-production');
    next();
    return;
  }

  const header =
    req.header('X-Cron-Secret') ??
    req.header('Authorization')?.replace(/^Bearer\s+/i, '') ??
    '';

  if (header !== secret) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  next();
}

export function createCronRouter(
  candleSyncService: CandleSyncService,
  newsSyncService?: NewsSyncService
): Router {
  const router = Router();

  router.get('/health', (_req, res) => {
    res.json({
      ok: true,
      jobs: ['candle-sync', ...(newsSyncService ? ['news-sync'] : [])],
      symbols: candleSyncService.getSymbols(),
    });
  });

  router.post('/candle-sync', verifyCronSecret, async (_req, res) => {
    try {
      const result = await candleSyncService.syncAll();
      const failed = result.symbols.filter((s) => !s.ok);
      const status = failed.length === result.symbols.length ? 502 : failed.length > 0 ? 207 : 200;
      res.status(status).json({ ok: failed.length === 0, ...result });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Candle sync failed';
      console.error('[Cron] /candle-sync error:', message);
      res.status(409).json({ ok: false, error: message });
    }
  });

  if (newsSyncService) {
    router.post('/news-sync', verifyCronSecret, async (_req, res) => {
      try {
        const result = await newsSyncService.syncFromUpstream();
        const status = result.ok ? 200 : result.skipped ? 200 : 502;
        res.status(status).json(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'News sync failed';
        console.error('[Cron] /news-sync error:', message);
        res.status(409).json({ ok: false, error: message });
      }
    });
  }

  return router;
}
