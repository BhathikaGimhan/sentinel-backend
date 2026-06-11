/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Proxy external news APIs — avoids browser CORS blocks in dev/production.
 * CryptoCompare requires an API key (free tier): https://www.cryptocompare.com/cryptopian/api-keys
 */

import { Router } from 'express';

const CRYPTOCOMPARE_NEWS_URL = 'https://min-api.cryptocompare.com/data/v2/news/?lang=EN';

function getCryptoCompareApiKey(): string | undefined {
  return process.env.CRYPTOCOMPARE_API_KEY?.trim() || undefined;
}

export const newsRouter = Router();

newsRouter.get('/cryptocompare', async (_req, res) => {
  const apiKey = getCryptoCompareApiKey();
  if (!apiKey) {
    res.status(503).json({
      error:
        'CryptoCompare API key not configured. Set CRYPTOCOMPARE_API_KEY in sentinel-backend-relay/.env',
    });
    return;
  }

  try {
    const response = await fetch(CRYPTOCOMPARE_NEWS_URL, {
      headers: {
        'User-Agent': 'sentinel-backend-relay/1.0',
        Authorization: `Apikey ${apiKey}`,
      },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      console.error('[News] CryptoCompare upstream error:', response.status, body.slice(0, 200));
      res.status(502).json({ error: `CryptoCompare returned ${response.status}` });
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
