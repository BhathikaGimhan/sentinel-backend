/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Firebase project configuration for forex-market-ai.
 * Web/client config — used to identify the project; Admin SDK uses service-account credentials for writes.
 */

export interface FirebaseWebConfig {
  apiKey: string;
  authDomain: string;
  databaseURL: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
}

export const firebaseConfig: FirebaseWebConfig = {
  apiKey: process.env.FIREBASE_API_KEY ?? 'AIzaSyApAuT2IbGNdp-1IA5B4H5lWQRGoHmwVyY',
  authDomain: process.env.FIREBASE_AUTH_DOMAIN ?? 'forex-market-ai.firebaseapp.com',
  databaseURL: process.env.FIREBASE_DATABASE_URL ?? 'https://forex-market-ai-default-rtdb.firebaseio.com',
  projectId: process.env.FIREBASE_PROJECT_ID ?? 'forex-market-ai',
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET ?? 'forex-market-ai.firebasestorage.app',
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID ?? '547424723636',
  appId: process.env.FIREBASE_APP_ID ?? '1:547424723636:web:1d9bbd541e7b59543b2de1',
};
