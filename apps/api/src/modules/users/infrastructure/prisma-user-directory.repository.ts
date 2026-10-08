import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/database/prisma.service';
import type { UserRole } from '../../../generated/prisma/enums';
import type { UserDirectoryRepository, UserProfile } from '../domain/user-directory.repository';

const PROFILE_SELECT = {
  id: true,
  email: true,
  name: true,
  role: true,
  status: true,
  createdAt: true,
  lastLoginAt: true,
  twoFactor: { select: { enabledAt: true } },
} as const;

type ProfileRow = {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
  status: UserProfile['status'];
  createdAt: Date;
  lastLoginAt: Date | null;
  twoFactor: { enabledAt: Date | null } | null;
};

function toProfile({ twoFactor, ...row }: ProfileRow): UserProfile {
  return { ...row, twoFactorEnabled: Boolean(twoFactor?.enabledAt) };
}

@Injectable()
export class PrismaUserDirectoryRepository implements UserDirectoryRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findProfile(userId: string): Promise<UserProfile | null> {
    const row = await this.prisma.user.findUnique({
      where: { id: userId },
      select: PROFILE_SELECT,
    });
    return row ? toProfile(row) : null;
  }

  async listStaff(): Promise<UserProfile[]> {
    const rows = await this.prisma.user.findMany({
      where: { role: { in: ['OPERATOR', 'ADMIN', 'SUPER_ADMIN'] } },
      select: PROFILE_SELECT,
      orderBy: { email: 'asc' },
    });
    return rows.map(toProfile);
  }

  async changeRole(userId: string, expectedRole: UserRole, newRole: UserRole): Promise<boolean> {
    const { count } = await this.prisma.user.updateMany({
      where: { id: userId, role: expectedRole },
      data: { role: newRole },
    });
    return count === 1;
  }
}
