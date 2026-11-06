/**
 * Editing a form template layer in design mode (docs/FIELD_CONFIG.md, step 4): pure functions on
 * `FormLayer` drafts, kept free of JSX so Node can test them. Every function returns a new layer.
 */
import {
  CUSTOM_TYPE_CHANGES,
  ENTRY_TYPES,
  GROUPS_KEY,
  checkCustomField,
  checkCustomKey,
  checkFieldOverride,
  checkGroupsOverride,
  formFields,
  formWithCustom,
  type CustomFieldDef,
  type EditableBy,
  type EntryType,
  type FieldDef,
  type FieldOverride,
  type FormDef,
  type FormLayer,
  type GroupOverride,
  type ResolvedForm,
  type Texts,
} from '@worktime3/shared/fields';

export type Scope = 'global' | 'org';
export type Layers = Record<Scope, FormLayer>;
/** Where a property's value comes from. */
export type Source = 'code' | Scope;

export const TEXT_PROPS = ['caption', 'tooltip', 'placeholder', 'patternMessage'] as const;
export type TextProp = (typeof TEXT_PROPS)[number];

export function emptyLayer(): FormLayer {
  return { fields: {}, groups: {}, custom: {} };
}

/** A field's config in one layer: an override, or a custom field's definition. */
export type FieldConfig = FieldOverride & { editableBy?: EditableBy; retired?: boolean };
export type FieldProp = keyof FieldConfig;

/** The layer's config for a field: its custom definition if this layer defines the field, else its override. */
export function fieldConfig(layer: FormLayer, fieldKey: string): FieldConfig | undefined {
  return layer.custom?.[fieldKey] ?? layer.fields[fieldKey];
}

/** True if the layer defines `fieldKey` as a custom field. */
export function isCustomIn(layer: FormLayer, fieldKey: string): boolean {
  return !!layer.custom?.[fieldKey];
}

export function cloneLayers(layers: Layers): Layers {
  return JSON.parse(JSON.stringify(layers)) as Layers;
}

/** The most specific layer that sets `prop` on the field. */
export function propertySource(layers: Layers, fieldKey: string, prop: FieldProp): Source {
  if (fieldConfig(layers.org, fieldKey)?.[prop] !== undefined) return 'org';
  if (fieldConfig(layers.global, fieldKey)?.[prop] !== undefined) return 'global';
  return 'code';
}

function withField(layer: FormLayer, fieldKey: string, config: FieldOverride): FormLayer {
  const fields = { ...layer.fields };
  if (Object.keys(config).length === 0) delete fields[fieldKey];
  else fields[fieldKey] = config;
  return { ...layer, fields };
}

/**
 * Sets one property of a field; `undefined` removes it, so the field inherits it again. For a
 * custom field this layer defines, the definition itself changes.
 */
export function setFieldProp<K extends FieldProp>(layer: FormLayer, fieldKey: string, prop: K, value: FieldConfig[K] | undefined): FormLayer {
  const custom = layer.custom?.[fieldKey];
  if (custom) {
    const def: Record<string, unknown> = { ...custom };
    if (value === undefined) delete def[prop];
    else def[prop] = value;
    return { ...layer, custom: { ...layer.custom, [fieldKey]: def as unknown as CustomFieldDef } };
  }
  if (prop === 'editableBy' || prop === 'retired') return layer;
  const config: FieldOverride = { ...layer.fields[fieldKey] };
  const p = prop as keyof FieldOverride;
  if (value === undefined) delete config[p];
  else (config as Record<string, unknown>)[p] = value;
  return withField(layer, fieldKey, config);
}

function withText(texts: Texts | undefined, lang: string, value: string): Texts | undefined {
  const next: Texts = { ...texts };
  if (value.trim() === '') delete next[lang];
  else next[lang] = value;
  return Object.keys(next).length === 0 ? undefined : next;
}

/** Sets one language of a field's text property; an empty value removes that language. */
export function setFieldText(layer: FormLayer, fieldKey: string, prop: TextProp, lang: string, value: string): FormLayer {
  return setFieldProp(layer, fieldKey, prop, withText(fieldConfig(layer, fieldKey)?.[prop], lang, value));
}

function withGroup(layer: FormLayer, groupKey: string, config: GroupOverride): FormLayer {
  const groups = { ...layer.groups };
  if (Object.keys(config).length === 0) delete groups[groupKey];
  else groups[groupKey] = config;
  return { ...layer, groups };
}

/** Sets one language of a group title. */
export function setGroupText(layer: FormLayer, groupKey: string, lang: string, value: string): FormLayer {
  const config: GroupOverride = { ...layer.groups?.[groupKey] };
  const caption = withText(config.caption, lang, value);
  if (caption) config.caption = caption;
  else delete config.caption;
  return withGroup(layer, groupKey, config);
}

/**
 * Moves a field to `group`, before `beforeKey` (or to the end), and renumbers that group's fields
 * 10, 20, 30… Only fields whose position actually changes get an `order` in the layer.
 */
export function moveField(form: ResolvedForm, layer: FormLayer, fieldKey: string, group: string, beforeKey: string | null): FormLayer {
  const field = form.fields.find((f) => f.key === fieldKey);
  if (!field || fieldKey === beforeKey) return layer;
  const keys = formFields(form, group).map((f) => f.key).filter((k) => k !== fieldKey);
  const at = beforeKey === null ? -1 : keys.indexOf(beforeKey);
  keys.splice(at < 0 ? keys.length : at, 0, fieldKey);

  let next = layer;
  if (field.group !== group) next = setFieldProp(next, fieldKey, 'group', group);
  keys.forEach((key, i) => {
    const order = (i + 1) * 10;
    if (form.fields.find((f) => f.key === key)?.order !== order) next = setFieldProp(next, key, 'order', order);
  });
  return next;
}

/** Moves a field one place up (-1) or down (+1) within its group. */
export function nudgeField(form: ResolvedForm, layer: FormLayer, fieldKey: string, delta: -1 | 1): FormLayer {
  const field = form.fields.find((f) => f.key === fieldKey);
  if (!field) return layer;
  const keys = formFields(form, field.group).map((f) => f.key);
  const i = keys.indexOf(fieldKey);
  const j = i + delta;
  if (j < 0 || j >= keys.length) return layer;
  keys.splice(i, 1);
  keys.splice(j, 0, fieldKey);
  const beforeKey = keys[j + 1] ?? null;
  return moveField(form, layer, fieldKey, field.group, beforeKey);
}

/** Moves a section one place up or down, renumbering the sections 10, 20, 30… */
export function nudgeGroup(form: ResolvedForm, layer: FormLayer, groupKey: string, delta: -1 | 1): FormLayer {
  const keys = form.groups.map((g) => g.key);
  const i = keys.indexOf(groupKey);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= keys.length) return layer;
  keys.splice(i, 1);
  keys.splice(j, 0, groupKey);
  let next = layer;
  keys.forEach((key, n) => {
    const order = (n + 1) * 10;
    if (form.groups.find((g) => g.key === key)?.order !== order) next = withGroup(next, key, { ...next.groups?.[key], order });
  });
  return next;
}

/** The `field_config` keys (field keys, or `$groups`) whose config differs between two layers. */
export function changedKeys(saved: FormLayer, draft: FormLayer): string[] {
  const out: string[] = [];
  const same = (a: unknown, b: unknown) => JSON.stringify(a ?? {}) === JSON.stringify(b ?? {});
  const keys = new Set([...Object.keys(saved.fields), ...Object.keys(draft.fields), ...Object.keys(saved.custom ?? {}), ...Object.keys(draft.custom ?? {})]);
  for (const key of keys) {
    if (!same(sortKeys(fieldConfig(saved, key)), sortKeys(fieldConfig(draft, key)))) out.push(key);
  }
  if (!same(sortKeys(saved.groups), sortKeys(draft.groups))) out.push(GROUPS_KEY);
  return out;
}

/** A copy with object keys sorted at every level, so key order never counts as a change. */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((k) => [k, sortKeys((value as Record<string, unknown>)[k])]));
  }
  return value;
}

/** What to send for one changed key: the field's config, or the groups map for `$groups`. */
export function configFor(layer: FormLayer, key: string): unknown {
  return key === GROUPS_KEY ? (layer.groups ?? {}) : (fieldConfig(layer, key) ?? {});
}

/** Adds a custom field at the end of `group`, with its English caption. */
export function addCustomField(form: ResolvedForm, layer: FormLayer, key: string, type: EntryType, group: string, captionEn: string): FormLayer {
  const last = formFields(form, group).at(-1)?.order ?? 0;
  const def: CustomFieldDef = { type, group, order: last + 10, caption: { en: captionEn } };
  return { ...layer, custom: { ...layer.custom, [key]: def } };
}

/** Drops a custom field that was never saved (a saved one is retired instead). */
export function removeCustomField(layer: FormLayer, key: string): FormLayer {
  const custom = { ...layer.custom };
  delete custom[key];
  return { ...layer, custom };
}

/**
 * The definition the panel measures a field's edits against in `scope`: for a custom field this
 * scope defines, an unconstrained field whose type may change as `CUSTOM_TYPE_CHANGES` allows once
 * saved; otherwise the code field, or (editing an org) the global template's custom field.
 */
export function designDef(formDef: FormDef, saved: Layers, draft: Layers, scope: Scope, key: string): FieldDef | undefined {
  const custom = draft[scope].custom?.[key];
  if (custom) {
    const savedType = saved[scope].custom?.[key]?.type;
    return {
      key,
      storage: { kind: 'json', table: '', column: '', key },
      type: savedType ?? custom.type,
      allowedTypes: savedType ? CUSTOM_TYPE_CHANGES[savedType] : [...ENTRY_TYPES],
      caption: '',
      group: custom.group ?? '',
      order: custom.order ?? 0,
      width: 'm',
      optional: true,
      editableBy: custom.editableBy ?? 'hr',
    };
  }
  return (scope === 'org' ? formWithCustom(formDef, draft.global) : formDef).fields.find((f) => f.key === key);
}

/** A failed save or check for one `field_config` key. */
export interface DesignError {
  scope: Scope;
  key: string;
  reason: string;
  property?: string;
}

/** Problems with the draft layers, by the same checks the API runs on save. */
export function checkLayers(formDef: FormDef, saved: Layers, draft: Layers): DesignError[] {
  const out: DesignError[] = [];
  for (const scope of ['global', 'org'] as Scope[]) {
    const other = scope === 'org' ? 'global' : 'org';
    for (const key of changedKeys(saved[scope], draft[scope])) {
      const config = configFor(draft[scope], key);
      let r: { ok: true } | { ok: false; reason: string; property?: string };
      if (key === GROUPS_KEY) {
        r = checkGroupsOverride(formDef, config);
      } else if (isCustomIn(draft[scope], key)) {
        const previous = saved[scope].custom?.[key];
        // A new key must be free: the other layer's custom fields and this layer's overrides take keys too.
        r = previous ? { ok: true } : checkCustomKey(formDef, key, [...Object.keys(draft[other].custom ?? {}), ...Object.keys(draft[scope].fields)]);
        if (r.ok) r = checkCustomField(formDef, key, config, previous);
      } else if (!config || Object.keys(config as object).length === 0) {
        continue; // reset to inherited, or a never-saved custom field that was removed again
      } else {
        r = checkFieldOverride(scope === 'org' ? formWithCustom(formDef, draft.global) : formDef, key, config);
      }
      if (!r.ok) out.push({ scope, key, reason: r.reason, property: r.property });
    }
  }
  return out;
}
