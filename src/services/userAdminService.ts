/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import admin from 'firebase-admin';
import type { Firestore } from 'firebase-admin/firestore';
import type { DecodedIdToken } from 'firebase-admin/auth';
import type { UserProfile, UserProfileUpdate, UserRole, UserStatus } from '../types/userProfile.js';

const COLLECTION = 'users';

const DEFAULT_ADMIN_LOCAL_PARTS = ['bgmaduragoda'];

function parseAdminEmails(): string[] {
  const raw = process.env.ADMIN_EMAILS?.trim();
  const fromEnv = raw
    ? raw.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean)
    : [];
  const defaults = DEFAULT_ADMIN_LOCAL_PARTS.map((p) => `${p}@gmail.com`);
  return [...new Set([...fromEnv, ...defaults])];
}

function parseAdminLocalParts(): string[] {
  const raw = process.env.ADMIN_LOCAL_PARTS?.trim();
  const fromEnv = raw
    ? raw.split(',').map((p) => p.trim().toLowerCase()).filter(Boolean)
    : [];
  return [...new Set([...DEFAULT_ADMIN_LOCAL_PARTS, ...fromEnv])];
}

export function isBootstrapAdminEmail(email: string | undefined): boolean {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  const localPart = normalized.split('@')[0] ?? '';
  if (parseAdminEmails().includes(normalized)) return true;
  return parseAdminLocalParts().includes(localPart);
}

export class UserAdminService {
  constructor(private readonly db: Firestore) {}

  private docRef(uid: string) {
    return this.db.collection(COLLECTION).doc(uid);
  }

  async getProfile(uid: string): Promise<UserProfile | null> {
    const snap = await this.docRef(uid).get();
    if (!snap.exists) return null;
    return snap.data() as UserProfile;
  }

  async bootstrapFromToken(decoded: DecodedIdToken): Promise<UserProfile> {
    const uid = decoded.uid;
    const email = decoded.email ?? '';
    const displayName = decoded.name ?? email.split('@')[0] ?? 'User';
    const photoURL = decoded.picture;
    const now = Date.now();
    const shouldBeAdmin = isBootstrapAdminEmail(email) || decoded.admin === true;

    const ref = this.docRef(uid);
    const existing = await ref.get();
    const prior = existing.exists ? (existing.data() as UserProfile) : null;

    const role: UserRole =
      prior?.role === 'admin' || shouldBeAdmin ? 'admin' : 'user';

    let status: UserStatus;
    if (prior?.status) {
      status = prior.status;
    } else if (shouldBeAdmin) {
      status = 'active';
    } else {
      status = 'pending';
    }

    const profile: UserProfile = {
      uid,
      email,
      displayName,
      photoURL,
      role,
      status,
      createdAt: prior?.createdAt ?? now,
      lastLoginAt: now,
    };

    await ref.set(profile, { merge: true });

    try {
      if (role === 'admin' && decoded.admin !== true) {
        await admin.auth().setCustomUserClaims(uid, { admin: true });
      } else if (role !== 'admin' && decoded.admin === true) {
        await admin.auth().setCustomUserClaims(uid, { admin: false });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[UserAdmin] Custom claims update skipped for ${uid}: ${message}`);
    }

    return profile;
  }

  async listUsers(): Promise<UserProfile[]> {
    const snap = await this.db.collection(COLLECTION).orderBy('lastLoginAt', 'desc').get();
    return snap.docs.map((d) => d.data() as UserProfile);
  }

  async updateUser(uid: string, patch: UserProfileUpdate): Promise<UserProfile> {
    const ref = this.docRef(uid);
    const snap = await ref.get();
    if (!snap.exists) {
      throw new Error('User not found');
    }

    const current = snap.data() as UserProfile;
    const next: UserProfile = {
      ...current,
      ...(patch.role ? { role: patch.role } : {}),
      ...(patch.status ? { status: patch.status } : {}),
    };

    await ref.set(next, { merge: true });

    if (patch.role === 'admin') {
      await admin.auth().setCustomUserClaims(uid, { admin: true });
    } else if (patch.role === 'user') {
      await admin.auth().setCustomUserClaims(uid, { admin: false });
    }

    if (patch.status === 'disabled') {
      try {
        await admin.auth().revokeRefreshTokens(uid);
      } catch {
        /* user may not exist in Auth yet */
      }
    }

    return next;
  }
}
