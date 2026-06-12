/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Router } from 'express';
import type { UserAdminService } from '../services/userAdminService.js';
import type { UserProfileUpdate } from '../types/userProfile.js';
import {
  verifyFirebaseToken,
  requireAdmin,
  type AuthenticatedRequest,
} from '../middleware/firebaseAuth.js';

export function createAdminRouter(userAdminService: UserAdminService): Router {
  const router = Router();

  router.use(verifyFirebaseToken, requireAdmin);

  router.get('/users', async (_req, res) => {
    try {
      const users = await userAdminService.listUsers();
      res.json({ users, count: users.length });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to list users';
      res.status(500).json({ error: message });
    }
  });

  router.patch('/users/:uid', async (req: AuthenticatedRequest, res) => {
    try {
      const uid = String(req.params.uid ?? '');
      const body = req.body as UserProfileUpdate;

      if (!uid) {
        res.status(400).json({ error: 'Missing user id' });
        return;
      }

      if (uid === req.firebaseUser?.uid && body.role === 'user') {
        res.status(400).json({ error: 'Cannot demote your own admin account' });
        return;
      }

      if (body.role && body.role !== 'user' && body.role !== 'admin') {
        res.status(400).json({ error: 'Invalid role' });
        return;
      }
      if (body.status && body.status !== 'active' && body.status !== 'disabled') {
        res.status(400).json({ error: 'Invalid status' });
        return;
      }
      if (!body.role && !body.status) {
        res.status(400).json({ error: 'No updates provided' });
        return;
      }

      const profile = await userAdminService.updateUser(uid, body);
      res.json({ profile });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update user';
      const status = message === 'User not found' ? 404 : 500;
      res.status(status).json({ error: message });
    }
  });

  router.get('/stats', async (_req, res) => {
    try {
      const users = await userAdminService.listUsers();
      const active = users.filter((u) => u.status === 'active').length;
      const admins = users.filter((u) => u.role === 'admin').length;
      res.json({
        total: users.length,
        active,
        disabled: users.length - active,
        admins,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load stats';
      res.status(500).json({ error: message });
    }
  });

  return router;
}
