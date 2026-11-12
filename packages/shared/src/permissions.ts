// Permission catalogue: which navbar entries and UI sections a role may see or edit, and for whom.
//
// A permission id is `<object>:<action>:<scope>`, e.g. `nav.teamHours:see:reports` or
// `section.basicdata.personalien:edit:all`. Roles hold ids through `role_permissions`; a
// role with `organization_id = NULL` is the default, an organization's own copy of a role
// carries its own rows. The API checks them with `can()` / `visibleUserIds()` (access.ts),
// the web app shows a navbar entry when the caller holds any id for its object.
//
// Keep this file erasable TypeScript (no enums, no imports) so Node tests can load it directly.

/** `edit` implies `see`. */
export const ACTIONS = ['see', 'edit'] as const;
export type Action = (typeof ACTIONS)[number];

/**
 * Whose data a grant covers, relative to the caller:
 * - `own`: the caller themselves
 * - `team`: anyone sharing a team with the caller (as member or lead)
 * - `reports`: the caller's direct reports (`organization_memberships.manager_user_id`)
 * - `all`: everyone in the organization
 * Team Management reads `own` as "items you lead or own" (see its catalogue entry).
 */
export const SCOPES = ['own', 'team', 'reports', 'all'] as const;
export type Scope = (typeof SCOPES)[number];

/** Scopes for objects that hold people's data vs. organization-wide pages. */
const PEOPLE_SCOPES: readonly Scope[] = SCOPES;
const ORG_SCOPES: readonly Scope[] = ['all'];

export interface PermissionObject {
  /** `nav.<entry>` or `section.<form>.<group>`. */
  id: string;
  kind: 'nav' | 'section';
  /** Scopes this object can be granted with. */
  scopes: readonly Scope[];
  /** i18n key of the object's label (for the permission editor). */
  caption: string;
  /**
   * Sections only: the navbar entry whose page shows this section, depending on whose data it is.
   * Without the parent, the section is unreachable whatever its own grants say.
   */
  parent?: { own: string; others: string };
}

/**
 * Navbar entries that can be granted. `home` is not here: it is always visible, since it is
 * where the app falls back to when a page is not allowed.
 */
export const NAV_OBJECTS: readonly PermissionObject[] = [
  { id: 'nav.time', kind: 'nav', scopes: PEOPLE_SCOPES, caption: 'nav.timeTracking' },
  { id: 'nav.projectTimesheet', kind: 'nav', scopes: PEOPLE_SCOPES, caption: 'nav.projectTimesheet' },
  { id: 'nav.timesheet', kind: 'nav', scopes: PEOPLE_SCOPES, caption: 'nav.monthlyTimesheet' },
  { id: 'nav.workTime', kind: 'nav', scopes: PEOPLE_SCOPES, caption: 'nav.workTime' },
  { id: 'nav.absences', kind: 'nav', scopes: PEOPLE_SCOPES, caption: 'nav.absences' },
  { id: 'nav.myData', kind: 'nav', scopes: PEOPLE_SCOPES, caption: 'nav.myData' },
  { id: 'nav.expenses', kind: 'nav', scopes: PEOPLE_SCOPES, caption: 'nav.expenses' },
  { id: 'nav.expenseReports', kind: 'nav', scopes: PEOPLE_SCOPES, caption: 'nav.expenseReports' },
  { id: 'nav.teamHours', kind: 'nav', scopes: PEOPLE_SCOPES, caption: 'nav.teamHours' },
  { id: 'nav.balances', kind: 'nav', scopes: PEOPLE_SCOPES, caption: 'nav.balances' },
  { id: 'nav.approvals', kind: 'nav', scopes: PEOPLE_SCOPES, caption: 'nav.approvals' },
  { id: 'nav.users', kind: 'nav', scopes: PEOPLE_SCOPES, caption: 'nav.users' },
  { id: 'nav.invitations', kind: 'nav', scopes: ORG_SCOPES, caption: 'nav.invitations' },
  // Scope here is ownership: `own` = teams you lead and projects/subprojects you own, `all` = every one.
  { id: 'nav.management', kind: 'nav', scopes: ['own', 'all'], caption: 'nav.management' },
  { id: 'nav.orgSettings', kind: 'nav', scopes: ORG_SCOPES, caption: 'nav.organizationSettings' },
  { id: 'nav.audit', kind: 'nav', scopes: ORG_SCOPES, caption: 'nav.auditLog' },
  { id: 'nav.expenseProcessing', kind: 'nav', scopes: ORG_SCOPES, caption: 'nav.expenseProcessing' },
  { id: 'nav.admin', kind: 'nav', scopes: ORG_SCOPES, caption: 'nav.adminSettings' },
];

/** Personal-details sections live on My data (own) and on the Users page (everyone else). */
const BASICDATA_PARENT = { own: 'nav.myData', others: 'nav.users' };

/** Personal-details sections: the built-in groups of the basic-data form (fields.ts). */
export const SECTION_OBJECTS: readonly PermissionObject[] = [
  { id: 'section.basicdata.personalien', kind: 'section', scopes: PEOPLE_SCOPES, caption: 'home.section.personalien', parent: BASICDATA_PARENT },
  { id: 'section.basicdata.address', kind: 'section', scopes: PEOPLE_SCOPES, caption: 'home.section.address', parent: BASICDATA_PARENT },
  { id: 'section.basicdata.civilStatus', kind: 'section', scopes: PEOPLE_SCOPES, caption: 'home.section.civilStatus', parent: BASICDATA_PARENT },
];

/** Working-time sections about one person: on My data (own) and from the Users page (others). */
export const WORK_SECTION_OBJECTS: readonly PermissionObject[] = [
  // The person's work schedule (target hours per weekday, workload, holiday canton).
  { id: 'section.workTime.schedule', kind: 'section', scopes: PEOPLE_SCOPES, caption: 'workSchedule.title', parent: BASICDATA_PARENT },
];

/** Organization-wide sections of a page; both parents are that page. */
export const ADMIN_SECTION_OBJECTS: readonly PermissionObject[] = [
  // Roles & permissions in Admin settings: create/edit roles and what they grant.
  { id: 'section.admin.roles', kind: 'section', scopes: ORG_SCOPES, caption: 'roles.title', parent: { own: 'nav.admin', others: 'nav.admin' } },
];

export const PERMISSION_OBJECTS: readonly PermissionObject[] = [...NAV_OBJECTS, ...SECTION_OBJECTS, ...WORK_SECTION_OBJECTS, ...ADMIN_SECTION_OBJECTS];

/**
 * Grants the `admin` role always keeps, so an organization cannot lock itself out of
 * role management (`owner` holds everything anyway).
 */
export const ADMIN_LOCKED_PERMISSIONS: readonly string[] = ['nav.admin:edit:all', 'section.admin.roles:edit:all'];

const OBJECTS_BY_ID = new Map(PERMISSION_OBJECTS.map((o) => [o.id, o]));

export function permissionObject(id: string): PermissionObject | undefined {
  return OBJECTS_BY_ID.get(id);
}

export function permissionId(object: string, action: Action, scope: Scope): string {
  return `${object}:${action}:${scope}`;
}

export interface ParsedPermission {
  object: string;
  action: Action;
  scope: Scope;
}

/** Splits `<object>:<action>:<scope>`; null for anything else (e.g. legacy ids like `data:read`). */
export function parsePermissionId(id: string): ParsedPermission | null {
  const parts = id.split(':');
  if (parts.length !== 3) return null;
  const [object, action, scope] = parts;
  if (!(ACTIONS as readonly string[]).includes(action) || !(SCOPES as readonly string[]).includes(scope)) return null;
  return { object, action: action as Action, scope: scope as Scope };
}

/** Every permission id in the catalogue (what `owner` implicitly holds). */
export function allPermissionIds(): string[] {
  const ids: string[] = [];
  for (const o of PERMISSION_OBJECTS) {
    for (const action of ACTIONS) for (const scope of o.scopes) ids.push(permissionId(o.id, action, scope));
  }
  return ids;
}

/**
 * The scopes `held` grants for `action` on `object`. `edit` grants also count for `see`.
 * Ids for other objects, unknown ids and legacy ids are ignored.
 */
export function grantedScopes(held: Iterable<string>, object: string, action: Action): Set<Scope> {
  const scopes = new Set<Scope>();
  for (const id of held) {
    const p = parsePermissionId(id);
    if (!p || p.object !== object) continue;
    if (p.action === action || (action === 'see' && p.action === 'edit')) scopes.add(p.scope);
  }
  return scopes;
}

/** How a target user relates to the caller; computed by the API, only for the scopes it needs. */
export interface TargetRelation {
  isSelf: boolean;
  isTeammate: boolean;
  isReport: boolean;
  /** The target is an active member of the organization. */
  isMember: boolean;
}

/** True when any of `scopes` covers a target with this relation to the caller. */
export function scopesCover(scopes: Iterable<Scope>, rel: TargetRelation): boolean {
  for (const s of scopes) {
    if (s === 'own' && rel.isSelf) return true;
    if (s === 'team' && rel.isTeammate) return true;
    if (s === 'reports' && rel.isReport) return true;
    if (s === 'all' && rel.isMember) return true;
  }
  return false;
}

/** True when the caller holds any grant on the object: enough to show its navbar entry. */
export function holdsAny(held: Iterable<string>, object: string): boolean {
  return grantedScopes(held, object, 'see').size > 0;
}

/** True when the caller holds `action` on the object for someone other than themselves (scope beyond `own`). */
export function holdsBeyondOwn(held: Iterable<string>, object: string, action: Action): boolean {
  for (const s of grantedScopes(held, object, action)) if (s !== 'own') return true;
  return false;
}

/** True when the caller may edit (and so review change requests for) other people's personal details. */
export function isBasicDataReviewer(held: Iterable<string>): boolean {
  const ids = [...held];
  return SECTION_OBJECTS.some((o) => holdsBeyondOwn(ids, o.id, 'edit'));
}

/** True when the caller may see some of other people's personal details. */
export function seesOthersBasicData(held: Iterable<string>): boolean {
  const ids = [...held];
  return SECTION_OBJECTS.some((o) => holdsBeyondOwn(ids, o.id, 'see'));
}

/** The navbar entry a section depends on, for own data vs. someone else's. */
export function sectionParent(object: string, forSelf: boolean): string | null {
  const o = permissionObject(object);
  if (!o?.parent) return null;
  return forSelf ? o.parent.own : o.parent.others;
}
