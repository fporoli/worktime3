import { Body, Controller, Post, Req } from '@nestjs/common';
import { DbService } from './db.service';
import { callerUserId, isOrgMember, userOrgRole } from './access';
import type { AuthenticatedRequest } from './jwt.guard';
import { AssistantService, type AssistantMessage } from './assistant.service';

@Controller('assistant')
export class AssistantController {
  constructor(
    private readonly db: DbService,
    private readonly assistant: AssistantService,
  ) {}

  @Post('chat')
  async chat(
    @Body() body: { orgId: string; messages: AssistantMessage[] },
    @Req() req: AuthenticatedRequest,
  ) {
    if (!this.assistant.isConfigured()) return { ok: false, error: 'assistant-not-configured' };
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };
    if (!body.orgId || !(await isOrgMember(db, body.orgId, callerId))) return { ok: false, error: 'forbidden' };
    const messages = Array.isArray(body.messages) ? body.messages : [];
    if (messages.length === 0) return { ok: false, error: 'no-messages' };

    const role = (await userOrgRole(db, body.orgId, callerId)) ?? 'member';
    try {
      const { reply, actions } = await this.assistant.chat(callerId, body.orgId, role, messages);
      return { ok: true, reply, actions };
    } catch (err) {
      // Surface upstream OpenAI failures (rate limit, no credits, etc.) as a clean error
      // instead of a 500 — same "never fail obscurely" convention as the mailer.
      const message = err instanceof Error ? err.message : 'unknown error';
      return { ok: false, error: 'assistant-request-failed', detail: message };
    }
  }
}
