import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.enableCors({ origin: process.env.CORS_ORIGIN ?? true, credentials: true });
  await app.listen(process.env.PORT ?? 3100);
}
bootstrap();
