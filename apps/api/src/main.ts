import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors();
  app.setGlobalPrefix('api/v1');
  const port = Number(process.env.API_PORT ?? 8001);
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`api listening on ${port}`);
}
void bootstrap();
