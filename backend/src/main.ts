import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  app.enableCors(); // <-- ADD THIS LINE to allow React to connect
  
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();