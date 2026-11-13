import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  const webOrigins = (process.env.WEB_ORIGINS || 'http://localhost:3002').split(',').map((origin) => origin.trim()).filter(Boolean);
  app.enableCors({
    origin: webOrigins,
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'x-tenant-id', 'x-request-id', 'Idempotency-Key', 'x-sbc-request', 'x-sbc-user-active'],
  });

  app.setGlobalPrefix('v1', {
    exclude: ['health'],
  });

  app.enableShutdownHooks();
  // ConfigModule validates and loads API_PORT before the application starts.
  const apiPort = Number(process.env.API_PORT ?? 8002);
  await app.listen(apiPort, '0.0.0.0');
}

void bootstrap();
