/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Serves cached news from memory (populated by cron → CryptoCompare → Firestore).
 * User requests never hit CryptoCompare or Firestore.
 */

import { Router, type Request, type Response } from 'express';
import type { NewsSyncService } from '../services/newsSyncService.js';

const CACHE_MAX_AGE_SEC = 300;

function serveCachedFeed(req: Request, res: Response, service: NewsSyncService): void {
  const cache = service.getCachedPayload();
  const etag = service.getEtag();

  if (etag) {
    res.setHeader('ETag', etag);
    const ifNoneMatch = req.header('If-None-Match');
    if (ifNoneMatch === etag) {
      res.status(304).end();
      return;
    }
  }

  res.setHeader('Cache-Control', `public, max-age=${CACHE_MAX_AGE_SEC}, stale-while-revalidate=60`);

  if (!cache || cache.Data.length === 0) {
    res.status(503).json({
      error: 'News feed not ready. Cron sync will populate shortly.',
    });
    return;
  }

  res.json({
    Data: cache.Data,
    syncedAt: cache.syncedAt,
    HasWarning: false,
    Type: 100,
    source: 'cache',
  });
}

export function createNewsRouter(newsSyncService: NewsSyncService | null): Router {
  const router = Router();

  router.get('/feed', (req, res) => {
    if (!newsSyncService) {
      res.status(503).json({ error: 'News service unavailable (Firebase not configured)' });
      return;
    }
    serveCachedFeed(req, res, newsSyncService);
  });

  /** @deprecated Use /feed — kept for existing frontend paths */
  router.get('/cryptocompare', (req, res) => {
    if (!newsSyncService) {
      res.status(503).json({ error: 'News service unavailable (Firebase not configured)' });
      return;
    }
    serveCachedFeed(req, res, newsSyncService);
  });

  return router;
}
