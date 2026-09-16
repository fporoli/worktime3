import { pgTable, index, foreignKey, unique, uuid, varchar, jsonb, timestamp, boolean, integer, check, text, uniqueIndex, date, inet, numeric, char, primaryKey, pgView, pgEnum, customType } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

const citext = customType<{ data: string }>({
  dataType() {
    return 'citext';
  },
});

export const auth_provider_type = pgEnum("auth_provider_type", ['password', 'google', 'apple', 'github', 'saml_sso', 'oidc', 'passkey'])
export const invitation_status = pgEnum("invitation_status", ['pending', 'accepted', 'revoked', 'expired'])
export const membership_status = pgEnum("membership_status", ['active', 'invited', 'suspended'])
export const organization_type = pgEnum("organization_type", ['personal', 'team', 'enterprise'])
export const project_type = pgEnum("project_type", ['internal', 'customer', 'research'])
export const subproject_type = pgEnum("subproject_type", ['phase', 'work_package', 'task'])
export const timesheet_status = pgEnum("timesheet_status", ['open', 'submitted', 'approved', 'rejected'])
export const user_status = pgEnum("user_status", ['active', 'suspended', 'deactivated'])


export const user_identities = pgTable("user_identities", {
	id: uuid().default(sql`uuid_generate_v4()`).primaryKey().notNull(),
	user_id: uuid().notNull(),
	provider: auth_provider_type().notNull(),
	provider_user_id: varchar({ length: 255 }).notNull(),
	password_hash: varchar({ length: 255 }),
	metadata: jsonb().default({}).notNull(),
	last_sign_in_at: timestamp({ withTimezone: true, mode: 'string' }),
}, (table) => [
	index("idx_user_identities_user_id").using("btree", table.user_id.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.user_id],
			foreignColumns: [users.id],
			name: "user_identities_user_id_fkey"
		}).onDelete("cascade"),
	unique("uq_provider_user_id").on(table.provider, table.provider_user_id),
]);

export const organization_domains = pgTable("organization_domains", {
	id: uuid().default(sql`uuid_generate_v4()`).primaryKey().notNull(),
	organization_id: uuid().notNull(),
	domain: citext("domain").notNull(),
	verification_token: varchar({ length: 255 }).notNull(),
	verified_at: timestamp({ withTimezone: true, mode: 'string' }),
	auto_join_enabled: boolean().default(false).notNull(),
}, (table) => [
	index("idx_org_domains_domain").using("btree", table.domain.asc().nullsLast().op("citext_ops")),
	foreignKey({
			columns: [table.organization_id],
			foreignColumns: [organizations.id],
			name: "organization_domains_organization_id_fkey"
		}).onDelete("cascade"),
	unique("uq_org_domain").on(table.domain),
]);

export const permissions = pgTable("permissions", {
	id: varchar({ length: 64 }).primaryKey().notNull(),
	description: varchar({ length: 255 }).notNull(),
});

export const users = pgTable("users", {
	id: uuid().default(sql`uuid_generate_v4()`).primaryKey().notNull(),
	email: citext("email").notNull(),
	email_verified_at: timestamp({ withTimezone: true, mode: 'string' }),
	display_name: varchar({ length: 100 }).notNull(),
	avatar_url: varchar({ length: 1024 }),
	locale: varchar({ length: 10 }).default('en').notNull(),
	timezone: varchar({ length: 50 }).default('UTC').notNull(),
	status: user_status().default('active').notNull(),
	first_name: varchar({ length: 100 }),
	middle_name: varchar({ length: 100 }),
	last_name: varchar({ length: 100 }),
	settings: jsonb().default({}).notNull(),
	is_active: boolean().default(true).notNull(),
}, (table) => [
	unique("users_email_key").on(table.email),
]);

export const organization_invitations = pgTable("organization_invitations", {
	id: uuid().default(sql`uuid_generate_v4()`).primaryKey().notNull(),
	organization_id: uuid().notNull(),
	email: citext("email").notNull(),
	role_id: uuid().notNull(),
	token: varchar({ length: 255 }).notNull(),
	invited_by_user_id: uuid().notNull(),
	status: invitation_status().default('pending').notNull(),
	expires_at: timestamp({ withTimezone: true, mode: 'string' }).notNull(),
}, (table) => [
	index("idx_invitations_email").using("btree", table.email.asc().nullsLast().op("citext_ops")),
	index("idx_invitations_token").using("btree", table.token.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.organization_id],
			foreignColumns: [organizations.id],
			name: "organization_invitations_organization_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.role_id],
			foreignColumns: [roles.id],
			name: "organization_invitations_role_id_fkey"
		}),
	foreignKey({
			columns: [table.invited_by_user_id],
			foreignColumns: [users.id],
			name: "organization_invitations_invited_by_user_id_fkey"
		}),
	unique("organization_invitations_token_key").on(table.token),
]);

export const databasechangeloglock = pgTable("databasechangeloglock", {
	id: integer().primaryKey().notNull(),
	locked: boolean().notNull(),
	lockgranted: timestamp({ mode: 'string' }),
	lockedby: varchar({ length: 255 }),
});

export const audit_logs = pgTable("audit_logs", {
	id: uuid().default(sql`uuid_generate_v4()`).primaryKey().notNull(),
	organization_id: uuid().notNull(),
	actor_user_id: uuid(),
	action: varchar({ length: 128 }).notNull(),
	target_type: varchar({ length: 64 }).notNull(),
	target_id: varchar({ length: 255 }).notNull(),
	metadata: jsonb().default({}).notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_audit_logs_actor").using("btree", table.actor_user_id.asc().nullsLast().op("uuid_ops")),
	index("idx_audit_logs_org_date").using("btree", table.organization_id.asc().nullsLast().op("timestamptz_ops"), table.created_at.desc().nullsFirst().op("timestamptz_ops")),
	foreignKey({
			columns: [table.organization_id],
			foreignColumns: [organizations.id],
			name: "audit_logs_organization_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.actor_user_id],
			foreignColumns: [users.id],
			name: "audit_logs_actor_user_id_fkey"
		}).onDelete("set null"),
]);

export const roles = pgTable("roles", {
	id: uuid().default(sql`uuid_generate_v4()`).primaryKey().notNull(),
	organization_id: uuid(),
	name: varchar({ length: 64 }).notNull(),
	description: varchar({ length: 255 }),
	is_system_role: boolean().default(false).notNull(),
	settings: jsonb().default({}).notNull(),
	translations: jsonb().default({}).notNull(),
	admin_user_ids: uuid().array().default([""]).notNull(),
}, (table) => [
	foreignKey({
			columns: [table.organization_id],
			foreignColumns: [organizations.id],
			name: "roles_organization_id_fkey"
		}).onDelete("cascade"),
	unique("uq_role_per_org").on(table.organization_id, table.name),
]);

export const projects = pgTable("projects", {
	id: uuid().default(sql`uuid_generate_v4()`).primaryKey().notNull(),
	organization_id: uuid().notNull(),
	name: varchar({ length: 255 }).notNull(),
	owner_user_id: uuid(),
	cost_item: varchar({ length: 255 }),
	type: project_type().default('internal').notNull(),
}, (table) => [
	index("idx_projects_org").using("btree", table.organization_id.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.organization_id],
			foreignColumns: [organizations.id],
			name: "projects_organization_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.owner_user_id],
			foreignColumns: [users.id],
			name: "projects_owner_user_id_fkey"
		}).onDelete("set null"),
]);

export const subprojects = pgTable("subprojects", {
	id: uuid().default(sql`uuid_generate_v4()`).primaryKey().notNull(),
	project_id: uuid().notNull(),
	organization_id: uuid().notNull(),
	name: varchar({ length: 255 }).notNull(),
	owner_user_id: uuid(),
	cost_item: varchar({ length: 255 }),
	type: subproject_type().default('phase').notNull(),
}, (table) => [
	index("idx_subprojects_org").using("btree", table.organization_id.asc().nullsLast().op("uuid_ops")),
	index("idx_subprojects_project").using("btree", table.project_id.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.project_id],
			foreignColumns: [projects.id],
			name: "subprojects_project_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.organization_id],
			foreignColumns: [organizations.id],
			name: "subprojects_organization_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.owner_user_id],
			foreignColumns: [users.id],
			name: "subprojects_owner_user_id_fkey"
		}).onDelete("set null"),
]);

export const work_times = pgTable("work_times", {
	id: uuid().default(sql`uuid_generate_v4()`).primaryKey().notNull(),
	user_id: uuid().notNull(),
	organization_id: uuid().notNull(),
	project_id: uuid(),
	subproject_id: uuid(),
	start_time: timestamp({ withTimezone: true, mode: 'string' }).notNull(),
	end_time: timestamp({ withTimezone: true, mode: 'string' }).notNull(),
	comment: text(),
}, (table) => [
	index("idx_worktimes_org_start").using("btree", table.organization_id.asc().nullsLast().op("timestamptz_ops"), table.start_time.asc().nullsLast().op("uuid_ops")),
	index("idx_worktimes_project").using("btree", table.project_id.asc().nullsLast().op("uuid_ops")),
	index("idx_worktimes_user_start").using("btree", table.user_id.asc().nullsLast().op("uuid_ops"), table.start_time.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.user_id],
			foreignColumns: [users.id],
			name: "work_times_user_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.organization_id],
			foreignColumns: [organizations.id],
			name: "work_times_organization_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.project_id],
			foreignColumns: [projects.id],
			name: "work_times_project_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.subproject_id],
			foreignColumns: [subprojects.id],
			name: "work_times_subproject_id_fkey"
		}).onDelete("set null"),
	check("chk_worktime_order", sql`end_time > start_time`),
]);

export const static_data = pgTable("static_data", {
	id: uuid().default(sql`uuid_generate_v4()`).primaryKey().notNull(),
	entity: varchar({ length: 128 }).notNull(),
	entity_uuid: uuid(),
	enum_name: varchar({ length: 128 }).notNull(),
	values: jsonb().default({}).notNull(),
	translation: jsonb().default({}).notNull(),
	organization_id: uuid().notNull(),
}, (table) => [
	index("idx_static_data_org_entity").using("btree", table.organization_id.asc().nullsLast().op("text_ops"), table.entity.asc().nullsLast().op("uuid_ops"), table.enum_name.asc().nullsLast().op("uuid_ops")),
	uniqueIndex("uq_static_data_org_entity_enum").using("btree", table.organization_id.asc().nullsLast().op("uuid_ops"), table.entity.asc().nullsLast().op("uuid_ops"), table.enum_name.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.organization_id],
			foreignColumns: [organizations.id],
			name: "static_data_organization_id_fkey"
		}).onDelete("cascade"),
]);

export const databasechangelog = pgTable("databasechangelog", {
	id: varchar({ length: 255 }).notNull(),
	author: varchar({ length: 255 }).notNull(),
	filename: varchar({ length: 255 }).notNull(),
	dateexecuted: timestamp({ mode: 'string' }).notNull(),
	orderexecuted: integer().notNull(),
	exectype: varchar({ length: 10 }).notNull(),
	md5sum: varchar({ length: 35 }),
	description: varchar({ length: 255 }),
	comments: varchar({ length: 255 }),
	tag: varchar({ length: 255 }),
	liquibase: varchar({ length: 20 }),
	contexts: varchar({ length: 255 }),
	labels: varchar({ length: 255 }),
	deployment_id: varchar({ length: 10 }),
});

export const timesheet_periods = pgTable("timesheet_periods", {
	id: uuid().default(sql`uuid_generate_v4()`).primaryKey().notNull(),
	organization_id: uuid().notNull(),
	user_id: uuid().notNull(),
	period_start: date().notNull(),
	period_end: date().notNull(),
	status: timesheet_status().default('open').notNull(),
	submitted_at: timestamp({ withTimezone: true, mode: 'string' }),
	reviewed_by_user_id: uuid(),
	reviewed_at: timestamp({ withTimezone: true, mode: 'string' }),
	review_note: text(),
}, (table) => [
	index("idx_timesheet_periods_org_status").using("btree", table.organization_id.asc().nullsLast().op("uuid_ops"), table.status.asc().nullsLast().op("enum_ops")),
	index("idx_timesheet_periods_user").using("btree", table.user_id.asc().nullsLast().op("uuid_ops"), table.period_start.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.organization_id],
			foreignColumns: [organizations.id],
			name: "timesheet_periods_organization_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.user_id],
			foreignColumns: [users.id],
			name: "timesheet_periods_user_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.reviewed_by_user_id],
			foreignColumns: [users.id],
			name: "timesheet_periods_reviewed_by_user_id_fkey"
		}).onDelete("set null"),
	unique("uq_timesheet_period").on(table.organization_id, table.user_id, table.period_start),
	check("chk_timesheet_period_order", sql`period_end > period_start`),
]);

export const teams = pgTable("teams", {
	id: uuid().default(sql`uuid_generate_v4()`).primaryKey().notNull(),
	organization_id: uuid().notNull(),
	name: varchar({ length: 100 }).notNull(),
	description: varchar({ length: 255 }),
	lead_user_id: uuid(),
}, (table) => [
	foreignKey({
			columns: [table.organization_id],
			foreignColumns: [organizations.id],
			name: "teams_organization_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.lead_user_id],
			foreignColumns: [users.id],
			name: "teams_lead_user_id_fkey"
		}).onDelete("set null"),
	unique("uq_org_team_name").on(table.organization_id, table.name),
]);

export const expense_reports = pgTable("expense_reports", {
	id: uuid().default(sql`uuid_generate_v4()`).primaryKey().notNull(),
	organization_id: uuid().notNull(),
	user_id: uuid().notNull(),
	status: text().default('in_preparation').notNull(),
	date_submitted: timestamp({ withTimezone: true, mode: 'string' }),
	reviewed_by_user_id: uuid(),
	reviewed_at: timestamp({ withTimezone: true, mode: 'string' }),
	review_note: text(),
	data: jsonb().default({}).notNull(),
}, (table) => [
	index("idx_expense_reports_org_status").using("btree", table.organization_id.asc().nullsLast().op("uuid_ops"), table.status.asc().nullsLast().op("uuid_ops")),
	index("idx_expense_reports_user").using("btree", table.user_id.asc().nullsLast().op("timestamptz_ops"), table.date_submitted.asc().nullsLast().op("timestamptz_ops")),
	foreignKey({
			columns: [table.organization_id],
			foreignColumns: [organizations.id],
			name: "expense_reports_organization_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.user_id],
			foreignColumns: [users.id],
			name: "expense_reports_user_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.reviewed_by_user_id],
			foreignColumns: [users.id],
			name: "expense_reports_reviewed_by_user_id_fkey"
		}).onDelete("set null"),
	check("chk_expense_reports_status", sql`status = ANY (ARRAY['in_preparation'::text, 'submitted'::text, 'approved'::text, 'rejected'::text, 'submitted_processing'::text, 'processing_finished'::text, 'request_payment'::text, 'finished'::text])`),
]);

export const expense_report_items = pgTable("expense_report_items", {
	id: uuid().default(sql`uuid_generate_v4()`).primaryKey().notNull(),
	expense_report_id: uuid().notNull(),
	expense_id: uuid().notNull(),
	organization_id: uuid().notNull(),
}, (table) => [
	index("idx_expense_report_items_org").using("btree", table.organization_id.asc().nullsLast().op("uuid_ops")),
	index("idx_expense_report_items_report").using("btree", table.expense_report_id.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.expense_report_id],
			foreignColumns: [expense_reports.id],
			name: "expense_report_items_expense_report_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.expense_id],
			foreignColumns: [expenses.id],
			name: "expense_report_items_expense_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.organization_id],
			foreignColumns: [organizations.id],
			name: "expense_report_items_organization_id_fkey"
		}).onDelete("cascade"),
	unique("uq_expense_report_items_expense").on(table.expense_id),
]);

export const organization_memberships = pgTable("organization_memberships", {
	id: uuid().default(sql`uuid_generate_v4()`).primaryKey().notNull(),
	organization_id: uuid().notNull(),
	user_id: uuid().notNull(),
	status: membership_status().default('active').notNull(),
	scim_external_id: varchar({ length: 255 }),
	joined_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow(),
	is_active: boolean().default(true).notNull(),
	manager_user_id: uuid(),
	settings: jsonb().default({}).notNull(),
}, (table) => [
	index("idx_memberships_org").using("btree", table.organization_id.asc().nullsLast().op("uuid_ops")),
	index("idx_memberships_scim").using("btree", table.scim_external_id.asc().nullsLast().op("text_ops")),
	index("idx_memberships_user").using("btree", table.user_id.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.organization_id],
			foreignColumns: [organizations.id],
			name: "organization_memberships_organization_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.user_id],
			foreignColumns: [users.id],
			name: "organization_memberships_user_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.manager_user_id],
			foreignColumns: [users.id],
			name: "organization_memberships_manager_user_id_fkey"
		}).onDelete("set null"),
	unique("uq_org_user_membership").on(table.organization_id, table.user_id),
]);

export const organizations = pgTable("organizations", {
	id: uuid().default(sql`uuid_generate_v4()`).primaryKey().notNull(),
	parent_organization_id: uuid(),
	slug: citext("slug").notNull(),
	name: varchar({ length: 100 }).notNull(),
	type: organization_type().default('personal').notNull(),
	avatar_url: varchar({ length: 1024 }),
	created_by_user_id: uuid().notNull(),
	is_active: boolean().default(true).notNull(),
	country: varchar({ length: 2 }),
	settings: jsonb().default({}).notNull(),
	enforce_sso: boolean().default(false).notNull(),
	enforce_mfa: boolean().default(false).notNull(),
	allowed_email_domains: text().array().default([""]).notNull(),
	session_duration_minutes: integer().default(1440).notNull(),
	ip_allowlist: inet().array().default([""]).notNull(),
	sso_config: jsonb().default({}).notNull(),
}, (table) => [
	index("idx_organizations_parent").using("btree", table.parent_organization_id.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.parent_organization_id],
			foreignColumns: [table.id],
			name: "organizations_parent_organization_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.created_by_user_id],
			foreignColumns: [users.id],
			name: "organizations_created_by_user_id_fkey"
		}),
	unique("organizations_slug_key").on(table.slug),
]);

export const notifications = pgTable("notifications", {
	id: uuid().default(sql`uuid_generate_v4()`).primaryKey().notNull(),
	organization_id: uuid().notNull(),
	recipient_user_id: uuid().notNull(),
	type: text().notNull(),
	title: text().notNull(),
	body: text(),
	source_table: text().notNull(),
	source_table_uuid: uuid().notNull(),
	workflow_id: uuid(),
	data: jsonb().default({}).notNull(),
	read_at: timestamp({ withTimezone: true, mode: 'string' }),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_notifications_recipient_created").using("btree", table.recipient_user_id.asc().nullsLast().op("timestamptz_ops"), table.created_at.desc().nullsFirst().op("timestamptz_ops")),
	index("idx_notifications_recipient_unread").using("btree", table.recipient_user_id.asc().nullsLast().op("uuid_ops")).where(sql`(read_at IS NULL)`),
	foreignKey({
			columns: [table.organization_id],
			foreignColumns: [organizations.id],
			name: "notifications_organization_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.recipient_user_id],
			foreignColumns: [users.id],
			name: "notifications_recipient_user_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.workflow_id],
			foreignColumns: [workflows.workflow_id],
			name: "notifications_workflow_id_fkey"
		}).onDelete("cascade"),
]);

export const expenses = pgTable("expenses", {
	id: uuid().default(sql`uuid_generate_v4()`).primaryKey().notNull(),
	user_id: uuid().notNull(),
	organization_id: uuid().notNull(),
	project_id: uuid(),
	subproject_id: uuid(),
	expense_date: date().notNull(),
	category: varchar({ length: 128 }).notNull(),
	sub_category: varchar({ length: 128 }),
	billing_type: varchar({ length: 128 }),
	original_value: numeric({ precision: 12, scale:  2 }),
	original_currency: char({ length: 3 }),
	currency: char({ length: 3 }).notNull(),
	quantity: numeric({ precision: 10, scale:  2 }),
	comment: text(),
	value: numeric({ precision: 12, scale:  2 }).default('0').notNull(),
}, (table) => [
	index("idx_expenses_org_date").using("btree", table.organization_id.asc().nullsLast().op("date_ops"), table.expense_date.asc().nullsLast().op("date_ops")),
	index("idx_expenses_project").using("btree", table.project_id.asc().nullsLast().op("uuid_ops")),
	index("idx_expenses_user_date").using("btree", table.user_id.asc().nullsLast().op("date_ops"), table.expense_date.asc().nullsLast().op("date_ops")),
	foreignKey({
			columns: [table.user_id],
			foreignColumns: [users.id],
			name: "expenses_user_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.organization_id],
			foreignColumns: [organizations.id],
			name: "expenses_organization_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.project_id],
			foreignColumns: [projects.id],
			name: "expenses_project_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.subproject_id],
			foreignColumns: [subprojects.id],
			name: "expenses_subproject_id_fkey"
		}).onDelete("set null"),
	check("chk_expenses_original_value_positive", sql`(original_value IS NULL) OR (original_value > (0)::numeric)`),
	check("chk_expenses_original_currency_format", sql`(original_currency IS NULL) OR (original_currency ~ '^[A-Z]{3}$'::text)`),
	check("chk_expenses_quantity_non_negative", sql`(quantity IS NULL) OR (quantity >= (0)::numeric)`),
	check("chk_expenses_currency_format", sql`currency ~ '^[A-Z]{3}$'::text`),
]);

export const versions = pgTable("versions", {
	version_id: uuid().default(sql`uuid_generate_v4()`).primaryKey().notNull(),
	source_table: text().notNull(),
	source_table_uuid: uuid().notNull(),
	version_nr: integer().default(1).notNull(),
	created: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	created_by_user_id: uuid(),
	lastmodified: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	lastmodified_by_user_id: uuid(),
	lastmodified_by_workflow_id: uuid(),
	history: jsonb().default([]).notNull(),
}, (table) => [
	uniqueIndex("uq_versions_source_table_record").using("btree", table.source_table.asc().nullsLast().op("text_ops"), table.source_table_uuid.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.created_by_user_id],
			foreignColumns: [users.id],
			name: "versions_created_by_user_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.lastmodified_by_user_id],
			foreignColumns: [users.id],
			name: "versions_lastmodified_by_user_id_fkey"
		}).onDelete("set null"),
	check("chk_versions_version_nr_positive", sql`version_nr >= 1`),
]);

export const workflows = pgTable("workflows", {
	workflow_id: uuid().default(sql`uuid_generate_v4()`).primaryKey().notNull(),
	workflow_def_id: uuid().notNull(),
	source_table: text().notNull(),
	source_table_uuid: uuid().notNull(),
	workflow_data: jsonb().default({}).notNull(),
	workflow_started: timestamp({ withTimezone: true, mode: 'string' }),
	workflow_finished: timestamp({ withTimezone: true, mode: 'string' }),
	workflow_to_be_finished_until: timestamp({ withTimezone: true, mode: 'string' }),
	step: text(),
	step_status: text(),
	workflow_step_started: timestamp({ withTimezone: true, mode: 'string' }),
	workflow_step_finished: timestamp({ withTimezone: true, mode: 'string' }),
	workflow_step_to_be_finished_until: timestamp({ withTimezone: true, mode: 'string' }),
	assigned_to_user_id: uuid().array(),
	assigned_to_team_id: uuid(),
	notification: jsonb().default({}).notNull(),
}, (table) => [
	index("idx_workflows_def").using("btree", table.workflow_def_id.asc().nullsLast().op("uuid_ops")),
	index("idx_workflows_source").using("btree", table.source_table.asc().nullsLast().op("uuid_ops"), table.source_table_uuid.asc().nullsLast().op("text_ops")),
	index("idx_workflows_team").using("btree", table.assigned_to_team_id.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.workflow_def_id],
			foreignColumns: [workflow_definitions.workflow_def_id],
			name: "workflows_workflow_def_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.assigned_to_team_id],
			foreignColumns: [teams.id],
			name: "workflows_assigned_to_team_id_fkey"
		}).onDelete("set null"),
	check("chk_workflows_assignee_required", sql`(assigned_to_user_id IS NOT NULL) OR (assigned_to_team_id IS NOT NULL)`),
]);

export const workflow_definitions = pgTable("workflow_definitions", {
	workflow_def_id: uuid().default(sql`uuid_generate_v4()`).primaryKey().notNull(),
	organization_id: uuid().notNull(),
	name: text().notNull(),
	description: text(),
	steps: jsonb().default([]).notNull(),
}, (table) => [
	index("idx_workflow_definitions_org").using("btree", table.organization_id.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.organization_id],
			foreignColumns: [organizations.id],
			name: "workflow_definitions_organization_id_fkey"
		}).onDelete("cascade"),
]);

export const role_permissions = pgTable("role_permissions", {
	role_id: uuid().notNull(),
	permission_id: varchar({ length: 64 }).notNull(),
}, (table) => [
	foreignKey({
			columns: [table.role_id],
			foreignColumns: [roles.id],
			name: "role_permissions_role_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.permission_id],
			foreignColumns: [permissions.id],
			name: "role_permissions_permission_id_fkey"
		}).onDelete("cascade"),
	primaryKey({ columns: [table.role_id, table.permission_id], name: "role_permissions_pkey"}),
]);

export const team_members = pgTable("team_members", {
	team_id: uuid().notNull(),
	membership_id: uuid().notNull(),
	team_role_id: uuid(),
}, (table) => [
	foreignKey({
			columns: [table.team_id],
			foreignColumns: [teams.id],
			name: "team_members_team_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.membership_id],
			foreignColumns: [organization_memberships.id],
			name: "team_members_membership_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.team_role_id],
			foreignColumns: [roles.id],
			name: "team_members_team_role_id_fkey"
		}).onDelete("set null"),
	primaryKey({ columns: [table.team_id, table.membership_id], name: "team_members_pkey"}),
]);

export const membership_roles = pgTable("membership_roles", {
	membership_id: uuid().notNull(),
	role_id: uuid().notNull(),
	granted_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	granted_by_user_id: uuid(),
}, (table) => [
	index("idx_membership_roles_role").using("btree", table.role_id.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.membership_id],
			foreignColumns: [organization_memberships.id],
			name: "membership_roles_membership_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.role_id],
			foreignColumns: [roles.id],
			name: "membership_roles_role_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.granted_by_user_id],
			foreignColumns: [users.id],
			name: "membership_roles_granted_by_user_id_fkey"
		}).onDelete("set null"),
	primaryKey({ columns: [table.membership_id, table.role_id], name: "membership_roles_pkey"}),
]);
export const audit = pgView("audit", {	uuid: uuid(),
	entity: varchar({ length: 64 }),
	entity_uuid: varchar({ length: 255 }),
	action: varchar({ length: 128 }),
	actionby: uuid(),
	organization_id: uuid(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }),
}).as(sql`SELECT id AS uuid, target_type AS entity, target_id AS entity_uuid, action, actor_user_id AS actionby, organization_id, created_at FROM audit_logs`);