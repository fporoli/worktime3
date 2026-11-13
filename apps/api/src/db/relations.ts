import { relations } from "drizzle-orm/relations";
import { organizations, departments, users, employee_assignments, user_identities, organization_memberships, organization_domains, roles, organization_invitations, audit_logs, teams, projects, subprojects, project_times, timesheet_periods, workflow_definitions, static_data, versions, expense_reports, workflows, expense_report_items, expenses, documents, notifications, work_times, work_time_balance_entries, absences, basicdata_versions, field_config, work_schedules, org_holidays, balance_adjustments, vacation_entitlements, project_time_periods, work_time_months, role_permissions, permissions, team_members, membership_roles, work_time_balances } from "./schema";

export const departmentsRelations = relations(departments, ({one, many}) => ({
	organization: one(organizations, {
		fields: [departments.organization_id],
		references: [organizations.id]
	}),
	user: one(users, {
		fields: [departments.leader_user_id],
		references: [users.id]
	}),
	employee_assignments: many(employee_assignments),
}));

export const organizationsRelations = relations(organizations, ({one, many}) => ({
	departments: many(departments),
	employee_assignments: many(employee_assignments),
	organization_memberships: many(organization_memberships),
	organization_domains: many(organization_domains),
	roles: many(roles),
	organization_invitations: many(organization_invitations),
	audit_logs: many(audit_logs),
	teams: many(teams),
	projects: many(projects),
	subprojects: many(subprojects),
	project_times: many(project_times),
	timesheet_periods: many(timesheet_periods),
	workflow_definitions: many(workflow_definitions),
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
	static_data: many(static_data),
	expense_reports: many(expense_reports),
	expense_report_items: many(expense_report_items),
	expenses: many(expenses),
	notifications: many(notifications),
	work_times: many(work_times),
	work_time_balance_entries: many(work_time_balance_entries),
	documents: many(documents),
	absences: many(absences),
	field_configs: many(field_config),
	work_schedules: many(work_schedules),
	org_holidays: many(org_holidays),
	balance_adjustments: many(balance_adjustments),
	vacation_entitlements: many(vacation_entitlements),
	project_time_periods: many(project_time_periods),
	work_time_months: many(work_time_months),
	work_time_balances: many(work_time_balances),
}));

export const usersRelations = relations(users, ({many}) => ({
	departments: many(departments),
	employee_assignments_user_id: many(employee_assignments, {
		relationName: "employee_assignments_user_id_users_id"
	}),
	employee_assignments_manager_user_id: many(employee_assignments, {
		relationName: "employee_assignments_manager_user_id_users_id"
	}),
	user_identities: many(user_identities),
	organization_memberships: many(organization_memberships),
	organization_invitations: many(organization_invitations),
	audit_logs: many(audit_logs),
	teams: many(teams),
	projects: many(projects),
	subprojects: many(subprojects),
	project_times: many(project_times),
	timesheet_periods_user_id: many(timesheet_periods, {
		relationName: "timesheet_periods_user_id_users_id"
	}),
	timesheet_periods_reviewed_by_user_id: many(timesheet_periods, {
		relationName: "timesheet_periods_reviewed_by_user_id_users_id"
	}),
	organizations: many(organizations),
	versions_created_by_user_id: many(versions, {
		relationName: "versions_created_by_user_id_users_id"
	}),
	versions_lastmodified_by_user_id: many(versions, {
		relationName: "versions_lastmodified_by_user_id_users_id"
	}),
	expense_reports_user_id: many(expense_reports, {
		relationName: "expense_reports_user_id_users_id"
	}),
	expense_reports_reviewed_by_user_id: many(expense_reports, {
		relationName: "expense_reports_reviewed_by_user_id_users_id"
	}),
	expenses: many(expenses),
	notifications: many(notifications),
	work_times: many(work_times),
	work_time_balance_entries_user_id: many(work_time_balance_entries, {
		relationName: "work_time_balance_entries_user_id_users_id"
	}),
	work_time_balance_entries_created_by_user_id: many(work_time_balance_entries, {
		relationName: "work_time_balance_entries_created_by_user_id_users_id"
	}),
	documents: many(documents),
	absences_user_id: many(absences, {
		relationName: "absences_user_id_users_id"
	}),
	absences_reviewed_by_user_id: many(absences, {
		relationName: "absences_reviewed_by_user_id_users_id"
	}),
	basicdata_versions_user_id: many(basicdata_versions, {
		relationName: "basicdata_versions_user_id_users_id"
	}),
	basicdata_versions_lastmodified_by_user_id: many(basicdata_versions, {
		relationName: "basicdata_versions_lastmodified_by_user_id_users_id"
	}),
	work_schedules: many(work_schedules),
	balance_adjustments_user_id: many(balance_adjustments, {
		relationName: "balance_adjustments_user_id_users_id"
	}),
	balance_adjustments_created_by_user_id: many(balance_adjustments, {
		relationName: "balance_adjustments_created_by_user_id_users_id"
	}),
	vacation_entitlements: many(vacation_entitlements),
	project_time_periods_user_id: many(project_time_periods, {
		relationName: "project_time_periods_user_id_users_id"
	}),
	project_time_periods_reviewed_by_user_id: many(project_time_periods, {
		relationName: "project_time_periods_reviewed_by_user_id_users_id"
	}),
	work_time_months_user_id: many(work_time_months, {
		relationName: "work_time_months_user_id_users_id"
	}),
	work_time_months_closed_by_user_id: many(work_time_months, {
		relationName: "work_time_months_closed_by_user_id_users_id"
	}),
	membership_roles: many(membership_roles),
	work_time_balances: many(work_time_balances),
}));

export const employee_assignmentsRelations = relations(employee_assignments, ({one}) => ({
	organization: one(organizations, {
		fields: [employee_assignments.organization_id],
		references: [organizations.id]
	}),
	user_user_id: one(users, {
		fields: [employee_assignments.user_id],
		references: [users.id],
		relationName: "employee_assignments_user_id_users_id"
	}),
	department: one(departments, {
		fields: [employee_assignments.department_id],
		references: [departments.id]
	}),
	user_manager_user_id: one(users, {
		fields: [employee_assignments.manager_user_id],
		references: [users.id],
		relationName: "employee_assignments_manager_user_id_users_id"
	}),
}));

export const user_identitiesRelations = relations(user_identities, ({one}) => ({
	user: one(users, {
		fields: [user_identities.user_id],
		references: [users.id]
	}),
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
	team_members: many(team_members),
	membership_roles: many(membership_roles),
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
	membership_roles: many(membership_roles),
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
	project_time_periods: many(project_time_periods),
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

export const timesheet_periodsRelations = relations(timesheet_periods, ({one, many}) => ({
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
	work_time_months: many(work_time_months),
}));

export const workflow_definitionsRelations = relations(workflow_definitions, ({one, many}) => ({
	organization: one(organizations, {
		fields: [workflow_definitions.organization_id],
		references: [organizations.id]
	}),
	workflows: many(workflows),
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
	document: one(documents, {
		fields: [expenses.document_id],
		references: [documents.id]
	}),
}));

export const documentsRelations = relations(documents, ({one, many}) => ({
	expenses: many(expenses),
	organization: one(organizations, {
		fields: [documents.organization_id],
		references: [organizations.id]
	}),
	user: one(users, {
		fields: [documents.uploaded_by_user_id],
		references: [users.id]
	}),
	absences: many(absences),
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

export const work_time_balance_entriesRelations = relations(work_time_balance_entries, ({one}) => ({
	organization: one(organizations, {
		fields: [work_time_balance_entries.organization_id],
		references: [organizations.id]
	}),
	user_user_id: one(users, {
		fields: [work_time_balance_entries.user_id],
		references: [users.id],
		relationName: "work_time_balance_entries_user_id_users_id"
	}),
	user_created_by_user_id: one(users, {
		fields: [work_time_balance_entries.created_by_user_id],
		references: [users.id],
		relationName: "work_time_balance_entries_created_by_user_id_users_id"
	}),
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

export const field_configRelations = relations(field_config, ({one}) => ({
	organization: one(organizations, {
		fields: [field_config.organization_id],
		references: [organizations.id]
	}),
}));

export const work_schedulesRelations = relations(work_schedules, ({one}) => ({
	organization: one(organizations, {
		fields: [work_schedules.organization_id],
		references: [organizations.id]
	}),
	user: one(users, {
		fields: [work_schedules.user_id],
		references: [users.id]
	}),
}));

export const org_holidaysRelations = relations(org_holidays, ({one}) => ({
	organization: one(organizations, {
		fields: [org_holidays.organization_id],
		references: [organizations.id]
	}),
}));

export const balance_adjustmentsRelations = relations(balance_adjustments, ({one}) => ({
	organization: one(organizations, {
		fields: [balance_adjustments.organization_id],
		references: [organizations.id]
	}),
	user_user_id: one(users, {
		fields: [balance_adjustments.user_id],
		references: [users.id],
		relationName: "balance_adjustments_user_id_users_id"
	}),
	user_created_by_user_id: one(users, {
		fields: [balance_adjustments.created_by_user_id],
		references: [users.id],
		relationName: "balance_adjustments_created_by_user_id_users_id"
	}),
}));

export const vacation_entitlementsRelations = relations(vacation_entitlements, ({one}) => ({
	organization: one(organizations, {
		fields: [vacation_entitlements.organization_id],
		references: [organizations.id]
	}),
	user: one(users, {
		fields: [vacation_entitlements.user_id],
		references: [users.id]
	}),
}));

export const project_time_periodsRelations = relations(project_time_periods, ({one}) => ({
	organization: one(organizations, {
		fields: [project_time_periods.organization_id],
		references: [organizations.id]
	}),
	user_user_id: one(users, {
		fields: [project_time_periods.user_id],
		references: [users.id],
		relationName: "project_time_periods_user_id_users_id"
	}),
	project: one(projects, {
		fields: [project_time_periods.project_id],
		references: [projects.id]
	}),
	user_reviewed_by_user_id: one(users, {
		fields: [project_time_periods.reviewed_by_user_id],
		references: [users.id],
		relationName: "project_time_periods_reviewed_by_user_id_users_id"
	}),
}));

export const work_time_monthsRelations = relations(work_time_months, ({one}) => ({
	organization: one(organizations, {
		fields: [work_time_months.organization_id],
		references: [organizations.id]
	}),
	user_user_id: one(users, {
		fields: [work_time_months.user_id],
		references: [users.id],
		relationName: "work_time_months_user_id_users_id"
	}),
	timesheet_period: one(timesheet_periods, {
		fields: [work_time_months.timesheet_period_id],
		references: [timesheet_periods.id]
	}),
	user_closed_by_user_id: one(users, {
		fields: [work_time_months.closed_by_user_id],
		references: [users.id],
		relationName: "work_time_months_closed_by_user_id_users_id"
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