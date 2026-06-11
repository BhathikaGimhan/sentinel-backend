/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Proxy external news APIs — avoids browser CORS blocks in dev/production.
 */

import { Router } from 'express';

const CRYPTOCOMPARE_NEWS_URL = 'https://min-api.cryptocompare.com/data/v2/news/?lang=EN';

export const newsRouter = Router();

newsRouter.get('/cryptocompare', async (_req, res) => {
  try {
    const response = await fetch(CRYPTOCOMPARE_NEWS_URL, {
      headers: { 'User-Agent': 'sentinel-backend-relay/1.0' },
    });

    if (!response.ok) {
      res.status(response.status).json({ error: `CryptoCompare returned ${response.status}` });
      return;
    }

    const data = await response.json();
    res.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'News proxy failed';
    console.error('[News] CryptoCompare proxy error:', message);
    res.status(502).json({ error: message });
  }
});
