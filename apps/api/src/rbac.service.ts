import { Injectable } from '@nestjs/common';

// Mirrors packages/shared ROLE_PERMISSIONS so the API enforces the same matrix.
const ROLE_PERMISSIONS: Record<string, string[]> = {
  admin: ['org:admin', 'members:manage', 'teams:manage', 'sso:configure', 'audit:read', 'data:read', 'data:write', 'projects:manage', 'worktime:approve'],
  manager: ['members:manage', 'teams:manage', 'data:read', 'data:write', 'projects:manage'],
  user: ['data:read', 'data:write'],
};

@Injectable()
export class RbacService {
  can(role: string, permission: string): boolean {
    return (ROLE_PERMISSIONS[role] ?? []).includes(permission);
  }

  /** Manager may create subprojects only when owner of the parent project. */
  canCreateSubproject(role: string, isProjectOwner: boolean): boolean {
    if (role === 'admin') return true;
    if (role === 'manager') return isProjectOwner;
    return false;
  }
}
