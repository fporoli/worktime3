--liquibase formatted sql

-- Replace citext with plain text on the four columns that used it
-- (users.email, organizations.slug, organization_domains.domain,
-- organization_invitations.email). The API already normalizes all of
-- these to lowercase before writing or querying them (see slugBase()/
-- .toLowerCase() in auth.controller.ts and orgs.controller.ts), so
-- case-insensitive comparison at the database layer was redundant
-- defense rather than something other code relies on. Dropping it also
-- removes the citext extension dependency and lets `db:introspect` map
-- these columns natively instead of needing scripts/fix-introspected-schema.mjs.
--
-- Note: this does trade away DB-level case-insensitive uniqueness — e.g.
-- 'a@x.com' and 'A@x.com' are no longer treated as the same email by a
-- UNIQUE constraint. That's fine as long as all writers keep lowercasing
-- first, as they do today.

--changeset worktime:067-drop-citext
DROP INDEX idx_org_domains_domain;
DROP INDEX idx_invitations_email;

ALTER TABLE users ALTER COLUMN email TYPE TEXT;
ALTER TABLE organizations ALTER COLUMN slug TYPE TEXT;
ALTER TABLE organization_domains ALTER COLUMN domain TYPE TEXT;
ALTER TABLE organization_invitations ALTER COLUMN email TYPE TEXT;

CREATE INDEX idx_org_domains_domain ON organization_domains(domain);
CREATE INDEX idx_invitations_email ON organization_invitations(email);

DROP EXTENSION IF EXISTS citext;
