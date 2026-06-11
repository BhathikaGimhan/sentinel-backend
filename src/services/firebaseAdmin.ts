/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import admin from 'firebase-admin';
import type { Firestore } from 'firebase-admin/firestore';
import { firebaseConfig } from '../../config/firebaseConfig.js';

const DEFAULT_CREDENTIALS_FILE = 'forex-market-ai-firebase.json';

function findProjectRoot(startDir: string): string {
  let dir = startDir;
  while (true) {
    if (existsSync(path.join(dir, 'package.json'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return startDir;
    }
    dir = parent;
  }
}

function resolveCredentialsPath(): string {
  const envPath = process.env.FIREBASE_CREDENTIALS_PATH?.trim();
  if (envPath) {
    return path.isAbsolute(envPath) ? envPath : path.resolve(process.cwd(), envPath);
  }

  const serviceDir = path.dirname(fileURLToPath(import.meta.url));
  const projectRoot = findProjectRoot(serviceDir);
  return path.resolve(projectRoot, DEFAULT_CREDENTIALS_FILE);
}

let cachedDb: Firestore | null = null;

function loadServiceAccount(): admin.ServiceAccount {
  const jsonEnv = process.env.FIREBASE_CREDENTIALS_JSON?.trim();
  if (jsonEnv) {
    return JSON.parse(jsonEnv) as admin.ServiceAccount;
  }

  const credentialsPath = resolveCredentialsPath();
  if (existsSync(credentialsPath)) {
    return JSON.parse(readFileSync(credentialsPath, 'utf8')) as admin.ServiceAccount;
  }

  throw new Error(
    `[Firebase] No credentials found. Set FIREBASE_CREDENTIALS_JSON (Cloud Run / CI), ` +
      `FIREBASE_CREDENTIALS_PATH, or place ${DEFAULT_CREDENTIALS_FILE} in the project root.`
  );
}

export function initializeFirebaseAdmin(): Firestore {
  if (cachedDb) {
    return cachedDb;
  }

  if (!admin.apps.length) {
    const useAdc = process.env.FIREBASE_USE_ADC === 'true';
    if (useAdc) {
      admin.initializeApp({
        credential: admin.credential.applicationDefault(),
        projectId: firebaseConfig.projectId,
        databaseURL: firebaseConfig.databaseURL,
      });
      console.info(`[Firebase] Admin SDK initialized via ADC (project: ${firebaseConfig.projectId})`);
    } else {
      const serviceAccount = loadServiceAccount();
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: firebaseConfig.projectId,
        databaseURL: firebaseConfig.databaseURL,
      });
      console.info(`[Firebase] Admin SDK initialized (project: ${firebaseConfig.projectId})`);
    }
  }

  cachedDb = admin.firestore();
  return cachedDb;
}
