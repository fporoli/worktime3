// Shared domain types, enums and RBAC matrix.
// Mirrors schema.sql + 002-worktime-extensions.sql. Single source of truth for API + Web.

export type UUID = string;

export enum UserStatus {
  Active = 'active',
  Suspended = 'suspended',
  Deactivated = 'deactivated',
}

export enum AuthProviderType {
  Password = 'password',
  Azure = 'azure_oidc',
  Google = 'google',
  Apple = 'apple',
  Github = 'github',
  SamlSso = 'saml_sso',
  Oidc = 'oidc',
  Passkey = 'passkey',
}

export enum OrganizationType {
  Personal = 'personal',
  Team = 'team',
  Enterprise = 'enterprise',
}

export enum SsoProtocol {
  Saml2 = 'saml2',
  Oidc = 'oidc',
}

export enum MembershipStatus {
  Active = 'active',
  Invited = 'invited',
  Suspended = 'suspended',
}

export enum InvitationStatus {
  Pending = 'pending',
  Accepted = 'accepted',
  Revoked = 'revoked',
  Expired = 'expired',
}

export enum ProjectType {
  Internal = 'internal',
  Customer = 'customer',
  Research = 'research',
}

export enum SubprojectType {
  Phase = 'phase',
  WorkPackage = 'work_package',
  Task = 'task',
}

export enum AuditAction {
  Created = 'created',
  Updated = 'updated',
  Deleted = 'deleted',
}

export interface UserSettings {
  salutation?: string;
  dateOfBirth?: string;
  applicationLanguage?: string;
  [k: string]: unknown;
}

export interface User {
  id: UUID;
  email: string;
  displayName: string;
  firstName?: string;
  middleName?: string;
  lastName?: string;
  settings?: UserSettings;
  status: UserStatus;
  locale: string;
  timezone: string;
  isActive: boolean;
  createdAt: string;
}

export interface Organization {
  id: UUID;
  name: string;
  parentOrganizationId?: UUID | null;
  country?: string;
  settings?: Record<string, unknown>;
  isActive: boolean;
  type: OrganizationType;
  createdAt: string;
}

export interface OrgDomain {
  domain: string;
  status: string;
  autoJoin: boolean;
}

export interface SsoConfiguration {
  protocol: SsoProtocol;
  idpEntityId: string;
  idpSsoUrl: string;
  idpCertificate?: string;
  isActive: boolean;
}

export interface Project {
  id: UUID;
  organizationId: UUID;
  name: string;
  ownerUserId: UUID;
  costItem?: string;
  type: ProjectType;
}

export interface Subproject {
  id: UUID;
  projectId: UUID;
  organizationId: UUID;
  name: string;
  ownerUserId: UUID;
  costItem?: string;
  type: SubprojectType;
}

export interface WorkTime {
  id: UUID;
  userId: UUID;
  projectId?: UUID | null;
  subprojectId?: UUID | null;
  startTime: string;
  endTime: string;
  comment?: string;
}

export interface StaticData {
  id: UUID;
  entity: string;
  entityUuid?: UUID | null;
  enumName: string;
  values: Record<string, string>;
  translation?: Record<string, unknown>;
}

export type Permission =
  | 'org:admin'
  | 'org:billing'
  | 'members:manage'
  | 'teams:manage'
  | 'sso:configure'
  | 'audit:read'
  | 'data:read'
  | 'data:write'
  | 'projects:manage'
  | 'worktime:approve';

export type AppRole = 'admin' | 'manager' | 'user';

/** RBAC matrix for the three company roles required by the spec. */
export const ROLE_PERMISSIONS: Record<AppRole, Permission[]> = {
  admin: [
    'org:admin',
    'members:manage',
    'teams:manage',
    'sso:configure',
    'audit:read',
    'data:read',
    'data:write',
    'projects:manage',
    'worktime:approve',
  ],
  manager: ['members:manage', 'teams:manage', 'data:read', 'data:write', 'projects:manage'],
  user: ['data:read', 'data:write'],
};

export function can(role: AppRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}
