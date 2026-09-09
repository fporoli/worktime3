import type { AuthenticatedPrincipal } from './jwt';

interface Queryable {
  query: (text: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
}

/** Resolve the caller's app user id from a validated token principal. */
export async function callerUserId(pool: Queryable, principal: AuthenticatedPrincipal): Promise<string | null> {
  if (principal.kind === 'local') return principal.sub;
  const found = await pool.query('SELECT user_id FROM user_identities WHERE provider_user_id = $1 LIMIT 1', [
    principal.sub,
  ]);
  return (found.rows[0]?.user_id as string) ?? null;
}

/** True when the user is an active owner/admin of the organization. */
export async function isOrgAdmin(pool: Queryable, organizationId: string, userId: string): Promise<boolean> {
  const rows = await pool.query(
    `SELECT r.name FROM organization_memberships m
     JOIN roles r ON r.id = m.role_id
     WHERE m.organization_id = $1 AND m.user_id = $2 AND m.status = 'active'`,
    [organizationId, userId],
  );
  return rows.rows.some((r) => r.name === 'owner' || r.name === 'admin');
}

/** True when the user is an active owner/admin of any organization. */
export async function isAnyOrgAdmin(pool: Queryable, userId: string): Promise<boolean> {
  const rows = await pool.query(
    `SELECT r.name FROM organization_memberships m
     JOIN roles r ON r.id = m.role_id
     WHERE m.user_id = $1 AND m.status = 'active'`,
    [userId],
  );
  return rows.rows.some((r) => r.name === 'owner' || r.name === 'admin');
}

/** True when the user is an active owner, admin, or manager of the organization. */
export async function isOrgManagerOrAdmin(pool: Queryable, organizationId: string, userId: string): Promise<boolean> {
  const rows = await pool.query(
    `SELECT r.name FROM organization_memberships m
     JOIN roles r ON r.id = m.role_id
     WHERE m.organization_id = $1 AND m.user_id = $2 AND m.status = 'active'`,
    [organizationId, userId],
  );
  return rows.rows.some((r) => r.name === 'owner' || r.name === 'admin' || r.name === 'manager');
}

/** Get the caller's active role name in the given organization. */
export async function userOrgRole(pool: Queryable, organizationId: string, userId: string): Promise<string | null> {
  const rows = await pool.query(
    `SELECT r.name FROM organization_memberships m
     JOIN roles r ON r.id = m.role_id
     WHERE m.organization_id = $1 AND m.user_id = $2 AND m.status = 'active'`,
    [organizationId, userId],
  );
  return (rows.rows[0]?.name as string) ?? null;
}

