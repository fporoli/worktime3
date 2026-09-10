import { sql } from 'drizzle-orm';
import type { Db } from './db.service';
import type { AuthenticatedPrincipal } from './jwt';

/** The slice of Db these helpers need — easy to fake in tests, satisfied by any real Db. */
export type Executor = Pick<Db, 'execute'>;

/** Resolve the caller's app user id from a validated token principal. */
export async function callerUserId(db: Executor, principal: AuthenticatedPrincipal): Promise<string | null> {
  if (principal.kind === 'local') return principal.sub;
  const found = await db.execute(
    sql`SELECT user_id FROM user_identities WHERE provider_user_id = ${principal.sub} LIMIT 1`,
  );
  return (found.rows[0]?.user_id as string) ?? null;
}

async function activeRoleNames(db: Executor, organizationId: string, userId: string): Promise<string[]> {
  const rows = await db.execute(
    sql`SELECT r.name FROM organization_memberships m
        JOIN roles r ON r.id = m.role_id
        WHERE m.organization_id = ${organizationId} AND m.user_id = ${userId} AND m.status = 'active'`,
  );
  return rows.rows.map((r: Record<string, unknown>) => r.name as string);
}

/** True when the user has any active membership in the organization — the baseline gate for reading its data at all. */
export async function isOrgMember(db: Executor, organizationId: string, userId: string): Promise<boolean> {
  const names = await activeRoleNames(db, organizationId, userId);
  return names.length > 0;
}

/** True when the user is an active owner/admin of the organization. */
export async function isOrgAdmin(db: Executor, organizationId: string, userId: string): Promise<boolean> {
  const names = await activeRoleNames(db, organizationId, userId);
  return names.includes('owner') || names.includes('admin');
}

/** True when the user is an active owner/admin of any organization. */
export async function isAnyOrgAdmin(db: Executor, userId: string): Promise<boolean> {
  const rows = await db.execute(
    sql`SELECT r.name FROM organization_memberships m
        JOIN roles r ON r.id = m.role_id
        WHERE m.user_id = ${userId} AND m.status = 'active'`,
  );
  return rows.rows.some((r: Record<string, unknown>) => r.name === 'owner' || r.name === 'admin');
}

/** True when the user is an active owner, admin, or manager of the organization. */
export async function isOrgManagerOrAdmin(db: Executor, organizationId: string, userId: string): Promise<boolean> {
  const names = await activeRoleNames(db, organizationId, userId);
  return names.includes('owner') || names.includes('admin') || names.includes('manager');
}

/** Get the caller's active role name in the given organization. */
export async function userOrgRole(db: Executor, organizationId: string, userId: string): Promise<string | null> {
  const names = await activeRoleNames(db, organizationId, userId);
  return names[0] ?? null;
}

/**
 * True when `dateOrTimestamp` falls inside a submitted/approved timesheet
 * period for this user — the single gate the work-time create/update/delete
 * handlers call before touching an entry. `rejected`/`open` periods are NOT
 * locked (an employee fixing a rejected month must be able to edit again).
 */
export async function isPeriodLocked(
  db: Executor,
  organizationId: string,
  userId: string,
  dateOrTimestamp: string,
): Promise<boolean> {
  const rows = await db.execute(
    sql`SELECT 1 FROM timesheet_periods
        WHERE organization_id = ${organizationId} AND user_id = ${userId}
          AND status IN ('submitted', 'approved')
          AND period_start <= ${dateOrTimestamp}::date AND period_end > ${dateOrTimestamp}::date
        LIMIT 1`,
  );
  return rows.rows.length > 0;
}
