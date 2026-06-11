/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Socket } from 'socket.io';
import { randomBytes } from 'node:crypto';
import { placeLeveragedFuturesOrder } from './binanceFuturesClient.js';

const SMALL_ACCOUNT_THRESHOLD_USDT = 50;
const MIN_MARGIN_STANDARD_USDT = 100;
const MIN_MARGIN_SMALL_USDT = 5;

export interface TradePredictionSnapshot {
  direction: 'BULLISH' | 'BEARISH' | 'CONSOLIDATING' | string;
  probability: number;
  timeframe: string;
  targetPrice: number;
  stopLoss: number;
  takeProfit?: number;
  leverageRecommendation: string;
}

export type FuturesOrderCommand = 'OPEN_LONG' | 'OPEN_SHORT';

export interface TradeRequestPayload {
  walletSessionId: string;
  balanceUSDT: number;
  symbol: string;
  assetLabel: string;
  direction: 'LONG' | 'SHORT';
  entryPrice: number;
  marginUSDT: number;
  positionSizeUSDT: number;
  leverage: number;
  predictionSnapshot: TradePredictionSnapshot;
  expiresAt: number;
}

export interface LeveragedOrderPayload extends TradeRequestPayload {
  command: FuturesOrderCommand;
  liquidationPrice: number;
}

export interface TradeConfirmedPayload {
  orderId: string;
  orderNum: number;
  symbol: string;
  assetLabel: string;
  direction: 'LONG' | 'SHORT';
  entryPrice: number;
  marginUSDT: number;
  positionSizeUSDT: number;
  leverage: number;
  entryTimestamp: number;
  expiresAt: number;
  predictionSnapshot: TradePredictionSnapshot;
  transmissionStatus: 'SIMULATED' | 'LIVE';
  availableBalanceAfterLock: number;
  command?: FuturesOrderCommand;
  liquidationPrice?: number;
}

export interface TradeRejectedPayload {
  code: string;
  message: string;
}

interface SessionExecutionState {
  walletSessionId: string;
  openOrders: Array<{ orderId: string; marginUSDT: number }>;
  orderCounter: number;
}

function getMinDeployMargin(balanceUSDT: number): number {
  return balanceUSDT > 0 && balanceUSDT < SMALL_ACCOUNT_THRESHOLD_USDT
    ? MIN_MARGIN_SMALL_USDT
    : MIN_MARGIN_STANDARD_USDT;
}

function computeReservedMargin(state: SessionExecutionState): number {
  return state.openOrders.reduce((sum, order) => sum + order.marginUSDT, 0);
}

function validateTradeRequest(
  payload: TradeRequestPayload,
  state: SessionExecutionState
): void {
  if (!payload.walletSessionId?.trim()) {
    throw new ExecutionRejectedError('WALLET_REQUIRED', 'Wallet session is required.');
  }

  if (!Number.isFinite(payload.balanceUSDT) || payload.balanceUSDT <= 0) {
    throw new ExecutionRejectedError('INSUFFICIENT_BALANCE', 'Wallet balance must be greater than zero.');
  }

  if (!payload.symbol?.trim() || !payload.assetLabel?.trim()) {
    throw new ExecutionRejectedError('INVALID_SYMBOL', 'Trading symbol is required.');
  }

  if (payload.direction !== 'LONG' && payload.direction !== 'SHORT') {
    throw new ExecutionRejectedError('INVALID_DIRECTION', 'Trade direction must be LONG or SHORT.');
  }

  if (!Number.isFinite(payload.entryPrice) || payload.entryPrice <= 0) {
    throw new ExecutionRejectedError('INVALID_PRICE', 'Entry price must be a positive number.');
  }

  if (!Number.isFinite(payload.marginUSDT) || payload.marginUSDT <= 0) {
    throw new ExecutionRejectedError('INVALID_MARGIN', 'Margin must be a positive number.');
  }

  if (!Number.isFinite(payload.positionSizeUSDT) || payload.positionSizeUSDT <= 0) {
    throw new ExecutionRejectedError('INVALID_NOTIONAL', 'Position size must be a positive number.');
  }

  if (!Number.isFinite(payload.leverage) || payload.leverage < 1) {
    throw new ExecutionRejectedError('INVALID_LEVERAGE', 'Leverage must be at least 1x.');
  }

  if (!payload.predictionSnapshot) {
    throw new ExecutionRejectedError('MISSING_PREDICTION', 'Prediction snapshot is required.');
  }

  const minMargin = getMinDeployMargin(payload.balanceUSDT);
  const reserved = computeReservedMargin(state);
  const available = payload.balanceUSDT - reserved;

  if (available < minMargin) {
    throw new ExecutionRejectedError(
      'INSUFFICIENT_AVAILABLE',
      `Insufficient available margin. ${reserved.toFixed(2)} USDT locked across ${state.openOrders.length} open order(s).`
    );
  }

  if (payload.marginUSDT < minMargin) {
    throw new ExecutionRejectedError(
      'MARGIN_BELOW_MINIMUM',
      `Required minimum margin is ${minMargin.toFixed(2)} USDT for this account tier.`
    );
  }

  if (payload.marginUSDT > available + 0.01) {
    throw new ExecutionRejectedError(
      'MARGIN_EXCEEDS_AVAILABLE',
      `Requested margin ${payload.marginUSDT.toFixed(2)} USDT exceeds available ${available.toFixed(2)} USDT.`
    );
  }

  const expectedNotional = parseFloat((payload.marginUSDT * payload.leverage).toFixed(2));
  const notionalDelta = Math.abs(expectedNotional - payload.positionSizeUSDT);
  if (notionalDelta > Math.max(1, expectedNotional * 0.05)) {
    throw new ExecutionRejectedError(
      'NOTIONAL_MISMATCH',
      'Position notional does not match margin × leverage.'
    );
  }
}

export class ExecutionRejectedError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'ExecutionRejectedError';
  }
}

/**
 * Simulates exchange order transmission. Replace with live Binance API integration later.
 */
async function simulateOrderTransmission(
  payload: TradeRequestPayload,
  orderId: string
): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 150));

  console.info(
    `[ExecutionService] SIMULATED transmit | orderId=${orderId} | ${payload.direction} ${payload.symbol.toUpperCase()} | ` +
      `margin=${payload.marginUSDT.toFixed(2)} USDT | notional=${payload.positionSizeUSDT.toFixed(2)} USDT | lev=${payload.leverage}x`
  );
}

function generateOrderId(): string {
  return `ORD-${Date.now().toString(36).toUpperCase()}-${randomBytes(3).toString('hex').toUpperCase()}`;
}

export class ExecutionService {
  private readonly sessions = new Map<string, SessionExecutionState>();

  private getOrCreateSession(walletSessionId: string): SessionExecutionState {
    let state = this.sessions.get(walletSessionId);
    if (!state) {
      state = { walletSessionId, openOrders: [], orderCounter: 0 };
      this.sessions.set(walletSessionId, state);
    }
    return state;
  }

  async executeTrade(payload: TradeRequestPayload): Promise<TradeConfirmedPayload> {
    const direction = payload.direction;
    const command: FuturesOrderCommand = direction === 'SHORT' ? 'OPEN_SHORT' : 'OPEN_LONG';
    return this.executeLeveragedOrder({
      ...payload,
      command,
      liquidationPrice: 0,
    });
  }

  async executeLeveragedOrder(payload: LeveragedOrderPayload): Promise<TradeConfirmedPayload> {
    const state = this.getOrCreateSession(payload.walletSessionId.trim());
    validateTradeRequest(payload, state);

    if (payload.command !== 'OPEN_LONG' && payload.command !== 'OPEN_SHORT') {
      throw new ExecutionRejectedError('INVALID_COMMAND', 'Command must be OPEN_LONG or OPEN_SHORT.');
    }

    const expectedDirection = payload.command === 'OPEN_LONG' ? 'LONG' : 'SHORT';
    if (payload.direction !== expectedDirection) {
      throw new ExecutionRejectedError(
        'DIRECTION_MISMATCH',
        `Command ${payload.command} requires direction ${expectedDirection}.`
      );
    }

    const placement = await placeLeveragedFuturesOrder({
      symbol: payload.symbol,
      command: payload.command,
      marginUSDT: payload.marginUSDT,
      leverage: payload.leverage,
      entryPrice: payload.entryPrice,
    });

    const orderId = placement.orderId || generateOrderId();

    if (placement.transmissionStatus === 'SIMULATED') {
      await simulateOrderTransmission(payload, orderId);
    }

    state.orderCounter += 1;
    state.openOrders.push({ orderId, marginUSDT: payload.marginUSDT });

    const reservedAfter = computeReservedMargin(state);
    const availableAfterLock = parseFloat((payload.balanceUSDT - reservedAfter).toFixed(2));

    return {
      orderId,
      orderNum: state.orderCounter,
      symbol: payload.symbol,
      assetLabel: payload.assetLabel,
      direction: payload.direction,
      entryPrice: payload.entryPrice,
      marginUSDT: payload.marginUSDT,
      positionSizeUSDT: payload.positionSizeUSDT,
      leverage: payload.leverage,
      entryTimestamp: Date.now(),
      expiresAt: payload.expiresAt,
      predictionSnapshot: payload.predictionSnapshot,
      transmissionStatus: placement.transmissionStatus,
      availableBalanceAfterLock: availableAfterLock,
      command: payload.command,
      liquidationPrice: payload.liquidationPrice,
    };
  }

  /** Release margin when a trade settles (hook for future settlement sync). */
  releaseOrder(walletSessionId: string, orderId: string): void {
    const state = this.sessions.get(walletSessionId);
    if (!state) return;
    state.openOrders = state.openOrders.filter((o) => o.orderId !== orderId);
  }

  attachSocketHandlers(socket: Socket): void {
    socket.on('TRADE_RELEASE', (payload: { walletSessionId?: string; orderId?: string }) => {
      if (!payload?.walletSessionId || !payload?.orderId) return;
      this.releaseOrder(payload.walletSessionId, payload.orderId);
    });

    socket.on('TRADE_REQUEST', async (rawPayload: TradeRequestPayload, ack?: (response: unknown) => void) => {
      try {
        const confirmed = await this.executeTrade(rawPayload);
        socket.emit('TRADE_CONFIRMED', confirmed);
        ack?.({ ok: true, ...confirmed });
        console.info(`[ExecutionService] TRADE_CONFIRMED → socket ${socket.id} | ${confirmed.orderId}`);
      } catch (err) {
        const rejected: TradeRejectedPayload =
          err instanceof ExecutionRejectedError
            ? { code: err.code, message: err.message }
            : { code: 'EXECUTION_FAILED', message: err instanceof Error ? err.message : 'Trade execution failed.' };

        socket.emit('TRADE_REJECTED', rejected);
        ack?.({ ok: false, ...rejected });
        console.warn(`[ExecutionService] TRADE_REJECTED → socket ${socket.id} | ${rejected.code}: ${rejected.message}`);
      }
    });

    socket.on('LEVERAGED_ORDER', async (rawPayload: LeveragedOrderPayload, ack?: (response: unknown) => void) => {
      try {
        const confirmed = await this.executeLeveragedOrder(rawPayload);
        socket.emit('TRADE_CONFIRMED', confirmed);
        ack?.({ ok: true, ...confirmed });
        console.info(
          `[ExecutionService] LEVERAGED_ORDER confirmed → ${confirmed.command} ${confirmed.orderId} (${confirmed.transmissionStatus})`
        );
      } catch (err) {
        const rejected: TradeRejectedPayload =
          err instanceof ExecutionRejectedError
            ? { code: err.code, message: err.message }
            : { code: 'LEVERAGED_ORDER_FAILED', message: err instanceof Error ? err.message : 'Leveraged order failed.' };

        socket.emit('LEVERAGED_ORDER_REJECTED', rejected);
        ack?.({ ok: false, ...rejected });
        console.warn(`[ExecutionService] LEVERAGED_ORDER_REJECTED → ${rejected.code}: ${rejected.message}`);
      }
    });
  }
}
