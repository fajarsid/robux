import { Inject, Injectable } from '@nestjs/common';
import type { AccountProfileView, StaffMemberView } from '@robux/shared';
import { notFound } from '../../../common/errors/app-http.exception';
import {
  USER_DIRECTORY_REPOSITORY,
  type UserDirectoryRepository,
  type UserProfile,
} from '../domain/user-directory.repository';

@Injectable()
export class UserDirectoryService {
  constructor(@Inject(USER_DIRECTORY_REPOSITORY) private readonly users: UserDirectoryRepository) {}

  async getOwnProfile(userId: string): Promise<AccountProfileView> {
    const profile = await this.users.findProfile(userId);
    if (!profile) {
      throw notFound();
    }
    return {
      id: profile.id,
      email: profile.email,
      name: profile.name,
      role: profile.role,
      createdAt: profile.createdAt.toISOString(),
    };
  }

  async listStaff(): Promise<StaffMemberView[]> {
    return (await this.users.listStaff()).map(toStaffMemberView);
  }
}

export function toStaffMemberView(profile: UserProfile): StaffMemberView {
  return {
    id: profile.id,
    email: profile.email,
    name: profile.name,
    role: profile.role,
    status: profile.status,
    twoFactorEnabled: profile.twoFactorEnabled,
    lastLoginAt: profile.lastLoginAt?.toISOString() ?? null,
  };
}
