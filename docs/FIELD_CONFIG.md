# Configurable form fields

Design for letting people change how edit-form fields look and behave without
changing code: caption, tooltip, size, entry type, order, validation and the
translations of every text. Changes are made in the app itself, in a side
panel, by two new roles.

Status: design, not built yet.

## Scope of the first version

- **Edit forms only.** List columns, tables and exports keep their current,
  code-defined columns.
- **Changes go live immediately** when saved. There is no draft or publish
  step; every change is recorded in `versions`, so it can be inspected and
  undone.
- **First target: basic data** (the Home page's personal-data form). Two
  example cases drive the design:
  - an org adds a *place of birth* field, stored in `users.basicdata`;
  - an org does not use *middle name* and hides it.
- Expenses follow once basic data works. Other forms are migrated one at a time.

## Concepts

**Form**: one edit form in the app, with a stable id such as `basicdata` or
`expense`.

**Field**: one input on a form, with a stable id inside that form such as
`middleName` or `placeOfBirth`.

**Template**: the stored settings for the fields of a form. There are three
layers, from least to most specific:

| Layer | Stored in | Edited by | Applies to |
| --- | --- | --- | --- |
| Code defaults | `apps/web/src/fields.ts` and the API mirror | developers of this repo | everyone, always present |
| Global template | `field_config` rows with `organization_id IS NULL` | superdeveloper | every organization |
| Org template | `field_config` rows with an `organization_id` | that org's developer | that organization only |

Each property is taken from the most specific layer that sets it. A layer stores
only the properties it changes, so an org that never touched a tooltip picks up
a later global change to it automatically.

### Two kinds of field

| | Column-bound | JSON-bound |
| --- | --- | --- |
| Stored in | a real database column, e.g. `users.middle_name` | a key inside a JSONB column, e.g. `users.basicdata.placeOfBirth` |
| Defined by | code only (needs a Liquibase changelog) | code (built-in keys) **or** a template (custom keys) |
| Can be created or deleted in the panel | no | custom keys only |
| Entry type | fixed by the column type; code may allow a compatible alternative | free choice among the five types, with limits on later changes |
| Validation | the column's own constraints, plus the merged template rules | the merged template rules only, so the API must check them |

Basic data already mixes both: `displayName`, `firstName`, `middleName` and
`lastName` map to columns on `users` (`USER_COLUMN_MAP` in
`basicdata.controller.ts`); everything else is a key in `users.basicdata`.
Those existing keys are **built-in JSON fields**: defined in code like a
column-bound field, but stored in JSON. Only fields added through a template are
**custom**.

## Roles

**Developer**: a system role per organization, like `hr` and `billing_admin`
(row in `roles` with `organization_id IS NULL`, granted through
`membership_roles`). An org admin grants it. It allows editing that org's
template only. New helper: `isOrgDeveloper(db, orgId, userId)` in `access.ts`.

**Superdeveloper**: acts across every organization, so it cannot be an org
role. New column `users.is_superdeveloper BOOLEAN NOT NULL DEFAULT FALSE`. It is
set only by another superdeveloper or directly in the database; no org admin
can grant it. A superdeveloper may also edit any org's template. New helper:
`isSuperDeveloper(db, userId)`.

Neither role grants access to data. Seeing a form in design mode still requires
the normal read access to the record behind it.

## Field properties

| Property | Values | Column-bound | Built-in JSON | Custom JSON |
| --- | --- | --- | --- | --- |
| `caption` | text per language | change | change | change |
| `tooltip` | text per language | change | change | change |
| `placeholder` | text per language | change | change | change |
| `group` | group id; group titles are texts per language | change | change | change |
| `order` | integer within the group | change | change | change |
| `newRow` | boolean: field starts a new row | change | change | change |
| `width` | `s`, `m`, `l`, `full` | change | change | change |
| `height` | 1 to 6 rows (text entry only) | change | change | change |
| `type` | see Entry types | only to a type the code allows | only to a type the code allows | compatible changes only |
| `required` | boolean | stricter only | stricter only | change |
| `validator` | named validator or regex, see Validation | stricter only | stricter only | change |
| `min` / `max` | number, or date for date types | narrower only | narrower only | change |
| `hidden` | boolean | only if the code marks the field optional | only if the code marks the field optional | change |
| `editableBy` | `self` (via HR approval) or `hr` | fixed by code | fixed by code | change |
| `retired` | boolean | n/a | n/a | change (this is how a custom field is deleted) |

"Stricter only" means a template can add a requirement the code does not have,
but never remove one the code sets. The code marks a property as locked by
setting it in the registry with `locked: true`, for example
`project_time.date` is always required.

`hidden` only removes the field from the form. It never deletes stored values.

`editableBy` follows the existing basic-data split between `ADMIN_ONLY_KEYS`
and `SELF_SERVICE_KEYS`: `self` fields go through the HR change-request flow
when a user edits their own data; `hr` fields can only be changed by HR or
admin.

## Entry types and storage

The panel offers five entry types. The stored form is the same in every
language.

| Type | Input | Stored as (JSON-bound) | Column types it fits |
| --- | --- | --- | --- |
| `checkbox` | checkbox | `true` / `false` | `boolean` |
| `text` | single line, or multi-line when `height > 1` | string | `varchar`, `text`, `citext` |
| `number` | number in the user's format (`12,50`, `1'234.50`) | JSON number | `integer`, `numeric` |
| `date` | date picker in the user's format | `"2026-11-06"` | `date` |
| `datetime` | date and time picker, in the user's time zone | ISO UTC `"2026-11-06T08:30:00Z"` | `timestamptz` |

Allowed type changes for custom JSON fields, because stored values must stay
readable:

| From | To |
| --- | --- |
| `date` | `datetime` |
| `number` | `text` |
| `checkbox` | `text` |
| anything else | not allowed: retire the field and create a new one |

Existing code-defined dropdowns (country, nationality, canton, language, which
read from `static_data`) keep a sixth type, `select`, that the panel shows but
does not offer for new fields. Letting developers create dropdowns is a later
step.

## Internationalization

**Texts.** Every text property (`caption`, `tooltip`, `placeholder`, group
titles, validator messages) is stored as a map from language to text:
`{ "en": "Place of birth", "de": "Geburtsort", "fr": "Lieu de naissance", "it": "Luogo di nascita" }`.
Code defaults are i18n keys into `DICTIONARIES` in `dictionaries.ts`. The text shown is
the first that exists:

1. org template, user's language
2. global template, user's language
3. code default from the dictionary, user's language
4. code default from the dictionary, English
5. the key itself, so a missing text is visible rather than blank

Maps may contain languages the app does not support yet; they are kept and
ignored until that language is added.

The panel edits all languages side by side and marks missing ones. Saving a
custom field requires at least an English caption.

**Errors.** The API never returns message text. It returns codes and the web
app translates them:

```json
{ "ok": false, "error": "invalid-field", "fields": [{ "field": "placeOfBirth", "rule": "required" }] }
```

Built-in rules (`required`, `min`, `max`, `type`, and each named validator)
have dictionary keys `validation.<rule>`. A custom regex must come with its own
message in each language, stored in the template.

**Numbers, dates and times** are typed and shown in the user's language
(decimal separator, date order) and stored in the canonical form above. Display
uses `Intl` with the app's selected language, never the browser's.

**Widths.** The `s`/`m`/`l`/`full` presets are sized for the longest language
(German). Long captions wrap; detail goes in the tooltip. Layout uses logical
CSS properties (start/end) so a right-to-left language would work later.

## Validation

Named validators, checked the same way in the browser and the API:

| Validator | Checks | Normalizes |
| --- | --- | --- |
| `email` | address format | trims, lowercases the domain |
| `phone` | international or Swiss format | removes spaces |
| `iban` | IBAN checksum | removes spaces, uppercases |
| `postcode:CH` | four digits | trims |
| `ahv` | Swiss social security number (756.xxxx.xxxx.xx) with checksum | formats with dots |

Validators are tied to a country, not a language: a Swiss postcode is checked
the same way whether the form is in German or French.

A raw regex is allowed as an advanced option. It always runs with the `u` flag
(so names like "Zoë" pass) on the normalized value, must match the whole value,
and is rejected on save if it does not compile or is longer than 200
characters.

## Storing custom JSON fields

`users` is global, but templates are per org, and a user can belong to several
orgs. Custom values are therefore stored by the layer that defined the field:

| Field defined in | Stored at |
| --- | --- |
| code (built-in) | `users.basicdata.<key>` (unchanged) |
| global template | `users.basicdata.<key>` |
| org template | `users.basicdata.orgs.<organization_id>.<key>` |

This keeps one org's custom data out of other orgs' reads, and lets a global
field and an org field share a name without colliding. The basic-data read
endpoint returns only the built-in keys, global keys and the calling org's
section.

A custom key matches `^[a-z][a-zA-Z0-9]{0,39}$`, is set when the field is
created and never changes; only its caption can change. A key cannot be reused
by a new field once used, even after retirement, within the same layer.

Retiring a custom field hides it from forms and makes the API stop accepting
writes to it. Stored values stay, so history and the HR change-request records
still show them.

## Data model

New changelog, e.g. `030-field-config.sql`:

```sql
--changeset worktime:030-field-config
CREATE TABLE field_config (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id  UUID REFERENCES organizations(id) ON DELETE CASCADE,  -- NULL = global template
    form_id          VARCHAR(64)  NOT NULL,
    field_key        VARCHAR(64)  NOT NULL,
    is_custom        BOOLEAN      NOT NULL DEFAULT FALSE,  -- defined here, not in code
    config           JSONB        NOT NULL DEFAULT '{}'    -- only the properties this layer sets
);
CREATE UNIQUE INDEX uq_field_config ON field_config
    (COALESCE(organization_id, '00000000-0000-0000-0000-000000000000'), form_id, field_key);

--changeset worktime:030-superdeveloper
ALTER TABLE users ADD COLUMN is_superdeveloper BOOLEAN NOT NULL DEFAULT FALSE;

--changeset worktime:030-developer-role
INSERT INTO roles (id, organization_id, name, description, is_system_role) VALUES
    ('00000000-0000-0000-0000-000000000008', NULL, 'developer',
     'Can change the organization''s form layout, captions and translations', TRUE);
```

Group definitions (id, title per language, order) live in rows with
`field_key = '$groups'`, so they follow the same layering.

Changes are recorded with
`VersionsService.record('field_config', id, action, actorUserId, row)`, as
everywhere else. No timestamp columns.

## API

New `fields.controller.ts`, registered in `app.module.ts`:

| Endpoint | Who | Returns / does |
| --- | --- | --- |
| `GET /organizations/:orgId/forms/:formId` | any org member | the merged template for that org, ready to render |
| `GET /organizations/:orgId/forms/:formId/layers` | developer of the org, superdeveloper | code, global and org layers separately, so the panel can show where each value comes from |
| `PUT /organizations/:orgId/forms/:formId/fields/:fieldKey` | developer of the org, superdeveloper | sets the org layer for one field |
| `DELETE /organizations/:orgId/forms/:formId/fields/:fieldKey` | developer of the org, superdeveloper | resets the field to inherited (built-in) or retires it (custom) |
| `PUT /forms/:formId/fields/:fieldKey` | superdeveloper | sets the global layer |
| `DELETE /forms/:formId/fields/:fieldKey` | superdeveloper | resets or retires in the global layer |

Every write checks the result against the code registry before saving and
returns `{ ok: false, error: 'field-config-invalid', reason }` when a rule is
broken (loosening a locked property, an incompatible type change, a key
collision, a bad regex).

The code registry is shared by the API and the web app through
`packages/shared/src/fields.ts`, so both apply the same defaults and locks.
This would be the first real use of `packages/shared`.

**Enforcement.** Each controller that writes a configured form (first:
`basicdata.controller.ts`) loads the merged template and runs a shared
`validateFields(template, patch)` before saving. For basic data this replaces
the hard-coded `ADMIN_ONLY_KEYS`/`SELF_SERVICE_KEYS` lists with each field's
`editableBy`, and allows custom keys from the template in `sanitizePatch`.

**Caching.** The merged template is cached per org and form in the API and
cleared on every write. The web app fetches it once per form per session and
fetches it again after an org switch or after a save in design mode.

## Web app

**Rendering.** A `<ConfigForm formId="basicdata" values={...} onChange={...} />`
component renders fields from the merged template: order, groups, new rows,
widths, captions and tooltips in the current language, and inline validation
messages. Pages that need special layout can instead use
`<ConfigField formId="basicdata" field="middleName" .../>` one at a time.

**Design mode.** Users with either role get a *Design mode* switch in the user
menu. When it is on:

- every configured field gets a frame; clicking one selects it in the panel;
- a panel opens on the right with:
  - a **scope** selector: *This organization* (developer) or *Global template*
    (superdeveloper only);
  - the **field list** for the current form, with drag and drop for order and
    groups, an *Add field* button (custom JSON fields), and hidden and retired
    fields shown greyed out;
  - the selected field's **properties**, each marked with where its value comes
    from (code, global, org) and a *reset to inherited* button;
  - a **translations** table: one row per text, one column per language,
    missing texts highlighted;
- edits preview live on the form behind the panel; *Save* writes them,
  *Discard* drops them.

## Basic data specifics

- `placeOfOrigin` is currently captioned "Place of origin/birth" in English and
  "Heimat-/Geburtsort" in German. With a separate *place of birth* field, its
  caption should go back to "Place of origin" ("Heimatort").
- `partner`, `children`, `bankAccounts` and `emergencyContacts` are nested
  objects and lists. In the first version they stay code-defined: their inner
  fields can be captioned and resized but not reordered across groups, hidden
  or extended with custom fields. Repeating groups are a later step.
- `companyEmail` is read-only and shown for information only; it can be
  captioned and moved but not changed to an input.
- Custom fields added by an org are always `editableBy: hr` unless the
  developer sets `self`, so a new field never opens self-service by accident.

## Later

- Custom fields in list columns, tables and exports.
- Developer-defined dropdowns backed by `static_data`.
- Repeating groups (lists of sub-records).
- Conditional rules, e.g. *required when nationality is not CH*.
- Draft and publish.
- JSON columns on other records (`expenses`, `project_times`, `absences`,
  `projects`, `teams`), each added with its own changelog when needed.

## Implementation steps

1. Done: French and Italian dictionaries completed, dates and times formatted
   in the app's language, project-time dialogs translated, and
   `dictionaries.test.mjs` checks keys and placeholders. Still open: about 100
   hard-coded English captions on other pages.
2. Code registry in `packages/shared`, `<ConfigForm>`/`<ConfigField>`, and the
   locale-aware number, date and datetime inputs. Move the basic-data form onto
   it with no visible change.
3. Changelog 030, `fields.controller.ts`, the merge and `validateFields`, and
   enforcement in `basicdata.controller.ts`. Tests for merging, locks, type
   changes and validators in `test/api/`.
4. Design mode and the side panel.
5. Custom JSON fields for basic data, including the per-org storage section.
6. Expenses: add `expenses.data JSONB` (`expense_reports.data` already exists)
   and move the expense form onto `<ConfigForm>`.
