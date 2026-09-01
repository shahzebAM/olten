import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  app.enableCors({ origin: '*', // Automatically mirrors the origin (perfect for Vercel's dynamic links)
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
  });
  
  // The ?? has been changed back to || so it safely runs everywhere
  await app.listen(process.env.PORT || 3000);
}
bootstrap();