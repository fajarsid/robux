import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/database/prisma.service';
import type { LoginFailureReason } from '../../../generated/prisma/enums';
import type { LoginAttemptRepository } from '../domain/ports';

@Injectable()
export class PrismaLoginAttemptRepository implements LoginAttemptRepository {
  constructor(private readonly prisma: PrismaService) {}

  async record(attempt: {
    emailHash: string;
    userId?: string;
    ipAddress: string;
    succeeded: boolean;
    failureReason?: LoginFailureReason;
  }): Promise<void> {
    await this.prisma.loginAttempt.create({ data: attempt });
  }
}
