import { relations } from "drizzle-orm/relations";
import { users, user_identities, organizations, organization_settings, sso_configurations, organization_domains, teams, organization_invitations, roles, organization_memberships, audit_logs, projects, subprojects, work_times, timesheet_periods, member_rates, role_permissions, permissions, role_translations, team_members } from "./schema";

export const user_identitiesRelations = relations(user_identities, ({one}) => ({
	user: one(users, {
		fields: [user_identities.user_id],
		references: [users.id]
	}),
}));

export const usersRelations = relations(users, ({many}) => ({
	user_identities: many(user_identities),
	organizations: many(organizations),
	organization_invitations: many(organization_invitations),
	organization_memberships: many(organization_memberships),
	audit_logs: many(audit_logs),
	projects: many(projects),
	subprojects: many(subprojects),
	work_times: many(work_times),
	timesheet_periods_user_id: many(timesheet_periods, {
		relationName: "timesheet_periods_user_id_users_id"
	}),
	timesheet_periods_reviewed_by_user_id: many(timesheet_periods, {
		relationName: "timesheet_periods_reviewed_by_user_id_users_id"
	}),
	member_rates: many(member_rates),
	team_members: many(team_members),
}));

export const organizationsRelations = relations(organizations, ({one, many}) => ({
	organization: one(organizations, {
		fields: [organizations.parent_organization_id],
		references: [organizations.id],
		relationName: "organizations_parent_organization_id_organizations_id"
	}),
	organizations: many(organizations, {
		relationName: "organizations_parent_organization_id_organizations_id"
	}),
	user: one(users, {
		fields: [organizations.created_by_user_id],
		references: [users.id]
	}),
	organization_settings: many(organization_settings),
	sso_configurations: many(sso_configurations),
	organization_domains: many(organization_domains),
	teams: many(teams),
	organization_invitations: many(organization_invitations),
	organization_memberships: many(organization_memberships),
	audit_logs: many(audit_logs),
	roles: many(roles),
	projects: many(projects),
	subprojects: many(subprojects),
	work_times: many(work_times),
	timesheet_periods: many(timesheet_periods),
	member_rates: many(member_rates),
}));

export const organization_settingsRelations = relations(organization_settings, ({one}) => ({
	organization: one(organizations, {
		fields: [organization_settings.organization_id],
		references: [organizations.id]
	}),
}));

export const sso_configurationsRelations = relations(sso_configurations, ({one}) => ({
	organization: one(organizations, {
		fields: [sso_configurations.organization_id],
		references: [organizations.id]
	}),
}));

export const organization_domainsRelations = relations(organization_domains, ({one}) => ({
	organization: one(organizations, {
		fields: [organization_domains.organization_id],
		references: [organizations.id]
	}),
}));

export const teamsRelations = relations(teams, ({one, many}) => ({
	organization: one(organizations, {
		fields: [teams.organization_id],
		references: [organizations.id]
	}),
	team_members: many(team_members),
}));

export const organization_invitationsRelations = relations(organization_invitations, ({one}) => ({
	organization: one(organizations, {
		fields: [organization_invitations.organization_id],
		references: [organizations.id]
	}),
	role: one(roles, {
		fields: [organization_invitations.role_id],
		references: [roles.id]
	}),
	user: one(users, {
		fields: [organization_invitations.invited_by_user_id],
		references: [users.id]
	}),
}));

export const rolesRelations = relations(roles, ({one, many}) => ({
	organization_invitations: many(organization_invitations),
	organization_memberships: many(organization_memberships),
	organization: one(organizations, {
		fields: [roles.organization_id],
		references: [organizations.id]
	}),
	role_permissions: many(role_permissions),
	role_translations: many(role_translations),
	team_members: many(team_members),
}));

export const organization_membershipsRelations = relations(organization_memberships, ({one, many}) => ({
	organization: one(organizations, {
		fields: [organization_memberships.organization_id],
		references: [organizations.id]
	}),
	user: one(users, {
		fields: [organization_memberships.user_id],
		references: [users.id]
	}),
	role: one(roles, {
		fields: [organization_memberships.role_id],
		references: [roles.id]
	}),
	team_members: many(team_members),
}));

export const audit_logsRelations = relations(audit_logs, ({one}) => ({
	organization: one(organizations, {
		fields: [audit_logs.organization_id],
		references: [organizations.id]
	}),
	user: one(users, {
		fields: [audit_logs.actor_user_id],
		references: [users.id]
	}),
}));

export const projectsRelations = relations(projects, ({one, many}) => ({
	organization: one(organizations, {
		fields: [projects.organization_id],
		references: [organizations.id]
	}),
	user: one(users, {
		fields: [projects.owner_user_id],
		references: [users.id]
	}),
	subprojects: many(subprojects),
	work_times: many(work_times),
}));

export const subprojectsRelations = relations(subprojects, ({one, many}) => ({
	project: one(projects, {
		fields: [subprojects.project_id],
		references: [projects.id]
	}),
	organization: one(organizations, {
		fields: [subprojects.organization_id],
		references: [organizations.id]
	}),
	user: one(users, {
		fields: [subprojects.owner_user_id],
		references: [users.id]
	}),
	work_times: many(work_times),
}));

export const work_timesRelations = relations(work_times, ({one}) => ({
	user: one(users, {
		fields: [work_times.user_id],
		references: [users.id]
	}),
	organization: one(organizations, {
		fields: [work_times.organization_id],
		references: [organizations.id]
	}),
	project: one(projects, {
		fields: [work_times.project_id],
		references: [projects.id]
	}),
	subproject: one(subprojects, {
		fields: [work_times.subproject_id],
		references: [subprojects.id]
	}),
}));

export const timesheet_periodsRelations = relations(timesheet_periods, ({one}) => ({
	organization: one(organizations, {
		fields: [timesheet_periods.organization_id],
		references: [organizations.id]
	}),
	user_user_id: one(users, {
		fields: [timesheet_periods.user_id],
		references: [users.id],
		relationName: "timesheet_periods_user_id_users_id"
	}),
	user_reviewed_by_user_id: one(users, {
		fields: [timesheet_periods.reviewed_by_user_id],
		references: [users.id],
		relationName: "timesheet_periods_reviewed_by_user_id_users_id"
	}),
}));

export const member_ratesRelations = relations(member_rates, ({one}) => ({
	organization: one(organizations, {
		fields: [member_rates.organization_id],
		references: [organizations.id]
	}),
	user: one(users, {
		fields: [member_rates.user_id],
		references: [users.id]
	}),
}));

export const role_permissionsRelations = relations(role_permissions, ({one}) => ({
	role: one(roles, {
		fields: [role_permissions.role_id],
		references: [roles.id]
	}),
	permission: one(permissions, {
		fields: [role_permissions.permission_id],
		references: [permissions.id]
	}),
}));

export const permissionsRelations = relations(permissions, ({many}) => ({
	role_permissions: many(role_permissions),
}));

export const role_translationsRelations = relations(role_translations, ({one}) => ({
	role: one(roles, {
		fields: [role_translations.role_id],
		references: [roles.id]
	}),
}));

export const team_membersRelations = relations(team_members, ({one}) => ({
	team: one(teams, {
		fields: [team_members.team_id],
		references: [teams.id]
	}),
	organization_membership: one(organization_memberships, {
		fields: [team_members.membership_id],
		references: [organization_memberships.id]
	}),
	user: one(users, {
		fields: [team_members.manager_user_id],
		references: [users.id]
	}),
	role: one(roles, {
		fields: [team_members.team_role_id],
		references: [roles.id]
	}),
}));