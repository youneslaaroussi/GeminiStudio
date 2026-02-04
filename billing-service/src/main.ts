import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });
  
  // Configure CORS: support multiple origins or allow all in development
  const corsOrigin = process.env.CORS_ORIGIN;
  let origin: string | boolean | string[];
  
  if (!corsOrigin || corsOrigin === '*') {
    origin = true; // Allow all origins
  } else if (corsOrigin.includes(',')) {
    origin = corsOrigin.split(',').map((o) => o.trim()); // Multiple origins
  } else {
    origin = corsOrigin; // Single origin
  }
  
  app.enableCors({ 
    origin,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });
  
  await app.listen(process.env.PORT ?? 3100);
}
bootstrap();
