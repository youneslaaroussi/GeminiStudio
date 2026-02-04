import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });
  
  // Configure CORS: support multiple origins or allow all in development
  const corsOrigin = process.env.CORS_ORIGIN;
  let origin: string | boolean | ((origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => void);
  
  if (!corsOrigin || corsOrigin === '*') {
    origin = true; // Allow all origins
  } else {
    // Parse allowed origins
    const allowedOrigins = corsOrigin.includes(',') 
      ? corsOrigin.split(',').map((o) => o.trim())
      : [corsOrigin.trim()];
    
    // Use function to dynamically check origin
    origin = (requestOrigin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      if (!requestOrigin) {
        callback(null, false);
        return;
      }
      
      // Check if origin matches any allowed origin (including www/non-www variants)
      const isAllowed = allowedOrigins.some(allowed => {
        // Exact match
        if (requestOrigin === allowed) return true;
        // Handle www vs non-www variants
        if (allowed.startsWith('https://www.') && requestOrigin === allowed.replace('https://www.', 'https://')) return true;
        if (allowed.startsWith('https://') && !allowed.includes('www.') && requestOrigin === allowed.replace('https://', 'https://www.')) return true;
        return false;
      });
      
      callback(null, isAllowed);
    };
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
