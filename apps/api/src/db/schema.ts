import { pgTable, index, foreignKey, unique, uuid, varchar, jsonb, timestamp, boolean, text, integer, inet, check, uniqueIndex, date, numeric, primaryKey, pgView, pgEnum, customType } from "drizzle-orm/pg-core"
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
export const sso_protocol = pgEnum("sso_protocol", ['saml2', 'oidc'])
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
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_user_identities_user_id").using("btree", table.user_id.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.user_id],
			foreignColumns: [users.id],
			name: "user_identities_user_id_fkey"
		}).onDelete("cascade"),
	unique("uq_provider_user_id").on(table.provider, table.provider_user_id),
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
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	country: varchar({ length: 2 }),
	settings: jsonb().default({}).notNull(),
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

export const organization_settings = pgTable("organization_settings", {
	organization_id: uuid().primaryKey().notNull(),
	enforce_sso: boolean().default(false).notNull(),
	enforce_mfa: boolean().default(false).notNull(),
	allowed_email_domains: text().array().default([""]).notNull(),
	session_duration_minutes: integer().default(1440).notNull(),
	ip_allowlist: inet().array().default([""]).notNull(),
	features: jsonb().default({}).notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.organization_id],
			foreignColumns: [organizations.id],
			name: "organization_settings_organization_id_fkey"
		}).onDelete("cascade"),
]);

export const sso_configurations = pgTable("sso_configurations", {
	id: uuid().default(sql`uuid_generate_v4()`).primaryKey().notNull(),
	organization_id: uuid().notNull(),
	protocol: sso_protocol().default('saml2').notNull(),
	idp_entity_id: varchar({ length: 512 }).notNull(),
	idp_sso_url: varchar({ length: 1024 }).notNull(),
	idp_certificate: text(),
	metadata_xml: text(),
	is_active: boolean().default(true).notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.organization_id],
			foreignColumns: [organizations.id],
			name: "sso_configurations_organization_id_fkey"
		}).onDelete("cascade"),
	unique("uq_org_sso").on(table.organization_id),
]);

export const organization_domains = pgTable("organization_domains", {
	id: uuid().default(sql`uuid_generate_v4()`).primaryKey().notNull(),
	organization_id: uuid().notNull(),
	domain: citext("domain").notNull(),
	verification_token: varchar({ length: 255 }).notNull(),
	verified_at: timestamp({ withTimezone: true, mode: 'string' }),
	auto_join_enabled: boolean().default(false).notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
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
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	first_name: varchar({ length: 100 }),
	middle_name: varchar({ length: 100 }),
	last_name: varchar({ length: 100 }),
	settings: jsonb().default({}).notNull(),
	is_active: boolean().default(true).notNull(),
}, (table) => [
	unique("users_email_key").on(table.email),
]);

export const teams = pgTable("teams", {
	id: uuid().default(sql`uuid_generate_v4()`).primaryKey().notNull(),
	organization_id: uuid().notNull(),
	name: varchar({ length: 100 }).notNull(),
	description: varchar({ length: 255 }),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.organization_id],
			foreignColumns: [organizations.id],
			name: "teams_organization_id_fkey"
		}).onDelete("cascade"),
	unique("uq_org_team_name").on(table.organization_id, table.name),
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
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
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

export const organization_memberships = pgTable("organization_memberships", {
	id: uuid().default(sql`uuid_generate_v4()`).primaryKey().notNull(),
	organization_id: uuid().notNull(),
	user_id: uuid().notNull(),
	role_id: uuid().notNull(),
	status: membership_status().default('active').notNull(),
	scim_external_id: varchar({ length: 255 }),
	joined_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	is_active: boolean().default(true).notNull(),
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
			columns: [table.role_id],
			foreignColumns: [roles.id],
			name: "organization_memberships_role_id_fkey"
		}),
	unique("uq_org_user_membership").on(table.organization_id, table.user_id),
]);

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
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	settings: jsonb().default({}).notNull(),
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
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
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
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
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
	organization_id: uuid(),
	project_id: uuid(),
	subproject_id: uuid(),
	start_time: timestamp({ withTimezone: true, mode: 'string' }).notNull(),
	end_time: timestamp({ withTimezone: true, mode: 'string' }).notNull(),
	comment: text(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_worktimes_project").using("btree", table.project_id.asc().nullsLast().op("uuid_ops")),
	index("idx_worktimes_user_start").using("btree", table.user_id.asc().nullsLast().op("timestamptz_ops"), table.start_time.asc().nullsLast().op("timestamptz_ops")),
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
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_static_data_entity").using("btree", table.entity.asc().nullsLast().op("text_ops"), table.enum_name.asc().nullsLast().op("text_ops")),
	uniqueIndex("uq_static_data_entity_enum").using("btree", table.entity.asc().nullsLast().op("text_ops"), table.enum_name.asc().nullsLast().op("text_ops")),
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
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updated_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
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

export const member_rates = pgTable("member_rates", {
	id: uuid().default(sql`uuid_generate_v4()`).primaryKey().notNull(),
	organization_id: uuid().notNull(),
	user_id: uuid().notNull(),
	hourly_rate: numeric({ precision: 10, scale:  2 }).notNull(),
	currency: varchar({ length: 3 }).default('USD').notNull(),
	effective_from: date().notNull(),
	effective_to: date(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_member_rates_lookup").using("btree", table.organization_id.asc().nullsLast().op("uuid_ops"), table.user_id.asc().nullsLast().op("date_ops"), table.effective_from.asc().nullsLast().op("date_ops")),
	foreignKey({
			columns: [table.organization_id],
			foreignColumns: [organizations.id],
			name: "member_rates_organization_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.user_id],
			foreignColumns: [users.id],
			name: "member_rates_user_id_fkey"
		}).onDelete("cascade"),
	check("chk_member_rate_positive", sql`hourly_rate >= (0)::numeric`),
	check("chk_member_rate_order", sql`(effective_to IS NULL) OR (effective_to > effective_from)`),
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

export const role_translations = pgTable("role_translations", {
	role_id: uuid().notNull(),
	locale: varchar({ length: 10 }).notNull(),
	display_name: varchar({ length: 128 }).notNull(),
}, (table) => [
	foreignKey({
			columns: [table.role_id],
			foreignColumns: [roles.id],
			name: "role_translations_role_id_fkey"
		}).onDelete("cascade"),
	primaryKey({ columns: [table.role_id, table.locale], name: "role_translations_pkey"}),
]);

export const team_members = pgTable("team_members", {
	team_id: uuid().notNull(),
	membership_id: uuid().notNull(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	manager_user_id: uuid(),
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
			columns: [table.manager_user_id],
			foreignColumns: [users.id],
			name: "team_members_manager_user_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.team_role_id],
			foreignColumns: [roles.id],
			name: "team_members_team_role_id_fkey"
		}).onDelete("set null"),
	primaryKey({ columns: [table.team_id, table.membership_id], name: "team_members_pkey"}),
]);
export const audit = pgView("audit", {	uuid: uuid(),
	entity: varchar({ length: 64 }),
	entity_uuid: varchar({ length: 255 }),
	action: varchar({ length: 128 }),
	actionby: uuid(),
	organization_id: uuid(),
	created_at: timestamp({ withTimezone: true, mode: 'string' }),
}).as(sql`SELECT id AS uuid, target_type AS entity, target_id AS entity_uuid, action, actor_user_id AS actionby, organization_id, created_at FROM audit_logs`);