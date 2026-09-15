import { relations } from "drizzle-orm/relations";
import { users, user_identities, organizations, organization_domains, organization_invitations, roles, audit_logs, projects, subprojects, work_times, static_data, timesheet_periods, teams, expense_reports, expense_report_items, expenses, organization_memberships, versions, workflow_definitions, workflows, role_permissions, permissions, team_members, membership_roles } from "./schema";

export const user_identitiesRelations = relations(user_identities, ({one}) => ({
	user: one(users, {
		fields: [user_identities.user_id],
		references: [users.id]
	}),
}));

export const usersRelations = relations(users, ({many}) => ({
	user_identities: many(user_identities),
	organization_invitations: many(organization_invitations),
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
	teams: many(teams),
	expense_reports_user_id: many(expense_reports, {
		relationName: "expense_reports_user_id_users_id"
	}),
	expense_reports_reviewed_by_user_id: many(expense_reports, {
		relationName: "expense_reports_reviewed_by_user_id_users_id"
	}),
	expenses: many(expenses),
	organization_memberships_user_id: many(organization_memberships, {
		relationName: "organization_memberships_user_id_users_id"
	}),
	organization_memberships_manager_user_id: many(organization_memberships, {
		relationName: "organization_memberships_manager_user_id_users_id"
	}),
	organizations: many(organizations),
	versions_created_by_user_id: many(versions, {
		relationName: "versions_created_by_user_id_users_id"
	}),
	versions_lastmodified_by_user_id: many(versions, {
		relationName: "versions_lastmodified_by_user_id_users_id"
	}),
	membership_roles: many(membership_roles),
}));

export const organization_domainsRelations = relations(organization_domains, ({one}) => ({
	organization: one(organizations, {
		fields: [organization_domains.organization_id],
		references: [organizations.id]
	}),
}));

export const organizationsRelations = relations(organizations, ({one, many}) => ({
	organization_domains: many(organization_domains),
	organization_invitations: many(organization_invitations),
	audit_logs: many(audit_logs),
	roles: many(roles),
	projects: many(projects),
	subprojects: many(subprojects),
	work_times: many(work_times),
	static_data: many(static_data),
	timesheet_periods: many(timesheet_periods),
	teams: many(teams),
	expense_reports: many(expense_reports),
	expense_report_items: many(expense_report_items),
	expenses: many(expenses),
	organization_memberships: many(organization_memberships),
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
	workflow_definitions: many(workflow_definitions),
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
	organization: one(organizations, {
		fields: [roles.organization_id],
		references: [organizations.id]
	}),
	role_permissions: many(role_permissions),
	team_members: many(team_members),
	membership_roles: many(membership_roles),
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
	expenses: many(expenses),
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
	expenses: many(expenses),
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

export const static_dataRelations = relations(static_data, ({one}) => ({
	organization: one(organizations, {
		fields: [static_data.organization_id],
		references: [organizations.id]
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

export const teamsRelations = relations(teams, ({one, many}) => ({
	organization: one(organizations, {
		fields: [teams.organization_id],
		references: [organizations.id]
	}),
	user: one(users, {
		fields: [teams.lead_user_id],
		references: [users.id]
	}),
	workflows: many(workflows),
	team_members: many(team_members),
}));

export const expense_reportsRelations = relations(expense_reports, ({one, many}) => ({
	organization: one(organizations, {
		fields: [expense_reports.organization_id],
		references: [organizations.id]
	}),
	user_user_id: one(users, {
		fields: [expense_reports.user_id],
		references: [users.id],
		relationName: "expense_reports_user_id_users_id"
	}),
	user_reviewed_by_user_id: one(users, {
		fields: [expense_reports.reviewed_by_user_id],
		references: [users.id],
		relationName: "expense_reports_reviewed_by_user_id_users_id"
	}),
	expense_report_items: many(expense_report_items),
}));

export const expense_report_itemsRelations = relations(expense_report_items, ({one}) => ({
	expense_report: one(expense_reports, {
		fields: [expense_report_items.expense_report_id],
		references: [expense_reports.id]
	}),
	expense: one(expenses, {
		fields: [expense_report_items.expense_id],
		references: [expenses.id]
	}),
	organization: one(organizations, {
		fields: [expense_report_items.organization_id],
		references: [organizations.id]
	}),
}));

export const expensesRelations = relations(expenses, ({one, many}) => ({
	expense_report_items: many(expense_report_items),
	user: one(users, {
		fields: [expenses.user_id],
		references: [users.id]
	}),
	organization: one(organizations, {
		fields: [expenses.organization_id],
		references: [organizations.id]
	}),
	project: one(projects, {
		fields: [expenses.project_id],
		references: [projects.id]
	}),
	subproject: one(subprojects, {
		fields: [expenses.subproject_id],
		references: [subprojects.id]
	}),
}));

export const organization_membershipsRelations = relations(organization_memberships, ({one, many}) => ({
	organization: one(organizations, {
		fields: [organization_memberships.organization_id],
		references: [organizations.id]
	}),
	user_user_id: one(users, {
		fields: [organization_memberships.user_id],
		references: [users.id],
		relationName: "organization_memberships_user_id_users_id"
	}),
	user_manager_user_id: one(users, {
		fields: [organization_memberships.manager_user_id],
		references: [users.id],
		relationName: "organization_memberships_manager_user_id_users_id"
	}),
	team_members: many(team_members),
	membership_roles: many(membership_roles),
}));

export const versionsRelations = relations(versions, ({one}) => ({
	user_created_by_user_id: one(users, {
		fields: [versions.created_by_user_id],
		references: [users.id],
		relationName: "versions_created_by_user_id_users_id"
	}),
	user_lastmodified_by_user_id: one(users, {
		fields: [versions.lastmodified_by_user_id],
		references: [users.id],
		relationName: "versions_lastmodified_by_user_id_users_id"
	}),
}));

export const workflowsRelations = relations(workflows, ({one}) => ({
	workflow_definition: one(workflow_definitions, {
		fields: [workflows.workflow_def_id],
		references: [workflow_definitions.workflow_def_id]
	}),
	team: one(teams, {
		fields: [workflows.assigned_to_team_id],
		references: [teams.id]
	}),
}));

export const workflow_definitionsRelations = relations(workflow_definitions, ({one, many}) => ({
	workflows: many(workflows),
	organization: one(organizations, {
		fields: [workflow_definitions.organization_id],
		references: [organizations.id]
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

export const team_membersRelations = relations(team_members, ({one}) => ({
	team: one(teams, {
		fields: [team_members.team_id],
		references: [teams.id]
	}),
	organization_membership: one(organization_memberships, {
		fields: [team_members.membership_id],
		references: [organization_memberships.id]
	}),
	role: one(roles, {
		fields: [team_members.team_role_id],
		references: [roles.id]
	}),
}));

export const membership_rolesRelations = relations(membership_roles, ({one}) => ({
	organization_membership: one(organization_memberships, {
		fields: [membership_roles.membership_id],
		references: [organization_memberships.id]
	}),
	role: one(roles, {
		fields: [membership_roles.role_id],
		references: [roles.id]
	}),
	user: one(users, {
		fields: [membership_roles.granted_by_user_id],
		references: [users.id]
	}),
}));