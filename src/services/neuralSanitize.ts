/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { NeuralConsensusResult } from './neuralScan.js';

const MAX_ENTRY_DEVIATION = 0.03;
const DEFAULT_RISK_PCT = 0.015;

/**
 * Clamp Gemini targets to the live market price so UI never shows stale levels
 * (e.g. TG 99500 when BTC is ~63000).
 */
export function sanitizeNeuralResult(
  marketPrice: number,
  result: NeuralConsensusResult
): NeuralConsensusResult {
  let target_entry = result.target_entry;

  if (!Number.isFinite(target_entry) || target_entry <= 0) {
    target_entry = marketPrice;
  } else {
    const deviation = Math.abs(target_entry - marketPrice) / marketPrice;
    if (deviation > MAX_ENTRY_DEVIATION) {
      target_entry = marketPrice;
    }
  }

  let stop_loss = result.stop_loss;
  let take_profit = result.take_profit;

  if (result.decision === 'BUY') {
    stop_loss = parseFloat((target_entry * (1 - DEFAULT_RISK_PCT)).toFixed(2));
    take_profit = parseFloat((target_entry + 2 * (target_entry - stop_loss)).toFixed(2));
  } else if (result.decision === 'SELL') {
    stop_loss = parseFloat((target_entry * (1 + DEFAULT_RISK_PCT)).toFixed(2));
    take_profit = parseFloat((target_entry - 2 * (stop_loss - target_entry)).toFixed(2));
  } else {
    stop_loss = parseFloat((target_entry * (1 - DEFAULT_RISK_PCT * 0.5)).toFixed(2));
    take_profit = parseFloat((target_entry * (1 + DEFAULT_RISK_PCT * 0.5)).toFixed(2));
  }

  return {
    ...result,
    target_entry,
    stop_loss,
    take_profit,
    confidence: Math.min(98, Math.max(50, result.confidence)),
  };
}
