/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Router } from 'express';
import {
  ExecutionService,
  ExecutionRejectedError,
  type TradeRequestPayload,
  type LeveragedOrderPayload,
} from '../services/executionService.js';
import {
  SpotExecutionService,
  type SpotOrderPayload,
} from '../services/spotExecutionService.js';

export function createExecutionRouter(
  executionService: ExecutionService,
  spotExecutionService: SpotExecutionService
): Router {
  const router = Router();

  router.post('/spot', async (req, res) => {
    try {
      const payload = req.body as SpotOrderPayload;
      const confirmed = await spotExecutionService.executeSpotOrder(payload);
      res.status(201).json({ ok: true, ...confirmed });
    } catch (err) {
      if (err instanceof ExecutionRejectedError) {
        res.status(400).json({ ok: false, code: err.code, message: err.message });
        return;
      }
      const message = err instanceof Error ? err.message : 'Spot execution failed';
      res.status(500).json({ ok: false, code: 'SPOT_EXECUTION_FAILED', message });
    }
  });

  router.post('/trade', async (req, res) => {
    try {
      const payload = req.body as TradeRequestPayload;
      const confirmed = await executionService.executeTrade(payload);
      res.status(201).json(confirmed);
    } catch (err) {
      if (err instanceof ExecutionRejectedError) {
        res.status(400).json({ ok: false, code: err.code, message: err.message });
        return;
      }
      const message = err instanceof Error ? err.message : 'Trade execution failed';
      res.status(500).json({ ok: false, code: 'EXECUTION_FAILED', message });
    }
  });

  router.post('/futures', async (req, res) => {
    try {
      const payload = req.body as LeveragedOrderPayload;
      const confirmed = await executionService.executeLeveragedOrder(payload);
      res.status(201).json({ ok: true, ...confirmed });
    } catch (err) {
      if (err instanceof ExecutionRejectedError) {
        res.status(400).json({ ok: false, code: err.code, message: err.message });
        return;
      }
      const message = err instanceof Error ? err.message : 'Futures execution failed';
      res.status(500).json({ ok: false, code: 'FUTURES_EXECUTION_FAILED', message });
    }
  });

  return router;
}
