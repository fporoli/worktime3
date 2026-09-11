import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions';
import { and, asc, eq, ilike, inArray } from 'drizzle-orm';
import { DbService, type Db } from './db.service';
import { isOrgMember, isOrgManagerOrAdmin, isPeriodLocked } from './access';
import { work_times, projects, teams, team_members, organization_memberships, users } from './db/schema';

export interface AssistantMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ToolContext {
  db: Db;
  callerId: string;
  orgId: string;
}

const TOOLS: ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'get_my_time_entries',
      description: "List the caller's own booked work-time entries in a date range.",
      parameters: {
        type: 'object',
        properties: {
          from: { type: 'string', description: 'ISO date, inclusive, e.g. 2026-09-01' },
          to: { type: 'string', description: 'ISO date, exclusive, e.g. 2026-10-01' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_time_entries',
      description:
        'Batch-create work-time entries for the caller. Each entry needs a date, start and end time (HH:MM, 24h), and optionally a project name and comment. Returns per-entry success/failure — a locked (submitted/approved) month will fail for that entry.',
      parameters: {
        type: 'object',
        properties: {
          entries: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                date: { type: 'string', description: 'ISO date, e.g. 2026-09-15' },
                startTime: { type: 'string', description: '24h HH:MM, e.g. 09:00' },
                endTime: { type: 'string', description: '24h HH:MM, e.g. 17:30' },
                projectName: { type: 'string' },
                comment: { type: 'string' },
              },
              required: ['date', 'startTime', 'endTime'],
            },
          },
        },
        required: ['entries'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_team_hours',
      description: "Manager/admin only: total booked hours per member of a team, by the team's name.",
      parameters: {
        type: 'object',
        properties: {
          teamName: { type: 'string' },
          from: { type: 'string', description: 'ISO date, inclusive' },
          to: { type: 'string', description: 'ISO date, exclusive' },
        },
        required: ['teamName'],
      },
    },
  },
];

@Injectable()
export class AssistantService {
  constructor(private readonly db: DbService) {}

  /**
   * Provider is swappable without touching any call site below: Gemini
   * exposes an OpenAI-compatible endpoint (https://ai.google.dev/gemini-api/docs/openai),
   * so pointing the same `openai` SDK at it — different baseURL, key, and
   * model — is enough. GEMINI_API_KEY wins if both happen to be set.
   */
  private client(): OpenAI | null {
    const geminiKey = process.env.GEMINI_API_KEY;
    if (geminiKey) {
      return new OpenAI({ apiKey: geminiKey, baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/' });
    }
    const openaiKey = process.env.OPENAI_API_KEY;
    if (openaiKey) return new OpenAI({ apiKey: openaiKey });
    return null;
  }

  private model(): string {
    if (process.env.GEMINI_API_KEY) return process.env.GEMINI_MODEL || 'gemini-3.6-flash';
    return process.env.OPENAI_MODEL || 'gpt-4o-mini';
  }

  isConfigured(): boolean {
    return !!(process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY);
  }

  async chat(
    callerId: string,
    orgId: string,
    role: string,
    history: AssistantMessage[],
  ): Promise<{ reply: string; actions: string[] }> {
    const client = this.client();
    const db = this.db.getDb();
    if (!client || !db) return { reply: '', actions: [] };

    const today = new Date().toISOString().slice(0, 10);
    const convo: ChatCompletionMessageParam[] = [
      {
        role: 'system',
        content:
          `You are the Worktime assistant. Today's date is ${today}. The caller's role in this organization is "${role}". ` +
          'You can look up and create the caller\'s own time entries, and — only if their role is manager or admin — pull team-hours reports. ' +
          'Every tool call is independently authorization-checked server-side regardless of the caller\'s stated role, so a request outside their permission will come back as an error — explain that plainly rather than guessing around it. ' +
          'When creating entries, always report back exactly which ones succeeded or failed and why (e.g. a locked month). Keep replies concise.',
      },
      ...history.map((m): ChatCompletionMessageParam => ({ role: m.role, content: m.content })),
    ];

    const ctx: ToolContext = { db, callerId, orgId };
    const actions: string[] = [];
    const model = this.model();

    for (let round = 0; round < 5; round++) {
      const completion = await client.chat.completions.create({ model, messages: convo, tools: TOOLS });
      const message = completion.choices[0]?.message;
      if (!message) break;
      convo.push(message);

      const calls = message.tool_calls?.filter((c): c is typeof c & { type: 'function' } => c.type === 'function');
      if (!calls || calls.length === 0) {
        return { reply: message.content ?? '', actions };
      }

      for (const call of calls) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(call.function.arguments || '{}');
        } catch { /* malformed args from the model; run with defaults */ }
        const result = await this.runTool(call.function.name, args, ctx);
        if (result.actionSummary) actions.push(result.actionSummary);
        convo.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result.data) });
      }
    }
    return { reply: "Sorry, that took too many steps — try asking in a simpler way.", actions };
  }

  private async runTool(
    name: string,
    args: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<{ data: unknown; actionSummary?: string }> {
    switch (name) {
      case 'get_my_time_entries':
        return { data: await this.getMyTimeEntries(ctx, args) };
      case 'create_time_entries':
        return this.createTimeEntries(ctx, args);
      case 'get_team_hours':
        return { data: await this.getTeamHours(ctx, args) };
      default:
        return { data: { error: `unknown-tool:${name}` } };
    }
  }

  private async getMyTimeEntries(ctx: ToolContext, args: Record<string, unknown>) {
    const conditions = [eq(work_times.organization_id, ctx.orgId), eq(work_times.user_id, ctx.callerId)];
    const rows = await ctx.db
      .select({
        id: work_times.id,
        start_time: work_times.start_time,
        end_time: work_times.end_time,
        comment: work_times.comment,
        project_name: projects.name,
      })
      .from(work_times)
      .leftJoin(projects, eq(projects.id, work_times.project_id))
      .where(and(...conditions))
      .orderBy(asc(work_times.start_time));
    const from = typeof args.from === 'string' ? args.from : undefined;
    const to = typeof args.to === 'string' ? args.to : undefined;
    return rows.filter((r) => (!from || r.start_time >= from) && (!to || r.start_time < to));
  }

  private async createTimeEntries(ctx: ToolContext, args: Record<string, unknown>) {
    if (!(await isOrgMember(ctx.db, ctx.orgId, ctx.callerId))) {
      return { data: { error: 'forbidden — you are not a member of this organization' } };
    }
    const entries = Array.isArray(args.entries) ? (args.entries as Record<string, unknown>[]) : [];
    if (entries.length === 0) return { data: { error: 'no-entries-provided' } };

    const orgProjects = await ctx.db
      .select({ id: projects.id, name: projects.name })
      .from(projects)
      .where(eq(projects.organization_id, ctx.orgId));

    const results: Array<{ date: unknown; ok: boolean; error?: string }> = [];
    let created = 0;
    for (const e of entries) {
      const date = typeof e.date === 'string' ? e.date : null;
      const startTime = typeof e.startTime === 'string' ? e.startTime : null;
      const endTime = typeof e.endTime === 'string' ? e.endTime : null;
      if (!date || !startTime || !endTime) {
        results.push({ date, ok: false, error: 'missing date/startTime/endTime' });
        continue;
      }
      const start = new Date(`${date}T${startTime}:00`).toISOString();
      const end = new Date(`${date}T${endTime}:00`).toISOString();
      if (!(new Date(end).getTime() > new Date(start).getTime())) {
        results.push({ date, ok: false, error: 'end must be after start' });
        continue;
      }
      if (await isPeriodLocked(ctx.db, ctx.orgId, ctx.callerId, date)) {
        results.push({ date, ok: false, error: 'that month is locked (submitted/approved)' });
        continue;
      }
      const projectName = typeof e.projectName === 'string' ? e.projectName : undefined;
      const project = projectName
        ? orgProjects.find((p) => p.name.toLowerCase() === projectName.toLowerCase())
        : undefined;
      if (projectName && !project) {
        results.push({ date, ok: false, error: `unknown project "${projectName}"` });
        continue;
      }
      await ctx.db.insert(work_times).values({
        user_id: ctx.callerId,
        organization_id: ctx.orgId,
        project_id: project?.id ?? null,
        start_time: start,
        end_time: end,
        comment: typeof e.comment === 'string' ? e.comment : null,
      });
      created += 1;
      results.push({ date, ok: true });
    }
    return {
      data: { results },
      actionSummary: created > 0 ? `Created ${created} of ${entries.length} time entries.` : undefined,
    };
  }

  private async getTeamHours(ctx: ToolContext, args: Record<string, unknown>) {
    if (!(await isOrgManagerOrAdmin(ctx.db, ctx.orgId, ctx.callerId))) {
      return { error: 'forbidden — manager or admin role required' };
    }
    const teamName = typeof args.teamName === 'string' ? args.teamName : '';
    const [team] = await ctx.db
      .select({ id: teams.id })
      .from(teams)
      .where(and(eq(teams.organization_id, ctx.orgId), ilike(teams.name, teamName)));
    if (!team) return { error: `unknown team "${teamName}"` };

    const members = await ctx.db
      .select({ user_id: organization_memberships.user_id, display_name: users.display_name })
      .from(team_members)
      .innerJoin(organization_memberships, eq(organization_memberships.id, team_members.membership_id))
      .innerJoin(users, eq(users.id, organization_memberships.user_id))
      .where(eq(team_members.team_id, team.id));
    if (members.length === 0) return { team: teamName, members: [] };

    const memberIds = members.map((m) => m.user_id);
    const from = typeof args.from === 'string' ? args.from : undefined;
    const to = typeof args.to === 'string' ? args.to : undefined;
    const conditions = [inArray(work_times.user_id, memberIds), eq(work_times.organization_id, ctx.orgId)];
    const entries = await ctx.db
      .select({ user_id: work_times.user_id, start_time: work_times.start_time, end_time: work_times.end_time })
      .from(work_times)
      .where(and(...conditions));
    const filtered = entries.filter((e) => (!from || e.start_time >= from) && (!to || e.start_time < to));

    return {
      team: teamName,
      members: members.map((m) => {
        const mins = filtered
          .filter((e) => e.user_id === m.user_id)
          .reduce((sum, e) => sum + (new Date(e.end_time).getTime() - new Date(e.start_time).getTime()) / 60000, 0);
        return { displayName: m.display_name, totalHours: Math.round((mins / 60) * 100) / 100 };
      }),
    };
  }

}
