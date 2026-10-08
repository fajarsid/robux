import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/database/prisma.service';
import { formatOrderNumber, toBusinessDate } from '../domain/order-number';
import type { OrderNumberAllocator } from '../domain/order-number-allocator';

@Injectable()
export class PrismaOrderNumberAllocator implements OrderNumberAllocator {
  constructor(private readonly prisma: PrismaService) {}

  async allocate(instant: Date): Promise<string> {
    const businessDate = toBusinessDate(instant);
    // Single-statement upsert: the row lock serialises concurrent allocations for the same day,
    // so every caller gets a distinct value without an explicit transaction.
    const rows = await this.prisma.$queryRaw<{ last_value: number }[]>`
      INSERT INTO order_number_counters (business_date, last_value)
      VALUES (${businessDate.iso}::date, 1)
      ON CONFLICT (business_date)
      DO UPDATE SET last_value = order_number_counters.last_value + 1
      RETURNING last_value`;
    const sequence = rows[0]?.last_value;
    if (sequence === undefined) {
      throw new Error('Order number counter returned no row');
    }
    return formatOrderNumber(businessDate, sequence);
  }
}
