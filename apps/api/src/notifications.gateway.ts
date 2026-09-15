import { Injectable } from '@nestjs/common';
import { OnGatewayConnection, OnGatewayDisconnect, WebSocketGateway } from '@nestjs/websockets';
import type { WebSocket } from 'ws';
import { authenticateToken } from './jwt';
import { callerUserId } from './access';
import { DbService } from './db.service';

const AUTH_TIMEOUT_MS = 10_000;

/**
 * Live push side of the notification feed — the persisted `notifications` table (see
 * NotificationsService) is the source of truth, this just forwards a copy of a just-inserted
 * row to whichever of the recipient's browser tabs are currently connected.
 *
 * Auth is first-message, not a `?token=` query param: the rest of this API never puts a
 * bearer token anywhere but the Authorization header (see JwtAuthGuard), and a query-string
 * token would be the first place a JWT lands in a URL, risking exposure via access logs.
 * The client must send `{"type":"auth","token":"..."}` as its first message within
 * AUTH_TIMEOUT_MS or the connection is closed.
 *
 * In-memory connection map — correct because exactly one `api` process runs in production
 * today (see compose/docker-compose.vps.yml). If this is ever horizontally scaled, a push
 * would only reach sockets on the same process; that degrades gracefully rather than losing
 * data, since the persisted row is still there for the next reconnect/REST fetch.
 */
@Injectable()
@WebSocketGateway({ path: '/ws/notifications' })
export class NotificationsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly connectionsByUser = new Map<string, Set<WebSocket>>();
  private readonly userByConnection = new Map<WebSocket, string>();

  constructor(private readonly db: DbService) {}

  handleConnection(client: WebSocket): void {
    const authTimer = setTimeout(() => client.close(4401, 'auth-timeout'), AUTH_TIMEOUT_MS);

    client.on('message', (raw: Buffer) => {
      void (async () => {
        let msg: unknown;
        try {
          msg = JSON.parse(raw.toString());
        } catch {
          return;
        }
        if (
          this.userByConnection.has(client) ||
          typeof msg !== 'object' ||
          msg === null ||
          (msg as Record<string, unknown>).type !== 'auth' ||
          typeof (msg as Record<string, unknown>).token !== 'string'
        ) {
          return;
        }
        clearTimeout(authTimer);
        const token = (msg as { token: string }).token;
        const principal = await authenticateToken(token);
        const db = this.db.getDb();
        const userId = principal && db ? await callerUserId(db, principal) : null;
        if (!userId) {
          client.close(4401, 'invalid-token');
          return;
        }
        this.register(userId, client);
        client.send(JSON.stringify({ type: 'ready' }));
      })();
    });

    client.on('close', () => this.unregister(client));
  }

  handleDisconnect(client: WebSocket): void {
    this.unregister(client);
  }

  /** Send a live copy of an already-persisted notification row to every socket this user has open, if any. */
  pushToUser(userId: string, notification: unknown): void {
    const sockets = this.connectionsByUser.get(userId);
    if (!sockets) return;
    const payload = JSON.stringify({ type: 'notification', notification });
    for (const ws of sockets) {
      if (ws.readyState === ws.OPEN) ws.send(payload);
    }
  }

  private register(userId: string, client: WebSocket): void {
    this.userByConnection.set(client, userId);
    let set = this.connectionsByUser.get(userId);
    if (!set) {
      set = new Set();
      this.connectionsByUser.set(userId, set);
    }
    set.add(client);
  }

  private unregister(client: WebSocket): void {
    const userId = this.userByConnection.get(client);
    if (!userId) return;
    this.userByConnection.delete(client);
    const set = this.connectionsByUser.get(userId);
    if (!set) return;
    set.delete(client);
    if (set.size === 0) this.connectionsByUser.delete(userId);
  }
}
