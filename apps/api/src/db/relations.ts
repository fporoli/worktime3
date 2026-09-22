import { relations } from "drizzle-orm/relations";
import { organizations, users, user_identities, absences, documents, work_times, organization_domains, roles, organization_memberships, teams, organization_invitations, audit_logs, work_time_balance_entries, projects, subprojects, timesheet_periods, project_times, static_data, versions, workflow_definitions, basicdata_versions, expenses, expense_reports, expense_report_items, workflows, notifications, role_permissions, permissions, team_members, work_time_balances } from "./schema";

export const organizationsRelations = relations(organizations, ({one, many}) => ({
	organization: one(organizations, {
		fields: [organizations.parent_organization_id],
		references: [organizations.id],
		relationName: "organizations_parent_organization_id_organizations_id"
	}),
	organizations: many(organizations, {
		relationName: "organizations_parent_organization_id_organizations_id"
	}),
	absences: many(absences),
	work_times: many(work_times),
	organization_domains: many(organization_domains),
	roles: many(roles),
	organization_memberships: many(organization_memberships),
	teams: many(teams),
	organization_invitations: many(organization_invitations),
	audit_logs: many(audit_logs),
	work_time_balance_entries: many(work_time_balance_entries),
	projects: many(projects),
	subprojects: many(subprojects),
	timesheet_periods: many(timesheet_periods),
	project_times: many(project_times),
	documents: many(documents),
	static_data: many(static_data),
	workflow_definitions: many(workflow_definitions),
	expenses: many(expenses),
	expense_report_items: many(expense_report_items),
	notifications: many(notifications),
	expense_reports: many(expense_reports),
	work_time_balances: many(work_time_balances),
}));

export const user_identitiesRelations = relations(user_identities, ({one}) => ({
	user: one(users, {
		fields: [user_identities.user_id],
		references: [users.id]
	}),
}));

export const usersRelations = relations(users, ({many}) => ({
	user_identities: many(user_identities),
	absences_user_id: many(absences, {
		relationName: "absences_user_id_users_id"
	}),
	absences_reviewed_by_user_id: many(absences, {
		relationName: "absences_reviewed_by_user_id_users_id"
	}),
	work_times: many(work_times),
	organization_memberships_user_id: many(organization_memberships, {
		relationName: "organization_memberships_user_id_users_id"
	}),
	organization_memberships_manager_user_id: many(organization_memberships, {
		relationName: "organization_memberships_manager_user_id_users_id"
	}),
	teams: many(teams),
	organization_invitations: many(organization_invitations),
	audit_logs: many(audit_logs),
	work_time_balance_entries: many(work_time_balance_entries),
	projects: many(projects),
	subprojects: many(subprojects),
	timesheet_periods_user_id: many(timesheet_periods, {
		relationName: "timesheet_periods_user_id_users_id"
	}),
	timesheet_periods_reviewed_by_user_id: many(timesheet_periods, {
		relationName: "timesheet_periods_reviewed_by_user_id_users_id"
	}),
	project_times: many(project_times),
	documents: many(documents),
	versions_created_by_user_id: many(versions, {
		relationName: "versions_created_by_user_id_users_id"
	}),
	versions_lastmodified_by_user_id: many(versions, {
		relationName: "versions_lastmodified_by_user_id_users_id"
	}),
	basicdata_versions_user_id: many(basicdata_versions, {
		relationName: "basicdata_versions_user_id_users_id"
	}),
	basicdata_versions_lastmodified_by_user_id: many(basicdata_versions, {
		relationName: "basicdata_versions_lastmodified_by_user_id_users_id"
	}),
	expenses: many(expenses),
	notifications: many(notifications),
	expense_reports_user_id: many(expense_reports, {
		relationName: "expense_reports_user_id_users_id"
	}),
	expense_reports_reviewed_by_user_id: many(expense_reports, {
		relationName: "expense_reports_reviewed_by_user_id_users_id"
	}),
	work_time_balances: many(work_time_balances),
}));

export const absencesRelations = relations(absences, ({one}) => ({
	organization: one(organizations, {
		fields: [absences.organization_id],
		references: [organizations.id]
	}),
	user_user_id: one(users, {
		fields: [absences.user_id],
		references: [users.id],
		relationName: "absences_user_id_users_id"
	}),
	user_reviewed_by_user_id: one(users, {
		fields: [absences.reviewed_by_user_id],
		references: [users.id],
		relationName: "absences_reviewed_by_user_id_users_id"
	}),
	document: one(documents, {
		fields: [absences.document_id],
		references: [documents.id]
	}),
}));

export const documentsRelations = relations(documents, ({one, many}) => ({
	absences: many(absences),
	organization: one(organizations, {
		fields: [documents.organization_id],
		references: [organizations.id]
	}),
	user: one(users, {
		fields: [documents.uploaded_by_user_id],
		references: [users.id]
	}),
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
}));

export const organization_domainsRelations = relations(organization_domains, ({one}) => ({
	organization: one(organizations, {
		fields: [organization_domains.organization_id],
		references: [organizations.id]
	}),
}));

export const rolesRelations = relations(roles, ({one, many}) => ({
	organization: one(organizations, {
		fields: [roles.organization_id],
		references: [organizations.id]
	}),
	organization_invitations: many(organization_invitations),
	role_permissions: many(role_permissions),
	team_members: many(team_members),
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

export const work_time_balance_entriesRelations = relations(work_time_balance_entries, ({one}) => ({
	organization: one(organizations, {
		fields: [work_time_balance_entries.organization_id],
		references: [organizations.id]
	}),
	user: one(users, {
		fields: [work_time_balance_entries.user_id],
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
	project_times: many(project_times),
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
	project_times: many(project_times),
	expenses: many(expenses),
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

export const project_timesRelations = relations(project_times, ({one}) => ({
	user: one(users, {
		fields: [project_times.user_id],
		references: [users.id]
	}),
	organization: one(organizations, {
		fields: [project_times.organization_id],
		references: [organizations.id]
	}),
	project: one(projects, {
		fields: [project_times.project_id],
		references: [projects.id]
	}),
	subproject: one(subprojects, {
		fields: [project_times.subproject_id],
		references: [subprojects.id]
	}),
}));

export const static_dataRelations = relations(static_data, ({one}) => ({
	organization: one(organizations, {
		fields: [static_data.organization_id],
		references: [organizations.id]
	}),
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

export const workflow_definitionsRelations = relations(workflow_definitions, ({one, many}) => ({
	organization: one(organizations, {
		fields: [workflow_definitions.organization_id],
		references: [organizations.id]
	}),
	workflows: many(workflows),
}));

export const basicdata_versionsRelations = relations(basicdata_versions, ({one}) => ({
	user_user_id: one(users, {
		fields: [basicdata_versions.user_id],
		references: [users.id],
		relationName: "basicdata_versions_user_id_users_id"
	}),
	user_lastmodified_by_user_id: one(users, {
		fields: [basicdata_versions.lastmodified_by_user_id],
		references: [users.id],
		relationName: "basicdata_versions_lastmodified_by_user_id_users_id"
	}),
}));

export const expensesRelations = relations(expenses, ({one, many}) => ({
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
	document: one(documents, {
		fields: [expenses.document_id],
		references: [documents.id]
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

export const expense_reportsRelations = relations(expense_reports, ({one, many}) => ({
	expense_report_items: many(expense_report_items),
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
}));

export const workflowsRelations = relations(workflows, ({one, many}) => ({
	workflow_definition: one(workflow_definitions, {
		fields: [workflows.workflow_def_id],
		references: [workflow_definitions.workflow_def_id]
	}),
	team: one(teams, {
		fields: [workflows.assigned_to_team_id],
		references: [teams.id]
	}),
	notifications: many(notifications),
}));

export const notificationsRelations = relations(notifications, ({one}) => ({
	organization: one(organizations, {
		fields: [notifications.organization_id],
		references: [organizations.id]
	}),
	user: one(users, {
		fields: [notifications.recipient_user_id],
		references: [users.id]
	}),
	workflow: one(workflows, {
		fields: [notifications.workflow_id],
		references: [workflows.workflow_id]
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

export const work_time_balancesRelations = relations(work_time_balances, ({one}) => ({
	organization: one(organizations, {
		fields: [work_time_balances.organization_id],
		references: [organizations.id]
	}),
	user: one(users, {
		fields: [work_time_balances.user_id],
		references: [users.id]
	}),
}));