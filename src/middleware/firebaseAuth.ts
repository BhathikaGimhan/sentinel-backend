/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { NextFunction, Request, Response } from 'express';
import admin from 'firebase-admin';
import type { DecodedIdToken } from 'firebase-admin/auth';

export interface AuthenticatedRequest extends Request {
  firebaseUser?: DecodedIdToken;
}

export async function verifyFirebaseToken(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const header = req.header('Authorization');
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid Authorization header' });
    return;
  }

  try {
    const token = header.slice('Bearer '.length).trim();
    req.firebaseUser = await admin.auth().verifyIdToken(token);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired session' });
  }
}

export function requireAdmin(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  const claims = req.firebaseUser;
  if (!claims) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  if (claims.admin === true) {
    next();
    return;
  }
  res.status(403).json({ error: 'Admin access required' });
}
