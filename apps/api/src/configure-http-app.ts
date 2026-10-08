import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import type { AppConfig } from './config/app-config';

/** The HTTP pipeline shared by `main.ts` and the HTTP integration tests. */
export function configureHttpApp(app: NestExpressApplication, config: AppConfig): void {
  // Only Nginx talks to the API container; trust exactly one proxy hop for client IPs.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          scriptSrc: ["'self'", 'https://telegram.org'],
        },
      },
    }),
  );
  app.use(cookieParser());
  app.useBodyParser('json', { limit: '100kb' });

  app.setGlobalPrefix('api/v1', { exclude: ['health', 'health/live', 'health/ready'] });

  // Browser traffic is same-origin (ADR-008); CORS only admits the exact trusted origins.
  app.enableCors({
    origin: config.auth?.trustedOrigins ?? [],
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Idempotency-Key',
      'X-CSRF-Token',
      'X-Request-Id',
      'X-Telegram-Bot-Api-Secret-Token',
    ],
    exposedHeaders: ['X-Request-Id'],
    maxAge: 600,
  });
}
