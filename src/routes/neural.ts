/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Router } from 'express';
import { getApiKeys } from '../../config/keys.js';
import {
  executeNeuralConsensusScan,
  type NeuralScanRequest,
} from '../services/neuralScan.js';

export const neuralRouter = Router();

neuralRouter.post('/scan', async (req, res) => {
  try {
    const body = req.body as NeuralScanRequest;

    if (typeof body.marketPrice !== 'number' || !Number.isFinite(body.marketPrice) || body.marketPrice <= 0) {
      res.status(400).json({ error: 'Invalid marketPrice — live price required from market relay.' });
      return;
    }

    const result = await executeNeuralConsensusScan(getApiKeys(), body);
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Neural scan failed';
    console.error('[Sentinel Backend] /api/neural/scan error:', message);
    res.status(502).json({ error: message });
  }
});
