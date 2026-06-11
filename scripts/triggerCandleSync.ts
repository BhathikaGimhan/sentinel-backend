/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Local manual trigger — same logic as POST /api/cron/candle-sync
 * Run: npm run candle-sync
 */

import dotenv from 'dotenv';
import { initializeFirebaseAdmin } from '../src/services/firebaseAdmin.js';
import { CandleSyncService } from '../src/services/candleSyncService.js';

dotenv.config();

async function main(): Promise<void> {
  const db = initializeFirebaseAdmin();
  const service = new CandleSyncService(db);
  const result = await service.syncAll();
  console.info(JSON.stringify(result, null, 2));
  const failed = result.symbols.filter((s) => !s.ok);
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('[candle-sync] fatal:', err);
  process.exit(1);
});
