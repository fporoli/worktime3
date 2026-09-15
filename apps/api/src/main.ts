import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { WsAdapter } from '@nestjs/platform-ws';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors();
  app.setGlobalPrefix('api/v1');
  // Notifications' WebSocket gateway (path '/ws/notifications') shares this same HTTP
  // server/port — only upgrade requests on that path are intercepted, every REST route
  // is untouched. No Caddy changes needed: reverse_proxy already forwards WS upgrades.
  app.useWebSocketAdapter(new WsAdapter(app));
  const port = Number(process.env.API_PORT ?? 8001);
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`api listening on ${port}`);
}
void bootstrap();
