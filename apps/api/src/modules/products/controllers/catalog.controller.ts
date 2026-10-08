import { Controller, Get, Param, Query } from '@nestjs/common';
import { type CatalogProductView, type PriceQuoteView, quoteQuerySchema } from '@robux/shared';
import { RateLimit } from '../../../common/rate-limit/rate-limit.decorator';
import { ZodValidationPipe } from '../../../common/validation/zod-validation.pipe';
import { Public } from '../../auth/http/auth-decorators';
import { CatalogService } from '../application/catalog.service';

@Public()
@Controller('products')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get()
  list(): Promise<CatalogProductView[]> {
    return this.catalog.list();
  }

  @Get(':slug')
  get(@Param('slug') slug: string): Promise<CatalogProductView> {
    return this.catalog.get(slug);
  }

  /** Backend-computed totals for the quantity a customer is considering (the browser never computes them). */
  @Get(':slug/quote')
  @RateLimit({ name: 'quote:ip', scope: 'ip', limit: 120, windowSeconds: 60 })
  quote(
    @Param('slug') slug: string,
    @Query(new ZodValidationPipe(quoteQuerySchema)) query: { quantity: number },
  ): Promise<PriceQuoteView> {
    return this.catalog.quote(slug, query.quantity);
  }
}
