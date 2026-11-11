import { sql } from 'drizzle-orm';
import type { Db } from './db.service';
import type { AuthenticatedPrincipal } from './jwt';
import {
  allPermissionIds,
  grantedScopes,
  scopesCover,
  sectionParent,
  type Action,
  type Scope,
} from '@worktime3/shared/permissions';

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

/** True when the user is a superdeveloper: edits the global form template and any org's template. */
export async function isSuperDeveloper(db: Executor, userId: string): Promise<boolean> {
  const rows = await db.execute(sql`SELECT is_superdeveloper FROM users WHERE id = ${userId} LIMIT 1`);
  return rows.rows[0]?.is_superdeveloper === true;
}

/** True when the user may edit this organization's form template: its developer, or a superdeveloper. */
export async function isOrgDeveloper(db: Executor, organizationId: string, userId: string): Promise<boolean> {
  const names = await activeRoleNames(db, organizationId, userId);
  if (names.includes('developer')) return true;
  return isSuperDeveloper(db, userId);
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
 * True when the caller may grant or revoke `roleId` for other members: whoever
 * administers members (a Users edit grant reaching everyone; admin by default) can always manage any role, and a role can additionally
 * name its own admins via `roles.admin_user_ids` — e.g. so a "billing-admin"
 * role can be handed out without making someone a full org admin.
 */
export async function canManageRole(
  db: Executor,
  organizationId: string,
  callerId: string,
  roleId: string,
): Promise<boolean> {
  if (await reachesAll(db, organizationId, callerId, 'nav.users', 'edit')) return true;
  const rows = await db.execute(
    sql`SELECT 1 FROM roles WHERE id = ${roleId} AND ${callerId} = ANY(admin_user_ids) LIMIT 1`,
  );
  return rows.rows.length > 0;
}

/** The `manager_user_id` on `userId`'s membership in this org, or null if they have none (top of their chain). */
export async function membershipManagerId(db: Executor, organizationId: string, userId: string): Promise<string | null> {
  const rows = await db.execute(
    sql`SELECT manager_user_id FROM organization_memberships WHERE organization_id = ${organizationId} AND user_id = ${userId} LIMIT 1`,
  );
  return (rows.rows[0]?.manager_user_id as string | null) ?? null;
}

/** True when `managerId` is the org's designated manager for `targetUserId` — i.e. approvals for them route to `managerId`. */
export async function isManagerOf(db: Executor, organizationId: string, managerId: string, targetUserId: string): Promise<boolean> {
  return (await membershipManagerId(db, organizationId, targetUserId)) === managerId;
}

/** user_ids whose membership in this org names `managerId` as their manager — i.e. `managerId`'s direct reports. */
export async function directReportUserIds(db: Executor, organizationId: string, managerId: string): Promise<string[]> {
  const rows = await db.execute(
    sql`SELECT user_id FROM organization_memberships WHERE organization_id = ${organizationId} AND manager_user_id = ${managerId}`,
  );
  return rows.rows.map((r: Record<string, unknown>) => r.user_id as string);
}

/**
 * Team Management on one team/project/subproject: an `edit` grant reaching `all` manages any,
 * an `own` grant only those the caller leads or owns (`ownerIds`: lead, owner, parent owner).
 */
export async function canManageItem(db: Executor, organizationId: string, callerId: string, ownerIds: (string | null | undefined)[]): Promise<boolean> {
  const scopes = grantedScopes(await permissionIdsOf(db, organizationId, callerId), 'nav.management', 'edit');
  return scopes.has('all') || (scopes.has('own') && ownerIds.includes(callerId));
}

/** True when the caller may onboard/offboard members on this team: Team Management on it (its lead, or `all`). */
export async function canManageTeamMembers(db: Executor, organizationId: string, teamId: string, callerId: string): Promise<boolean> {
  const rows = await db.execute(
    sql`SELECT lead_user_id FROM teams WHERE id = ${teamId} AND organization_id = ${organizationId} LIMIT 1`,
  );
  if (rows.rows.length === 0) return false;
  return canManageItem(db, organizationId, callerId, [rows.rows[0].lead_user_id as string | null]);
}

/**
 * True when `dateOrTimestamp` falls inside a submitted/approved timesheet
 * period for this user — the single gate the project-time create/update/delete
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

// ---------------------------------------------------------------------------------------------
// Permissions (packages/shared/src/permissions.ts): `<object>:<action>:<scope>` ids held via
// membership_roles -> role_permissions. An organization's own copy of a role carries its own
// rows, so this is a plain join; `owner` holds everything without rows.

/** The caller's permission ids in this organization, merged across all their active roles. */
export async function permissionIdsOf(db: Executor, organizationId: string, userId: string): Promise<Set<string>> {
  const rows = await db.execute(
    sql`SELECT r.name, rp.permission_id FROM organization_memberships m
        JOIN membership_roles mr ON mr.membership_id = m.id
        JOIN roles r ON r.id = mr.role_id
        LEFT JOIN role_permissions rp ON rp.role_id = r.id
        WHERE m.organization_id = ${organizationId} AND m.user_id = ${userId} AND m.status = 'active'`,
  );
  return mergePermissionRows(rows.rows as { name: string; permission_id: string | null }[]);
}

/** Folds `(role name, permission id)` rows into one set; an `owner` row means the whole catalogue. */
export function mergePermissionRows(rows: { name: string; permission_id: string | null }[]): Set<string> {
  if (rows.some((r) => r.name === 'owner')) return new Set(allPermissionIds());
  const ids = new Set<string>();
  for (const r of rows) if (r.permission_id) ids.add(r.permission_id);
  return ids;
}

/** True when `a` and `b` share a team in this organization, as members or as its lead. */
async function sharesTeam(db: Executor, organizationId: string, a: string, b: string): Promise<boolean> {
  const rows = await db.execute(
    sql`WITH people AS (
          SELECT t.id AS team_id, m.user_id FROM teams t
            JOIN team_members tm ON tm.team_id = t.id
            JOIN organization_memberships m ON m.id = tm.membership_id
            WHERE t.organization_id = ${organizationId}
          UNION
          SELECT t.id, t.lead_user_id FROM teams t
            WHERE t.organization_id = ${organizationId} AND t.lead_user_id IS NOT NULL
        )
        SELECT 1 FROM people x JOIN people y ON y.team_id = x.team_id
        WHERE x.user_id = ${a} AND y.user_id = ${b} LIMIT 1`,
  );
  return rows.rows.length > 0;
}

/** user_ids sharing a team with `userId` in this organization (including `userId` if they are in one). */
async function teammateUserIds(db: Executor, organizationId: string, userId: string): Promise<string[]> {
  const rows = await db.execute(
    sql`WITH people AS (
          SELECT t.id AS team_id, m.user_id FROM teams t
            JOIN team_members tm ON tm.team_id = t.id
            JOIN organization_memberships m ON m.id = tm.membership_id
            WHERE t.organization_id = ${organizationId}
          UNION
          SELECT t.id, t.lead_user_id FROM teams t
            WHERE t.organization_id = ${organizationId} AND t.lead_user_id IS NOT NULL
        )
        SELECT DISTINCT y.user_id FROM people x JOIN people y ON y.team_id = x.team_id
        WHERE x.user_id = ${userId}`,
  );
  return rows.rows.map((r: Record<string, unknown>) => r.user_id as string);
}

async function isActiveMember(db: Executor, organizationId: string, userId: string): Promise<boolean> {
  const rows = await db.execute(
    sql`SELECT 1 FROM organization_memberships WHERE organization_id = ${organizationId} AND user_id = ${userId} AND status = 'active' LIMIT 1`,
  );
  return rows.rows.length > 0;
}

/** Whether `scopes` cover `targetUserId`; only runs the queries the scopes need. */
async function coversTarget(db: Executor, organizationId: string, callerId: string, targetUserId: string, scopes: Set<Scope>): Promise<boolean> {
  const isSelf = targetUserId === callerId;
  if (isSelf && scopes.has('own')) return true;
  const rel = { isSelf, isTeammate: false, isReport: false, isMember: false };
  if (scopes.has('all')) rel.isMember = await isActiveMember(db, organizationId, targetUserId);
  if (!rel.isMember && scopes.has('reports')) rel.isReport = await isManagerOf(db, organizationId, callerId, targetUserId);
  if (!rel.isMember && !rel.isReport && scopes.has('team')) rel.isTeammate = await sharesTeam(db, organizationId, callerId, targetUserId);
  return scopesCover(scopes, rel);
}

/**
 * True when the caller may `action` (`see` / `edit`) `object` (a navbar entry or UI section) —
 * for `targetUserId`'s data when given, otherwise at all (e.g. to show a navbar entry).
 * A section also needs its parent navbar entry: My data for the caller's own data, the
 * Users page for anyone else's.
 */
export async function can(
  db: Executor,
  organizationId: string,
  callerId: string,
  object: string,
  action: Action,
  targetUserId?: string,
  held?: Set<string>,
): Promise<boolean> {
  const ids = held ?? (await permissionIdsOf(db, organizationId, callerId));
  const parent = sectionParent(object, targetUserId === undefined || targetUserId === callerId);
  if (parent && !(await can(db, organizationId, callerId, parent, 'see', targetUserId, ids))) return false;
  const scopes = grantedScopes(ids, object, action);
  if (scopes.size === 0) return false;
  if (targetUserId === undefined) return true;
  return coversTarget(db, organizationId, callerId, targetUserId, scopes);
}

/**
 * Whose data the caller may `action` on `object`: `'all'`, or the set of user ids their
 * grants cover (for list endpoints, instead of calling `can()` per person). For a section,
 * the parent navbar entries narrow the result the same way `can()` does.
 */
export async function visibleUserIds(
  db: Executor,
  organizationId: string,
  callerId: string,
  object: string,
  action: Action,
  held?: Set<string>,
): Promise<'all' | Set<string>> {
  const ids = held ?? (await permissionIdsOf(db, organizationId, callerId));
  const own = await scopedUserIds(db, organizationId, callerId, grantedScopes(ids, object, action));
  const ownParent = sectionParent(object, true);
  const othersParent = sectionParent(object, false);
  if (!ownParent || !othersParent) return own;
  // Own data needs the "own" parent, everyone else's the "others" parent.
  const selfAllowed = (await can(db, organizationId, callerId, ownParent, 'see', callerId, ids)) && hasUser(own, callerId);
  const others = intersect(own, await scopedUserIds(db, organizationId, callerId, grantedScopes(ids, othersParent, 'see')));
  if (others !== 'all') {
    others.delete(callerId);
    if (selfAllowed) others.add(callerId);
    return others;
  }
  if (selfAllowed) return 'all';
  // Everyone but the caller: spell out the members.
  const rows = await db.execute(
    sql`SELECT user_id FROM organization_memberships WHERE organization_id = ${organizationId} AND status = 'active' AND user_id <> ${callerId}`,
  );
  return new Set(rows.rows.map((r: Record<string, unknown>) => r.user_id as string));
}

async function scopedUserIds(db: Executor, organizationId: string, callerId: string, scopes: Set<Scope>): Promise<'all' | Set<string>> {
  if (scopes.has('all')) return 'all';
  const out = new Set<string>();
  if (scopes.has('own')) out.add(callerId);
  if (scopes.has('reports')) for (const id of await directReportUserIds(db, organizationId, callerId)) out.add(id);
  if (scopes.has('team')) for (const id of await teammateUserIds(db, organizationId, callerId)) out.add(id);
  return out;
}

function hasUser(set: 'all' | Set<string>, userId: string): boolean {
  return set === 'all' || set.has(userId);
}

function intersect(a: 'all' | Set<string>, b: 'all' | Set<string>): 'all' | Set<string> {
  if (a === 'all') return b === 'all' ? 'all' : new Set(b);
  if (b === 'all') return new Set(a);
  return new Set([...a].filter((id) => b.has(id)));
}

// ---------------------------------------------------------------------------------------------
// People's data on a page (project time, absences, expenses, ...). Two rules combine:
// - the reporting line: a person's designated manager always sees their data (approvals route
//   there), whatever role the manager holds;
// - permissions: a `see` grant on the page's object reaching that person (e.g. admin `all`).

/** Self, the target's designated manager, or a `see` grant on `object` covering the target. */
export async function canSeeUserData(db: Executor, organizationId: string, callerId: string, object: string, targetUserId: string): Promise<boolean> {
  if (targetUserId === callerId) return true;
  if (await isManagerOf(db, organizationId, callerId, targetUserId)) return true;
  return can(db, organizationId, callerId, object, 'see', targetUserId);
}

/** True when the caller's `action` grants on `object` reach everyone in the organization. */
export async function reachesAll(db: Executor, organizationId: string, callerId: string, object: string, action: Action = 'see'): Promise<boolean> {
  const ids = await permissionIdsOf(db, organizationId, callerId);
  return grantedScopes(ids, object, action).has('all');
}

/** Whose data a list shows when no person is asked for: everyone, or self + direct reports + whoever the grants cover. */
export async function listableUserIds(db: Executor, organizationId: string, callerId: string, object: string): Promise<'all' | string[]> {
  const granted = await visibleUserIds(db, organizationId, callerId, object, 'see');
  if (granted === 'all') return 'all';
  const ids = new Set(granted);
  ids.add(callerId);
  for (const id of await directReportUserIds(db, organizationId, callerId)) ids.add(id);
  return [...ids];
}

/**
 * An override on someone's data: an `edit` grant on `object` covering the target that goes
 * beyond `own` (e.g. admin `all`). Everyone's `own` grant is ignored, so a member does not
 * gain admin-only actions on their own records.
 */
export async function canEditBeyondOwn(db: Executor, organizationId: string, callerId: string, object: string, targetUserId: string): Promise<boolean> {
  const ids = await permissionIdsOf(db, organizationId, callerId);
  const beyond = new Set([...ids].filter((id) => id !== `${object}:edit:own`));
  return can(db, organizationId, callerId, object, 'edit', targetUserId, beyond);
}
