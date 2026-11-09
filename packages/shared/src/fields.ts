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
  /** Where custom fields added by a template are stored (a JSONB column). No custom fields without it. */
  customStorage?: { table: string; column: string };
  /** Keys a custom field may not take, e.g. nested lists the form stores next to its fields. */
  reservedKeys?: string[];
  /** Fields carry `editableBy` (self-service through HR approval); custom fields may choose it. */
  selfService?: boolean;
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
  // Org-defined custom fields go into the org's own section, `basicdata.orgs.<orgId>`.
  customStorage: { table: 'users', column: 'basicdata' },
  reservedKeys: ['orgs', 'bankAccounts', 'emergencyContacts', 'partner', 'children'],
  selfService: true,
  groups: [
    { key: 'personalien', caption: 'home.section.personalien', order: 10 },
    { key: 'address', caption: 'home.section.address', order: 20 },
    { key: 'civilStatus', caption: 'home.section.civilStatus', order: 30 },
  ],
  fields: [
    // users.display_name is NOT NULL, so it is always required and can never be hidden.
    usersColumn('displayName', 'display_name', 10, { optional: false, required: true, locked: ['required'] }),
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

// ---------------------------------------------------------------------------
// Expenses (the Expenses page's log/edit form)
// ---------------------------------------------------------------------------

/** A field stored in a real column of `expenses`. Field keys match the API's request body. */
function expensesColumn(key: string, column: string, caption: string, group: string, order: number, extras: FieldExtras = {}): FieldDef {
  return {
    key,
    storage: { kind: 'column', table: 'expenses', column },
    type: 'text',
    caption,
    group,
    order,
    width: 'm',
    optional: true,
    editableBy: 'self',
    ...extras,
  };
}

export const EXPENSE_FORM: FormDef = {
  id: 'expense',
  customStorage: { table: 'expenses', column: 'data' },
  reservedKeys: ['orgs'],
  groups: [
    { key: 'expense', caption: 'expenses.section.expense', order: 10 },
    // Shown collapsed under "Additional data" until opened.
    { key: 'additional', caption: 'expenses.additionalData', order: 20 },
  ],
  fields: [
    // NOT NULL columns: always required, never hidden.
    expensesColumn('expenseDate', 'expense_date', 'time.date', 'expense', 10, { type: 'date', optional: false, required: true, locked: ['type', 'required'] }),
    expensesColumn('category', 'category', 'expenses.category', 'expense', 20, { type: 'select', options: 'categories', optional: false, required: true, locked: ['required'] }),
    expensesColumn('subCategory', 'sub_category', 'expenses.subCategory', 'expense', 30, { type: 'select', options: 'subCategories' }),
    expensesColumn('projectId', 'project_id', 'time.project', 'expense', 40, { type: 'select', options: 'projects' }),
    expensesColumn('subprojectId', 'subproject_id', 'time.subproject', 'expense', 50, { type: 'select', options: 'subprojects' }),
    expensesColumn('value', 'value', 'expenses.value', 'expense', 60, { type: 'number', width: 's', newRow: true, optional: false, required: true, min: 0, locked: ['type', 'required', 'min'] }),
    expensesColumn('currency', 'currency', 'expenses.currency', 'expense', 70, { width: 's', optional: false, required: true, validator: 'currency', locked: ['required', 'validator'] }),
    expensesColumn('comment', 'comment', 'time.comment', 'expense', 80, { width: 'full', height: 2, newRow: true }),

    // The receipt's own amount and currency: optional, but valid when given (DB checks value > 0).
    expensesColumn('originalValue', 'original_value', 'expenses.originalValue', 'additional', 10, { type: 'number', width: 's', min: 0.01, locked: ['type', 'min'] }),
    expensesColumn('originalCurrency', 'original_currency', 'expenses.originalCurrency', 'additional', 20, { width: 's', validator: 'currency', locked: ['validator'] }),
    expensesColumn('quantity', 'quantity', 'expenses.quantity', 'additional', 30, { type: 'number', width: 's', min: 0, locked: ['type', 'min'] }),
  ],
};

export const FORMS: Record<string, FormDef> = {
  [BASICDATA_FORM.id]: BASICDATA_FORM,
  [EXPENSE_FORM.id]: EXPENSE_FORM,
};

/** The form's fields, optionally only one group's, in display order. */
export function formFields<F extends FieldDef>(form: { fields: F[] }, group?: string): F[] {
  return form.fields.filter((f) => group === undefined || f.group === group).sort((a, b) => a.order - b.order);
}

/** Keys of the fields in a group that this form writes (everything except read-only and retired fields). */
export function writableKeys(form: { fields: (FieldDef & { retired?: boolean })[] }, group: string): string[] {
  return formFields(form, group)
    .filter((f) => !f.readOnly && !f.retired)
    .map((f) => f.key);
}

// ---------------------------------------------------------------------------
// Templates: global and per-org overrides of the code defaults
// ---------------------------------------------------------------------------

/** Text per language, e.g. `{ en: 'Place of birth', de: 'Geburtsort' }`. */
export type Texts = Record<string, string>;

/** Named validators; `postcode:CH` is tied to a country, not a language. */
export const VALIDATORS = ['email', 'phone', 'iban', 'postcode:CH', 'ahv', 'currency'] as const;
export type ValidatorName = (typeof VALIDATORS)[number];

/** What one template layer sets for one field: only the properties it changes. */
export interface FieldOverride {
  caption?: Texts;
  tooltip?: Texts;
  placeholder?: Texts;
  group?: string;
  order?: number;
  newRow?: boolean;
  width?: Width;
  height?: number;
  type?: FieldType;
  required?: boolean;
  validator?: string;
  /** Regular expression the whole (normalized) value must match; needs `patternMessage.en`. */
  pattern?: string;
  patternMessage?: Texts;
  min?: number | string;
  max?: number | string;
  hidden?: boolean;
}

export interface GroupOverride {
  caption?: Texts;
  order?: number;
}

/** `field_config.field_key` of the row holding a layer's group overrides. */
export const GROUPS_KEY = '$groups';

/**
 * A custom field: defined by a template layer instead of the code, stored as a JSON key
 * (`FormDef.customStorage`). Its row in `field_config` has `is_custom = TRUE`.
 */
export interface CustomFieldDef extends FieldOverride {
  type: EntryType;
  editableBy?: EditableBy;
  /** Retired fields are no longer shown or written; stored values stay. Their key stays taken. */
  retired?: boolean;
}

/** One template layer of a form, as stored in `field_config`. */
export interface FormLayer {
  fields: Record<string, FieldOverride>;
  groups?: Record<string, GroupOverride>;
  /** Custom fields this layer defines. */
  custom?: Record<string, CustomFieldDef>;
}

/** The layer that defined a custom field. */
export type CustomScope = 'global' | 'org';

/** A field after merging the layers. `texts` hold template texts; the i18n keys stay the fallback. */
export interface ResolvedField extends FieldDef {
  hidden?: boolean;
  pattern?: string;
  /** Set on custom fields: the layer that defined it. */
  custom?: CustomScope;
  retired?: boolean;
  texts: { caption?: Texts; tooltip?: Texts; placeholder?: Texts; patternMessage?: Texts };
}

export interface ResolvedGroup extends GroupDef {
  texts: { caption?: Texts };
}

export interface ResolvedForm {
  id: string;
  groups: ResolvedGroup[];
  fields: ResolvedField[];
}

const TEXT_PROPS = ['caption', 'tooltip', 'placeholder', 'patternMessage'] as const;

/** A custom key: starts with a lower-case letter, letters and digits only, at most 40 characters. */
export const CUSTOM_KEY_RE = /^[a-z][a-zA-Z0-9]{0,39}$/;

/** Type changes a custom field may make once saved, so stored values stay readable. */
export const CUSTOM_TYPE_CHANGES: Record<EntryType, EntryType[]> = {
  checkbox: ['text'],
  text: [],
  number: ['text'],
  date: ['datetime'],
  datetime: [],
};

/** The field definition a custom field stands for; it plays the code default's part for later layers. */
export function customFieldDef(form: FormDef, key: string, c: CustomFieldDef): FieldDef {
  const storage = form.customStorage ?? { table: '', column: '' };
  const def: FieldDef = {
    key,
    storage: { kind: 'json', table: storage.table, column: storage.column, key },
    type: c.type,
    caption: '',
    group: c.group ?? form.groups[0]?.key ?? '',
    order: c.order ?? 1000,
    width: c.width ?? 'm',
    optional: true,
    editableBy: c.editableBy ?? 'hr',
  };
  for (const prop of ['newRow', 'height', 'required', 'validator', 'min', 'max'] as const) {
    if (c[prop] !== undefined) (def as unknown as Record<string, unknown>)[prop] = c[prop];
  }
  return def;
}

/** The form with a layer's custom fields added as definitions: what a later layer's overrides are checked against. */
export function formWithCustom(form: FormDef, layer?: FormLayer): FormDef {
  const custom = Object.entries(layer?.custom ?? {}).map(([key, c]) => customFieldDef(form, key, c));
  return custom.length === 0 ? form : { ...form, fields: [...form.fields, ...custom] };
}

/** The code defaults with each layer applied in turn (global, then org). Texts merge per language. */
export function mergeForm(form: FormDef, ...layers: (FormLayer | undefined)[]): ResolvedForm {
  const defs: ResolvedField[] = form.fields.map((def) => ({ ...def, texts: {} }));
  layers.forEach((layer, i) => {
    for (const [key, c] of Object.entries(layer?.custom ?? {})) {
      if (defs.some((d) => d.key === key)) continue;
      const field: ResolvedField = { ...customFieldDef(form, key, c), custom: i === 0 ? 'global' : 'org', texts: {} };
      for (const prop of TEXT_PROPS) if (c[prop]) field.texts[prop] = { ...c[prop] };
      if (c.pattern) field.pattern = c.pattern;
      if (c.hidden) field.hidden = true;
      if (c.retired) field.retired = true;
      defs.push(field);
    }
  });
  const fields = defs.map((def) => {
    const field: ResolvedField = { ...def, texts: { ...def.texts } };
    for (const layer of layers) {
      const o = layer?.fields[def.key];
      if (!o) continue;
      for (const [prop, value] of Object.entries(o)) {
        if ((TEXT_PROPS as readonly string[]).includes(prop)) {
          const p = prop as (typeof TEXT_PROPS)[number];
          field.texts[p] = { ...field.texts[p], ...(value as Texts) };
        } else {
          (field as unknown as Record<string, unknown>)[prop] = value;
        }
      }
    }
    return field;
  });
  const groups = form.groups.map((def) => {
    const group: ResolvedGroup = { ...def, texts: {} };
    for (const layer of layers) {
      const o = layer?.groups?.[def.key];
      if (!o) continue;
      if (o.caption) group.texts.caption = { ...group.texts.caption, ...o.caption };
      if (o.order !== undefined) group.order = o.order;
    }
    return group;
  });
  return { id: form.id, groups: groups.sort((a, b) => a.order - b.order), fields };
}

/** The shown text: template text in the language, else the dictionary (via `t`), which falls back to English. */
export function resolveText(texts: Texts | undefined, key: string | undefined, locale: string, t: (key: string) => string): string {
  const own = texts?.[locale];
  if (own) return own;
  return key ? t(key) : (texts?.en ?? '');
}

export type OverrideCheck<T> = { ok: true; value: T } | { ok: false; reason: string; property?: string };

const LANG_RE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Texts with valid language codes and non-empty strings; empty strings are dropped. */
function checkTexts(v: unknown, maxLength: number): Texts | null {
  if (!isPlainObject(v)) return null;
  const out: Texts = {};
  for (const [lang, text] of Object.entries(v)) {
    if (!LANG_RE.test(lang) || typeof text !== 'string' || text.length > maxLength) return null;
    if (text.trim() !== '') out[lang] = text;
  }
  return out;
}

function isValidDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
}

/** A min/max bound of the right kind for the type: a number for `number`, a date for `date`/`datetime`. */
function isBound(type: FieldType, v: unknown): boolean {
  if (type === 'number') return typeof v === 'number' && Number.isFinite(v);
  if (type === 'date' || type === 'datetime') return typeof v === 'string' && isValidDate(v);
  return false;
}

/** Compares two bounds of the same kind (numbers, or ISO dates as strings). */
function compareBound(a: number | string, b: number | string): number {
  return typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b));
}

/** Compiles a template regex, or null if it is too long or does not compile. */
export function compilePattern(pattern: string): RegExp | null {
  if (pattern.length === 0 || pattern.length > 200) return null;
  try {
    return new RegExp(`^(?:${pattern})$`, 'u');
  } catch {
    return null;
  }
}

/**
 * Checks one layer's override of a code-defined field before it is saved. Locked and "stricter
 * only" rules are measured against the code registry, so no layer can loosen what the code sets.
 */
export function checkFieldOverride(form: FormDef, fieldKey: string, input: unknown): OverrideCheck<FieldOverride> {
  const def = form.fields.find((f) => f.key === fieldKey);
  if (!def) return { ok: false, reason: 'unknown-field' };
  if (!isPlainObject(input)) return { ok: false, reason: 'not-an-object' };
  const out: FieldOverride = {};
  const fail = (reason: string, property: string): OverrideCheck<FieldOverride> => ({ ok: false, reason, property });
  const type = (input.type ?? def.type) as FieldType;

  for (const [prop, v] of Object.entries(input)) {
    if (v === undefined || v === null) continue;
    switch (prop) {
      case 'caption':
      case 'tooltip':
      case 'placeholder':
      case 'patternMessage': {
        const texts = checkTexts(v, prop === 'tooltip' ? 1000 : 200);
        if (!texts) return fail('invalid-value', prop);
        out[prop] = texts;
        break;
      }
      case 'group':
        if (typeof v !== 'string' || !form.groups.some((g) => g.key === v)) return fail('unknown-group', prop);
        out.group = v;
        break;
      case 'order':
        if (!Number.isInteger(v) || (v as number) < 0 || (v as number) > 100_000) return fail('invalid-value', prop);
        out.order = v as number;
        break;
      case 'newRow':
      case 'required':
      case 'hidden':
        if (typeof v !== 'boolean') return fail('invalid-value', prop);
        if (prop === 'required' && v === false && def.required) return fail('loosens-code', prop);
        if (prop === 'hidden' && v === true && !def.optional) return fail('not-hideable', prop);
        out[prop] = v;
        break;
      case 'width':
        if (!(WIDTHS as readonly unknown[]).includes(v)) return fail('invalid-value', prop);
        out.width = v as Width;
        break;
      case 'height':
        if (!Number.isInteger(v) || (v as number) < 1 || (v as number) > 6) return fail('invalid-value', prop);
        if (type !== 'text') return fail('height-needs-text', prop);
        out.height = v as number;
        break;
      case 'type': {
        const allowed = v === def.type || (!def.locked?.includes('type') && !def.readOnly && (def.allowedTypes ?? []).includes(v as FieldType));
        if (!allowed) return fail('type-not-allowed', prop);
        out.type = v as FieldType;
        break;
      }
      case 'validator':
        if (!(VALIDATORS as readonly unknown[]).includes(v)) return fail('invalid-value', prop);
        if (def.validator && v !== def.validator) return fail('loosens-code', prop);
        out.validator = v as string;
        break;
      case 'pattern':
        if (typeof v !== 'string' || !compilePattern(v)) return fail('bad-pattern', prop);
        out.pattern = v;
        break;
      case 'min':
      case 'max': {
        if (!isBound(type, v)) return fail('invalid-value', prop);
        const code = def[prop];
        if (code !== undefined) {
          const c = compareBound(v as number | string, code);
          if ((prop === 'min' && c < 0) || (prop === 'max' && c > 0)) return fail('loosens-code', prop);
        }
        out[prop] = v as number | string;
        break;
      }
      default:
        return fail('unknown-property', prop);
    }
  }

  if (def.readOnly && (out.required !== undefined || out.validator || out.pattern || out.min !== undefined || out.max !== undefined)) {
    return { ok: false, reason: 'read-only' };
  }
  if (out.pattern && !out.patternMessage?.en) return { ok: false, reason: 'pattern-message-missing', property: 'patternMessage' };
  if (out.min !== undefined && out.max !== undefined && compareBound(out.min, out.max) > 0) return { ok: false, reason: 'min-above-max', property: 'min' };
  return { ok: true, value: out };
}

/** Checks one layer's group overrides (titles and order of the form's sections). */
export function checkGroupsOverride(form: FormDef, input: unknown): OverrideCheck<Record<string, GroupOverride>> {
  if (!isPlainObject(input)) return { ok: false, reason: 'not-an-object' };
  const out: Record<string, GroupOverride> = {};
  for (const [key, o] of Object.entries(input)) {
    if (!form.groups.some((g) => g.key === key)) return { ok: false, reason: 'unknown-group', property: key };
    if (!isPlainObject(o)) return { ok: false, reason: 'not-an-object', property: key };
    const g: GroupOverride = {};
    for (const [prop, v] of Object.entries(o)) {
      if (prop === 'caption') {
        const texts = checkTexts(v, 200);
        if (!texts) return { ok: false, reason: 'invalid-value', property: `${key}.caption` };
        g.caption = texts;
      } else if (prop === 'order') {
        if (!Number.isInteger(v) || (v as number) < 0 || (v as number) > 100_000) return { ok: false, reason: 'invalid-value', property: `${key}.order` };
        g.order = v as number;
      } else {
        return { ok: false, reason: 'unknown-property', property: `${key}.${prop}` };
      }
    }
    out[key] = g;
  }
  return { ok: true, value: out };
}

/**
 * Checks a new custom key against the form: the key format, the code's fields and reserved keys,
 * and the custom fields already known (`taken`, including retired ones, whose keys are never reused).
 */
export function checkCustomKey(form: FormDef, key: string, taken: Iterable<string>): { ok: true } | { ok: false; reason: string } {
  if (!form.customStorage) return { ok: false, reason: 'no-custom-fields' };
  if (!CUSTOM_KEY_RE.test(key)) return { ok: false, reason: 'bad-key' };
  if (form.fields.some((f) => f.key === key) || (form.reservedKeys ?? []).includes(key) || [...taken].includes(key)) {
    return { ok: false, reason: 'key-taken' };
  }
  return { ok: true };
}

/**
 * Checks a custom field's definition before it is saved. `previous` is the saved definition, if
 * any: a saved field may only change its type along `CUSTOM_TYPE_CHANGES`. The key itself is
 * checked separately (`checkCustomKey`) when the field is created.
 */
export function checkCustomField(form: FormDef, key: string, input: unknown, previous?: CustomFieldDef): OverrideCheck<CustomFieldDef> {
  if (!form.customStorage) return { ok: false, reason: 'no-custom-fields' };
  if (!isPlainObject(input)) return { ok: false, reason: 'not-an-object' };
  const { type, editableBy, retired, ...rest } = input;
  if (!(ENTRY_TYPES as readonly unknown[]).includes(type)) return { ok: false, reason: 'invalid-value', property: 'type' };
  if (previous && type !== previous.type && !CUSTOM_TYPE_CHANGES[previous.type].includes(type as EntryType)) {
    return { ok: false, reason: 'type-not-allowed', property: 'type' };
  }
  if (editableBy !== undefined && editableBy !== 'self' && editableBy !== 'hr') return { ok: false, reason: 'invalid-value', property: 'editableBy' };
  if (editableBy === 'self' && !form.selfService) return { ok: false, reason: 'invalid-value', property: 'editableBy' };
  if (retired !== undefined && typeof retired !== 'boolean') return { ok: false, reason: 'invalid-value', property: 'retired' };

  // Every other property follows the override rules, measured against an unconstrained field of this type.
  const blank: FieldDef = { key, storage: { kind: 'json', table: '', column: '', key }, type: type as EntryType, caption: '', group: '', order: 0, width: 'm', optional: true, editableBy: 'hr' };
  const r = checkFieldOverride({ ...form, fields: [blank] }, key, { ...rest, type });
  if (!r.ok) return r;
  if (!r.value.caption?.en) return { ok: false, reason: 'caption-missing', property: 'caption' };
  if (!r.value.group) return { ok: false, reason: 'unknown-group', property: 'group' };

  const out: CustomFieldDef = { ...r.value, type: type as EntryType };
  if (form.selfService) out.editableBy = (editableBy as EditableBy | undefined) ?? 'hr';
  if (retired) out.retired = true;
  return { ok: true, value: out };
}

// ---------------------------------------------------------------------------
// Validating values (same rules in the browser and the API)
// ---------------------------------------------------------------------------

/** One failed rule: `rule` is `required`, `type`, `min`, `max`, `pattern` or a validator name. */
export interface FieldError {
  field: string;
  rule: string;
}

/** Validates and normalizes a value with a named validator; `null` if it is invalid. */
export function applyValidator(name: string, value: string): string | null {
  switch (name) {
    case 'email': {
      const v = value.trim();
      const at = v.lastIndexOf('@');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return null;
      return v.slice(0, at) + v.slice(at).toLowerCase();
    }
    case 'phone': {
      const v = value.replace(/[\s\-./()]/g, '');
      return /^(\+|00)?\d{6,15}$/.test(v) ? v : null;
    }
    case 'iban': {
      const v = value.replace(/\s/g, '').toUpperCase();
      if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(v)) return null;
      const digits = (v.slice(4) + v.slice(0, 4)).replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
      let rest = 0;
      for (const d of digits) rest = (rest * 10 + Number(d)) % 97;
      return rest === 1 ? v : null;
    }
    case 'postcode:CH': {
      const v = value.trim();
      return /^[1-9]\d{3}$/.test(v) ? v : null;
    }
    case 'ahv': {
      const v = value.replace(/[\s.]/g, '');
      if (!/^756\d{10}$/.test(v)) return null;
      let sum = 0;
      for (let i = 0; i < 12; i++) sum += Number(v[i]) * (i % 2 === 0 ? 1 : 3);
      if ((10 - (sum % 10)) % 10 !== Number(v[12])) return null;
      return `${v.slice(0, 3)}.${v.slice(3, 7)}.${v.slice(7, 11)}.${v.slice(11)}`;
    }
    case 'currency': {
      // ISO 4217 shape only (three letters); the list of real codes is not checked.
      const v = value.trim().toUpperCase();
      return /^[A-Z]{3}$/.test(v) ? v : null;
    }
    default:
      return null;
  }
}

function isEmptyValue(v: unknown): boolean {
  return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
}

/** Validates one value against a resolved field. Returns the normalized value or the failed rule. */
export function validateValue(field: ResolvedField, value: unknown): { ok: true; value: unknown } | { ok: false; rule: string } {
  if (isEmptyValue(value)) {
    if (field.required && !field.hidden) return { ok: false, rule: 'required' };
    return { ok: true, value };
  }
  let v: unknown = value;
  switch (field.type) {
    case 'checkbox':
      if (typeof v !== 'boolean') return { ok: false, rule: 'type' };
      break;
    case 'number':
      if (typeof v !== 'number' || !Number.isFinite(v)) return { ok: false, rule: 'type' };
      break;
    case 'date':
      if (typeof v !== 'string' || !isValidDate(v)) return { ok: false, rule: 'type' };
      break;
    case 'datetime': {
      const d = typeof v === 'string' ? new Date(v) : null;
      if (!d || Number.isNaN(d.getTime())) return { ok: false, rule: 'type' };
      v = d.toISOString();
      break;
    }
    default:
      if (typeof v !== 'string') return { ok: false, rule: 'type' };
  }

  if (field.min !== undefined || field.max !== undefined) {
    const comparable = field.type === 'datetime' ? String(v).slice(0, 10) : (v as number | string);
    if (field.min !== undefined && compareBound(comparable, field.min) < 0) return { ok: false, rule: 'min' };
    if (field.max !== undefined && compareBound(comparable, field.max) > 0) return { ok: false, rule: 'max' };
  }
  if (typeof v === 'string' && field.validator) {
    const normalized = applyValidator(field.validator, v);
    if (normalized === null) return { ok: false, rule: field.validator };
    v = normalized;
  }
  if (typeof v === 'string' && field.pattern) {
    const re = compilePattern(field.pattern);
    if (re && !re.test(v)) return { ok: false, rule: 'pattern' };
  }
  return { ok: true, value: v };
}

/**
 * Validates the form's fields present in `patch`. Keys the form does not define (nested lists such
 * as bankAccounts) pass through unchanged; the caller decides which keys are accepted at all.
 * A field missing from the patch is not checked, so partial saves work.
 */
export function validateFields(form: ResolvedForm, patch: Record<string, unknown>): { errors: FieldError[]; values: Record<string, unknown> } {
  const errors: FieldError[] = [];
  const values: Record<string, unknown> = { ...patch };
  for (const field of form.fields) {
    if (!(field.key in patch) || field.retired) continue;
    const r = validateValue(field, patch[field.key]);
    if (r.ok) values[field.key] = r.value;
    else errors.push({ field: field.key, rule: r.rule });
  }
  return { errors, values };
}

/**
 * Keys of the form's writable fields the given editor may change: `self` fields for a change
 * request, all for HR. Retired custom fields are never written.
 */
export function editableKeys(form: { fields: (FieldDef & { retired?: boolean })[] }, editor: EditableBy): string[] {
  return form.fields.filter((f) => !f.readOnly && !f.retired && (editor === 'hr' || f.editableBy === 'self')).map((f) => f.key);
}

/** Keys of the custom fields an org template defines (stored in that org's own section). */
export function orgCustomKeys(form: ResolvedForm): string[] {
  return form.fields.filter((f) => f.custom === 'org').map((f) => f.key);
}
