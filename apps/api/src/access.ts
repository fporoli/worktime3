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

/** Highest privilege first — used to pick a single "display" role out of a membership's role set. */
const ROLE_PRIORITY = ['owner', 'admin', 'manager', 'member', 'guest'];

/** Reduce a set of role names (one membership can hold several) to the single highest-privilege one. */
export function pickPrimaryRole(names: string[]): string | null {
  if (names.length === 0) return null;
  return [...names].sort((a, b) => {
    const ai = ROLE_PRIORITY.indexOf(a);
    const bi = ROLE_PRIORITY.indexOf(b);
    return (ai === -1 ? ROLE_PRIORITY.length : ai) - (bi === -1 ? ROLE_PRIORITY.length : bi);
  })[0];
}

/** All of a user's active role names in an organization — a membership can now hold more than one. */
async function activeRoleNames(db: Executor, organizationId: string, userId: string): Promise<string[]> {
  const rows = await db.execute(
    sql`SELECT r.name FROM organization_memberships m
        JOIN membership_roles mr ON mr.membership_id = m.id
        JOIN roles r ON r.id = mr.role_id
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
        JOIN membership_roles mr ON mr.membership_id = m.id
        JOIN roles r ON r.id = mr.role_id
        WHERE m.user_id = ${userId} AND m.status = 'active'`,
  );
  return rows.rows.some((r: Record<string, unknown>) => r.name === 'owner' || r.name === 'admin');
}

/** True when the user is an active owner, admin, or manager of the organization. */
export async function isOrgManagerOrAdmin(db: Executor, organizationId: string, userId: string): Promise<boolean> {
  const names = await activeRoleNames(db, organizationId, userId);
  return names.includes('owner') || names.includes('admin') || names.includes('manager');
}

/**
 * The caller's single highest-privilege role name in the organization — a
 * membership can hold several roles at once, so this collapses them to the
 * one existing single-role permission checks (e.g. `role === 'manager'`)
 * still expect. Custom roles outside the known ladder sort after it.
 */
export async function userOrgRole(db: Executor, organizationId: string, userId: string): Promise<string | null> {
  const names = await activeRoleNames(db, organizationId, userId);
  return pickPrimaryRole(names);
}

/**
 * True when the caller may grant or revoke `roleId` for other members: an
 * org owner/admin can always manage any role, and a role can additionally
 * name its own admins via `roles.admin_user_ids` — e.g. so a "billing-admin"
 * role can be handed out without making someone a full org admin.
 */
export async function canManageRole(
  db: Executor,
  organizationId: string,
  callerId: string,
  roleId: string,
): Promise<boolean> {
  if (await isOrgAdmin(db, organizationId, callerId)) return true;
  const rows = await db.execute(
    sql`SELECT 1 FROM roles WHERE id = ${roleId} AND ${callerId} = ANY(admin_user_ids) LIMIT 1`,
  );
  return rows.rows.length > 0;
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
