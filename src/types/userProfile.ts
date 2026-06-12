/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type UserRole = 'user' | 'admin';
export type UserStatus = 'active' | 'disabled';

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  photoURL?: string;
  role: UserRole;
  status: UserStatus;
  createdAt: number;
  lastLoginAt: number;
}

export interface UserProfileUpdate {
  role?: UserRole;
  status?: UserStatus;
}
