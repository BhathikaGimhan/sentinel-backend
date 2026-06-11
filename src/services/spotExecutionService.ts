/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Spot order execution — Phase 3 backend handler
 */

import type { Server } from 'socket.io';
import { randomBytes } from 'node:crypto';
import { ExecutionRejectedError } from './executionService.js';

const MIN_SPOT_NOTIONAL_USDT = 5;

export interface SpotOrderPayload {
  side: 'BUY' | 'SELL';
  amount: number;
  symbol: string;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  timestamp: number;
  clientOrderId: string;
  walletSessionId?: string;
}

export interface SpotOrderConfirmedPayload {
  orderId: string;
  clientOrderId: string;
  side: 'BUY' | 'SELL';
  amount: number;
  symbol: string;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  entryTimestamp: number;
  transmissionStatus: 'SIMULATED';
  orderType: 'SPOT';
}

function generateSpotOrderId(): string {
  return `SPOT-${Date.now().toString(36).toUpperCase()}-${randomBytes(3).toString('hex').toUpperCase()}`;
}

function validateSpotOrder(payload: SpotOrderPayload): void {
  if (payload.side !== 'BUY' && payload.side !== 'SELL') {
    throw new ExecutionRejectedError('INVALID_SIDE', 'Spot side must be BUY or SELL.');
  }

  if (!payload.symbol?.trim()) {
    throw new ExecutionRejectedError('INVALID_SYMBOL', 'Trading symbol is required.');
  }

  if (!Number.isFinite(payload.amount) || payload.amount < MIN_SPOT_NOTIONAL_USDT) {
    throw new ExecutionRejectedError(
      'MIN_NOTIONAL',
      `Minimum notional is ${MIN_SPOT_NOTIONAL_USDT} USDT. Received ${payload.amount?.toFixed?.(2) ?? payload.amount}.`
    );
  }

  if (!Number.isFinite(payload.entryPrice) || payload.entryPrice <= 0) {
    throw new ExecutionRejectedError('INVALID_PRICE', 'Entry price must be positive.');
  }

  if (!Number.isFinite(payload.stopLoss) || payload.stopLoss <= 0) {
    throw new ExecutionRejectedError('INVALID_STOP', 'Stop-loss must be positive.');
  }

  if (!Number.isFinite(payload.takeProfit) || payload.takeProfit <= 0) {
    throw new ExecutionRejectedError('INVALID_TAKE_PROFIT', 'Take-profit must be positive.');
  }

  if (!payload.clientOrderId?.trim()) {
    throw new ExecutionRejectedError('CLIENT_ORDER_ID_REQUIRED', 'clientOrderId is required.');
  }
}

async function simulateSpotTransmission(payload: SpotOrderPayload, orderId: string): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 120));
  console.info(
    `[SpotExecution] SIMULATED transmit | ${orderId} | ${payload.side} ${payload.symbol.toUpperCase()} | ` +
      `amount=${payload.amount.toFixed(2)} USDT @ ${payload.entryPrice}`
  );
}

export class SpotExecutionService {
  private io: Server | null = null;

  bindSocketServer(io: Server): void {
    this.io = io;
  }

  async executeSpotOrder(payload: SpotOrderPayload): Promise<SpotOrderConfirmedPayload> {
    validateSpotOrder(payload);

    const orderId = generateSpotOrderId();
    await simulateSpotTransmission(payload, orderId);

    const confirmed: SpotOrderConfirmedPayload = {
      orderId,
      clientOrderId: payload.clientOrderId.trim(),
      side: payload.side,
      amount: parseFloat(payload.amount.toFixed(2)),
      symbol: payload.symbol.trim().toLowerCase(),
      entryPrice: payload.entryPrice,
      stopLoss: payload.stopLoss,
      takeProfit: payload.takeProfit,
      entryTimestamp: payload.timestamp || Date.now(),
      transmissionStatus: 'SIMULATED',
      orderType: 'SPOT',
    };

    this.io?.emit('TRADE_CONFIRMED', confirmed);
    console.info(`[SpotExecution] TRADE_CONFIRMED broadcast | ${orderId} | client=${confirmed.clientOrderId}`);

    return confirmed;
  }
}
