import { Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { DbService } from './db.service';
import { callerUserId } from './access';
import type { AuthenticatedRequest } from './jwt.guard';
import { NotificationsService } from './notifications.service';

/** REST surface for the notification bell: initial hydration + mark-read, alongside the live WebSocket push (NotificationsGateway). */
@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly db: DbService,
    private readonly notifications: NotificationsService,
  ) {}

  @Get()
  async list(@Req() req: AuthenticatedRequest, @Query('unread') unread?: string) {
    const db = this.db.getDb();
    if (!db) return [];
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return [];
    return this.notifications.list(callerId, { unreadOnly: unread === 'true' });
  }

  @Get('unread-count')
  async unreadCount(@Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { count: 0 };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { count: 0 };
    return { count: await this.notifications.unreadCount(callerId) };
  }

  @Post(':id/read')
  async markRead(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };
    const marked = await this.notifications.markRead(callerId, id);
    return { ok: marked };
  }

  @Post('read-all')
  async markAllRead(@Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };
    const count = await this.notifications.markAllRead(callerId);
    return { ok: true, count };
  }
}
