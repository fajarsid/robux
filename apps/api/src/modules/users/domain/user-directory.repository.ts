import type { UserRole, UserStatus } from '../../../generated/prisma/enums';

export interface UserProfile {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
  status: UserStatus;
  createdAt: Date;
  lastLoginAt: Date | null;
  twoFactorEnabled: boolean;
}

export interface UserDirectoryRepository {
  findProfile(userId: string): Promise<UserProfile | null>;
  listStaff(): Promise<UserProfile[]>;
  /** Changes the role only if it is still `expectedRole`; returns whether it changed. */
  changeRole(userId: string, expectedRole: UserRole, newRole: UserRole): Promise<boolean>;
}

export const USER_DIRECTORY_REPOSITORY = Symbol('USER_DIRECTORY_REPOSITORY');
