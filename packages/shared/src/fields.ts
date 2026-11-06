/**
 * Field registry: the code defaults for configurable form fields (docs/FIELD_CONFIG.md).
 *
 * Every configurable input is described here once: where it is stored, its entry type, its
 * caption and tooltip (as i18n keys), size, order and rules. Global and per-org templates
 * (a later step) only override properties of these definitions.
 *
 * Erasable TypeScript only (no enums or namespaces), so Node can import this file in tests
 * without a build step.
 */

/** Entry types a template may choose. */
export const ENTRY_TYPES = ['checkbox', 'text', 'number', 'date', 'datetime'] as const;
export type EntryType = (typeof ENTRY_TYPES)[number];

/**
 * All types the registry can declare: the five entry types plus `select`, a code-defined
 * dropdown whose options the page supplies (see `FieldDef.options`).
 */
export type FieldType = EntryType | 'select';

export const WIDTHS = ['s', 'm', 'l', 'full'] as const;
export type Width = (typeof WIDTHS)[number];

/** Minimum width in pixels per size preset; `full` takes the whole row. */
export const WIDTH_PX: Record<Exclude<Width, 'full'>, number> = { s: 120, m: 200, l: 320 };

/** Where a field's value lives. */
export type FieldStorage =
  | { kind: 'column'; table: string; column: string }
  | { kind: 'json'; table: string; column: string; key: string };

/** Who may change the value: `self` via a change request (HR approves), `hr` only HR or admin. */
export type EditableBy = 'self' | 'hr';

/** Properties a template may make stricter but never looser. */
export type LockableProperty = 'type' | 'required' | 'validator' | 'min' | 'max';

export interface FieldDef {
  /** Stable id within the form; also the key in the form's values object. */
  key: string;
  storage: FieldStorage;
  type: FieldType;
  /** Other types a template may switch this field to; stored values must stay readable. */
  allowedTypes?: FieldType[];
  /** i18n key of the caption. */
  caption: string;
  /** i18n key of the tooltip. */
  tooltip?: string;
  /** i18n key of the placeholder. */
  placeholder?: string;
  /** Key of the group (section) the field is shown in. */
  group: string;
  /** Position within the group, ascending. */
  order: number;
  /** Start a new row before this field. */
  newRow?: boolean;
  width: Width;
  /** Number of text rows; more than 1 makes a text entry multi-line. */
  height?: number;
  required?: boolean;
  /** Named validator, see docs/FIELD_CONFIG.md. */
  validator?: string;
  min?: number | string;
  max?: number | string;
  /** True if a template may hide the field. */
  optional: boolean;
  /** Shown but never editable in this form (e.g. a value another screen owns). */
  readOnly?: boolean;
  editableBy: EditableBy;
  /** For `select`: name of the option list the page passes to the form. */
  options?: string;
  locked?: LockableProperty[];
}

export interface GroupDef {
  key: string;
  /** i18n key of the group title. */
  caption: string;
  order: number;
}

export interface FormDef {
  id: string;
  groups: GroupDef[];
  fields: FieldDef[];
}

// ---------------------------------------------------------------------------
// Basic data (Home page "My Data", and the Users page's basic-data dialog)
// ---------------------------------------------------------------------------

type FieldExtras = Partial<Omit<FieldDef, 'key' | 'storage' | 'caption' | 'group' | 'order'>>;

/** A field stored as a key in users.basicdata. */
function basicdataJson(key: string, group: string, order: number, extras: FieldExtras = {}): FieldDef {
  return {
    key,
    storage: { kind: 'json', table: 'users', column: 'basicdata', key },
    type: 'text',
    caption: `home.field.${key}`,
    group,
    order,
    width: 'm',
    optional: true,
    editableBy: group === 'personalien' ? 'hr' : 'self',
    ...extras,
  };
}

/** A field stored in a real column of `users`. */
function usersColumn(key: string, column: string, order: number, extras: FieldExtras = {}): FieldDef {
  return {
    key,
    storage: { kind: 'column', table: 'users', column },
    type: 'text',
    caption: `home.field.${key}`,
    group: 'personalien',
    order,
    width: 'm',
    optional: true,
    editableBy: 'hr',
    ...extras,
  };
}

export const BASICDATA_FORM: FormDef = {
  id: 'basicdata',
  groups: [
    { key: 'personalien', caption: 'home.section.personalien', order: 10 },
    { key: 'address', caption: 'home.section.address', order: 20 },
    { key: 'civilStatus', caption: 'home.section.civilStatus', order: 30 },
  ],
  fields: [
    // users.display_name is NOT NULL, so it can never be hidden.
    usersColumn('displayName', 'display_name', 10, { optional: false }),
    usersColumn('firstName', 'first_name', 20),
    usersColumn('middleName', 'middle_name', 30),
    usersColumn('lastName', 'last_name', 40),
    basicdataJson('personnelNumber', 'personalien', 50),
    basicdataJson('gender', 'personalien', 60),
    basicdataJson('birthDate', 'personalien', 70, { type: 'date', allowedTypes: ['date'] }),
    basicdataJson('socialSecurityNumber', 'personalien', 80),
    basicdataJson('languageCode', 'personalien', 90, { type: 'select', options: 'locales' }),
    basicdataJson('placeOfOrigin', 'personalien', 100),
    basicdataJson('nationality', 'personalien', 110, { type: 'select', options: 'nations' }),
    basicdataJson('residencePermitCode', 'personalien', 120),
    usersColumn('companyEmail', 'email', 130, { readOnly: true }),

    basicdataJson('salutation', 'address', 10),
    basicdataJson('street', 'address', 20),
    basicdataJson('postalCode', 'address', 30),
    basicdataJson('city', 'address', 40),
    basicdataJson('country', 'address', 50, { type: 'select', options: 'countries' }),
    basicdataJson('canton', 'address', 60, { type: 'select', options: 'cantons' }),
    basicdataJson('phone1', 'address', 70),
    basicdataJson('phone2', 'address', 80),
    basicdataJson('mobile', 'address', 90),
    basicdataJson('email', 'address', 100),

    basicdataJson('civilStatus', 'civilStatus', 10),
    // Stored as free text so far; switching it to `date` needs existing values cleaned first.
    basicdataJson('civilStatusSince', 'civilStatus', 20),
  ],
};

export const FORMS: Record<string, FormDef> = {
  [BASICDATA_FORM.id]: BASICDATA_FORM,
};

/** The form's fields, optionally only one group's, in display order. */
export function formFields(form: FormDef, group?: string): FieldDef[] {
  return form.fields.filter((f) => group === undefined || f.group === group).sort((a, b) => a.order - b.order);
}

/** Keys of the fields in a group that this form writes (everything except read-only fields). */
export function writableKeys(form: FormDef, group: string): string[] {
  return formFields(form, group)
    .filter((f) => !f.readOnly)
    .map((f) => f.key);
}
