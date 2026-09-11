import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { json, urlencoded } from 'express';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  // Allow large high-resolution Base64 image payloads (up to 50MB)
  app.use(json({ limit: '50mb' }));
  app.use(urlencoded({ extended: true, limit: '50mb' }));
  
  app.enableCors({ origin: '*', // Automatically mirrors the origin (perfect for Vercel's dynamic links)
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
  });
  
  // The ?? has been changed back to || so it safely runs everywhere
  await app.listen(process.env.PORT || 3000);
}
bootstrap();