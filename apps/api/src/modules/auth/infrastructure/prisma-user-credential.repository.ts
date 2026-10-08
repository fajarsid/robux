import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/database/prisma.service';
import { Prisma } from '../../../generated/prisma/client';
import type { CredentialRecord, UserCredentialRepository } from '../domain/ports';

const CREDENTIAL_FIELDS = {
  id: true,
  email: true,
  name: true,
  role: true,
  status: true,
  passwordHash: true,
} as const;

@Injectable()
export class PrismaUserCredentialRepository implements UserCredentialRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByEmail(email: string): Promise<CredentialRecord | null> {
    return this.prisma.user.findUnique({ where: { email }, select: CREDENTIAL_FIELDS });
  }

  findById(id: string): Promise<CredentialRecord | null> {
    return this.prisma.user.findUnique({ where: { id }, select: CREDENTIAL_FIELDS });
  }

  async createCustomer(input: {
    email: string;
    name?: string;
    passwordHash: string;
  }): Promise<CredentialRecord | null> {
    try {
      return await this.prisma.user.create({
        data: {
          email: input.email,
          name: input.name,
          passwordHash: input.passwordHash,
          role: 'CUSTOMER',
        },
        select: CREDENTIAL_FIELDS,
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return null;
      }
      throw error;
    }
  }

  async updatePasswordHash(userId: string, passwordHash: string): Promise<void> {
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } });
  }

  async recordLogin(userId: string, at: Date): Promise<void> {
    await this.prisma.user.update({ where: { id: userId }, data: { lastLoginAt: at } });
  }

  async existsWithEmailDomain(domain: string): Promise<boolean> {
    const count = await this.prisma.user.count({ where: { email: { endsWith: `@${domain}` } } });
    return count > 0;
  }

  listStaffCredentials(): Promise<CredentialRecord[]> {
    return this.prisma.user.findMany({
      where: { role: { in: ['OPERATOR', 'ADMIN', 'SUPER_ADMIN'] } },
      select: CREDENTIAL_FIELDS,
    });
  }
}
