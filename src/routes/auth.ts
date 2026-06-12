/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Router } from 'express';
import type { UserAdminService } from '../services/userAdminService.js';
import {
  verifyFirebaseToken,
  type AuthenticatedRequest,
} from '../middleware/firebaseAuth.js';

export function createAuthRouter(userAdminService: UserAdminService): Router {
  const router = Router();

  router.post('/bootstrap', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
    try {
      const decoded = req.firebaseUser!;
      const profile = await userAdminService.bootstrapFromToken(decoded);

      if (profile.status === 'disabled') {
        res.status(403).json({
          error: 'Account disabled. Contact an administrator.',
          profile,
        });
        return;
      }

      res.json({
        profile,
        claims: {
          admin: profile.role === 'admin',
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Bootstrap failed';
      console.error('[Auth] bootstrap error:', message);
      const permissionDenied =
        message.includes('PERMISSION_DENIED') || message.includes('insufficient permissions');
      res.status(permissionDenied ? 503 : 500).json({
        error: permissionDenied
          ? 'Server cannot write user profiles. Grant Cloud Run service account roles/datastore.user and roles/firebaseauth.admin.'
          : message,
      });
    }
  });

  router.get('/me', verifyFirebaseToken, async (req: AuthenticatedRequest, res) => {
    try {
      const uid = req.firebaseUser!.uid;
      const profile = await userAdminService.getProfile(uid);
      if (!profile) {
        res.status(404).json({ error: 'Profile not found' });
        return;
      }
      if (profile.status === 'disabled') {
        res.status(403).json({ error: 'Account disabled', profile });
        return;
      }
      res.json({ profile });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Profile fetch failed';
      res.status(500).json({ error: message });
    }
  });

  return router;
}
