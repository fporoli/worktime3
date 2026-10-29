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
  if (!process.env.DATABASE_URL) {
    // Offline mode is deliberate (endpoints return empty/offline shapes), but it looks like
    // success from the UI — e.g. every login "works" and does nothing — so say so loudly.
    // eslint-disable-next-line no-console
    console.warn(
      'WARNING: DATABASE_URL is not set — running in OFFLINE mode, nothing is read or written. ' +
        'Load an environment first: . ./env.dev.sh (Windows: call env.dev.bat)',
    );
  }
}
void bootstrap();
