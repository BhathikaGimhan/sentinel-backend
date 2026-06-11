/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { createServer } from 'node:http';
import express from 'express';
import cors from 'cors';
import { Server as SocketIOServer } from 'socket.io';
import { validateKeysOnStartup } from '../config/keys.js';
import { validateBinanceOnStartup } from './services/binanceHealth.js';
import { neuralRouter } from './routes/neural.js';
import { newsRouter } from './routes/news.js';
import { RelayService } from './services/relayService.js';
import { ExecutionService } from './services/executionService.js';
import { SpotExecutionService } from './services/spotExecutionService.js';
import { createExecutionRouter } from './routes/execution.js';
import { initializeFirebaseAdmin } from './services/firebaseAdmin.js';
import { FirebaseWriteBackService } from './services/firebaseWriteBack.js';
import { CandleSyncService } from './services/candleSyncService.js';
import { createCronRouter } from './routes/cron.js';
import { createCorsOriginChecker, resolveCorsOrigins } from './config/corsConfig.js';

async function bootstrap() {
  const keys = validateKeysOnStartup();
  await validateBinanceOnStartup(keys);

  const app = express();
  const port = Number(process.env.PORT ?? 8787);
  const corsOrigins = resolveCorsOrigins();
  const corsOptions = {
    origin: createCorsOriginChecker(corsOrigins),
    credentials: true,
    methods: ['GET', 'POST', 'OPTIONS'],
  };

  app.use(cors(corsOptions));
  app.options('*', cors(corsOptions));
  app.use(express.json({ limit: '256kb' }));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'sentinel-backend-relay' });
  });

  app.use('/api/neural', neuralRouter);
  app.use('/api/news', newsRouter);

  const executionService = new ExecutionService();
  const spotExecutionService = new SpotExecutionService();
  app.use('/api/execution', createExecutionRouter(executionService, spotExecutionService));

  let writeBackService: FirebaseWriteBackService | undefined;
  let candleSyncService: CandleSyncService | undefined;
  try {
    const firestore = initializeFirebaseAdmin();
    writeBackService = new FirebaseWriteBackService(firestore);
    candleSyncService = new CandleSyncService(firestore);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[Sentinel Backend] Firebase services disabled: ${message}`);
  }

  if (candleSyncService) {
    app.use('/api/cron', createCronRouter(candleSyncService));

    if (process.env.CANDLE_SYNC_ON_STARTUP === 'true') {
      void candleSyncService.syncAll().catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[CandleSync] Startup sync failed:', message);
      });
    }
  }

  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  const httpServer = createServer(app);
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: corsOrigins,
      methods: ['GET', 'POST'],
      credentials: true,
    },
  });

  spotExecutionService.bindSocketServer(io);

  const relayService = new RelayService(io, writeBackService);

  io.on('connection', (socket) => {
    console.info(`[Sentinel Backend] Socket connected: ${socket.id}`);
    relayService.attachSocketHandlers(socket);
    executionService.attachSocketHandlers(socket);
  });

  writeBackService?.start();

  const shutdown = async (signal: string) => {
    console.info(`[Sentinel Backend] ${signal} received — shutting down…`);
    writeBackService?.stop();
    try {
      await writeBackService?.flushNow();
    } catch (err) {
      console.error('[Sentinel Backend] Final Firebase flush failed:', err);
    }
    httpServer.close(() => process.exit(0));
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  httpServer.listen(port, () => {
    console.info(`[Sentinel Backend] Listening on http://localhost:${port}`);
    console.info(`[Sentinel Backend] Socket.IO market relay + trade execution active`);
    console.info(`[Sentinel Backend] CORS origin: ${corsOrigins.join(', ')}`);
    if (candleSyncService) {
      console.info(
        `[Sentinel Backend] Candle sync API: POST /api/cron/candle-sync (symbols: ${candleSyncService.getSymbols().join(', ')})`
      );
    }
  });
}

bootstrap().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[Sentinel Backend] Fatal startup error: ${message}`);
  process.exit(1);
});
