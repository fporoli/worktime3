/** A role as GET organizations/:orgId/roles returns it (the fields every picker needs). */
export interface OrgRole {
  id: string;
  name: string;
  description: string | null;
  translations: Record<string, string> | null;
  scope: 'global' | 'override' | 'custom';
}

/** The role's display name in `locale`, falling back to its name. */
export function roleLabel(role: Pick<OrgRole, 'name' | 'translations'>, locale: string): string {
  return role.translations?.[locale] || role.name;
}

/** Roles that can be handed out: everything except owner (reserved for the org creator). */
export function assignableRoles<T extends Pick<OrgRole, 'name'>>(roles: T[]): T[] {
  return roles.filter((r) => r.name !== 'owner');
}
