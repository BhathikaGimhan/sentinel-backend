/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GoogleGenAI, Type } from '@google/genai';
import type { SentinelApiKeys } from '../../config/keys.js';
import { sanitizeNeuralResult } from './neuralSanitize.js';

export interface NeuralScanRequest {
  marketPrice: number;
  sentimentScore: number;
  orderBookSkew: number;
  marketRegime?: 'TRENDING' | 'REVERTING' | 'RANDOM';
  hurstExponent?: number;
  rsi?: number;
  bollingerBands?: { upper: number; lower: number; basis: number };
}

export interface NeuralConsensusResult {
  decision: 'BUY' | 'SELL' | 'HOLD';
  confidence: number;
  target_entry: number;
  take_profit: number;
  stop_loss: number;
  strategic_rationale: string;
}

export async function executeNeuralConsensusScan(
  keys: SentinelApiKeys,
  input: NeuralScanRequest
): Promise<NeuralConsensusResult> {
  const {
    marketPrice,
    sentimentScore,
    orderBookSkew,
    marketRegime = 'RANDOM',
    hurstExponent = 0.5,
    rsi,
    bollingerBands,
  } = input;

  const ai = new GoogleGenAI({
    apiKey: keys.geminiApiKey,
    httpOptions: {
      headers: { 'User-Agent': 'sentinel-backend-relay/1.0' },
    },
  });

  const rsiText = rsi !== undefined ? rsi.toFixed(2) : '50.00';
  let bbRelation = 'Within normal bounds';

  if (bollingerBands) {
    if (marketPrice >= bollingerBands.upper) {
      bbRelation = 'Touching Upper Band';
    } else if (marketPrice <= bollingerBands.lower) {
      bbRelation = 'Touching Lower Band';
    } else {
      const positionPct =
        ((marketPrice - bollingerBands.lower) /
          (bollingerBands.upper - bollingerBands.lower)) *
        100;
      bbRelation = `Consolidating at ${positionPct.toFixed(2)}% elevation within bands (Basis: ${bollingerBands.basis.toFixed(2)}, Lower: ${bollingerBands.lower.toFixed(2)}, Upper: ${bollingerBands.upper.toFixed(2)})`;
    }
  }

  const prompt = `
=== CENTRALIZED MARKET INTEL SCAN ===
Live Price (USDT): ${marketPrice}
News Sentiment Index Score: ${sentimentScore}
Volumetric Liquidity Skew (%): ${orderBookSkew}%
Mathematical Market Regime: ${marketRegime} (Hurst Exponent: ${hurstExponent.toFixed(4)})
=====================================

Current RSI: ${rsiText}, Bollinger Position: ${bbRelation}. 
Instruction: Use RSI < 30 and Price touching Lower Band as a high-probability BUY trigger. Use RSI > 70 and Price touching Upper Band as a high-probability SELL trigger.

You are the Supreme Crypto AI Commander. Analyze the injected multi-agent quantitative and qualitative context (including the mathematical Market Regime and Hurst Exponent) to form a high-probability trade directive.

Strategic Guidance Profile (Orchestrator Consensus rules):
- If the Hurst Exponent is > 0.55 (TRENDING regime), you MUST favor "Trend" strategies (momentum following, wider price target thresholds mirroring continuous direction).
- If the Hurst Exponent is < 0.45 (REVERTING regime), you MUST favor "Mean Reversion" strategies (anticipating quick reversals, tighter range bounds, scalping around local value).
- If the Hurst Exponent is between 0.45 and 0.55, employ standard balanced strategy models (Random Walk / Geometric Brownian Motion model).

Enforce a strict 1:2 Risk-to-Reward ratio for target calculations.
For target_entry, match it closely to the current Live Price of ${marketPrice}.
For take_profit and stop_loss, ensure that files follow:
- If decision is BUY: stop_loss < target_entry, take_profit > target_entry, and we enforce: (take_profit - target_entry) = 2 * (target_entry - stop_loss)
- If decision is SELL: stop_loss > target_entry, take_profit < target_entry, and we enforce: (target_entry - take_profit) = 2 * (stop_loss - target_entry)
- If decision is HOLD: both targets can represent narrow range support and resistance boundaries near current market price.

Return 100% strict JSON match only.
`;

  const response = await ai.models.generateContent({
    model: 'gemini-3.5-flash',
    contents: prompt,
    config: {
      systemInstruction:
        'You are the Supreme Crypto AI Commander. Analyze the injected multi-agent quantitative and qualitative context to form a high-probability trade directive. Under our Orchestrator Consensus rules: if Hurst > 0.55, favor Trend strategies; if Hurst < 0.45, favor Mean Reversion strategies. Enforce a strict 1:2 Risk-to-Reward ratio for target calculations. Return 100% strict JSON match only.',
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          decision: {
            type: Type.STRING,
            description: 'The primary trade directive choice: BUY, SELL, or HOLD.',
          },
          confidence: {
            type: Type.NUMBER,
            description: 'The confidence multiplier percentage (50 to 98).',
          },
          target_entry: {
            type: Type.NUMBER,
            description: 'The optimal entry price bound matching current asset context.',
          },
          take_profit: {
            type: Type.NUMBER,
            description:
              'The optimal take profit targeting 1:2 Risk-to-Reward ratio relative to stop loss.',
          },
          stop_loss: {
            type: Type.NUMBER,
            description: 'The stop loss protective target enforcing 1:2 Risk-to-Reward ratio.',
          },
          strategic_rationale: {
            type: Type.STRING,
            description:
              'A highly concise, professional summary of the quantitative and qualitative multi-agent thesis (limit to 1-2 powerful sentences).',
          },
        },
        required: [
          'decision',
          'confidence',
          'target_entry',
          'take_profit',
          'stop_loss',
          'strategic_rationale',
        ],
      },
    },
  });

  const text = response.text;
  if (!text) {
    throw new Error('Received empty content output from Gemini model.');
  }

  return sanitizeNeuralResult(marketPrice, JSON.parse(text.trim()) as NeuralConsensusResult);
}
