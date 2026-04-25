// src/main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, HttpStatus } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    transform: true,
    // Add this line to perfectly match the TRD requirement!
    errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY, 
  }));

  await app.listen(3000);
}
bootstrap();