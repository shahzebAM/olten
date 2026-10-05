import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { json, urlencoded } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { createCorsOptions } from './cors.config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  // Allow large high-resolution Base64 image payloads (up to 50MB)
  app.use(json({ limit: '50mb' }));
  app.use(urlencoded({ extended: true, limit: '50mb' }));
  
  app.enableCors(createCorsOptions());
  app.use((request: Request, response: Response, next: NextFunction) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    if (/^\/(?:api\/)?(?:auth|login|setup|admins)(?:\/|$)/.test(request.path)) response.setHeader('Cache-Control', 'no-store');
    next();
  });
  // The ?? has been changed back to || so it safely runs everywhere
  const port = process.env.PORT || 3000;
  await app.listen(port, '0.0.0.0');
  console.log(`Backend is running on port ${port}`);
}

bootstrap();
