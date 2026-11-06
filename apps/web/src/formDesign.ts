/**
 * Editing a form template layer in design mode (docs/FIELD_CONFIG.md, step 4): pure functions on
 * `FormLayer` drafts, kept free of JSX so Node can test them. Every function returns a new layer.
 */
import { GROUPS_KEY, formFields, type FieldOverride, type FormLayer, type GroupOverride, type ResolvedForm, type Texts } from '@worktime3/shared/fields';

export type Scope = 'global' | 'org';
export type Layers = Record<Scope, FormLayer>;
/** Where a property's value comes from. */
export type Source = 'code' | Scope;

export const TEXT_PROPS = ['caption', 'tooltip', 'placeholder', 'patternMessage'] as const;
export type TextProp = (typeof TEXT_PROPS)[number];

export function emptyLayer(): FormLayer {
  return { fields: {}, groups: {} };
}

export function cloneLayers(layers: Layers): Layers {
  return JSON.parse(JSON.stringify(layers)) as Layers;
}

/** The most specific layer that sets `prop` on the field. */
export function propertySource(layers: Layers, fieldKey: string, prop: keyof FieldOverride): Source {
  if (layers.org.fields[fieldKey]?.[prop] !== undefined) return 'org';
  if (layers.global.fields[fieldKey]?.[prop] !== undefined) return 'global';
  return 'code';
}

function withField(layer: FormLayer, fieldKey: string, config: FieldOverride): FormLayer {
  const fields = { ...layer.fields };
  if (Object.keys(config).length === 0) delete fields[fieldKey];
  else fields[fieldKey] = config;
  return { ...layer, fields };
}

/** Sets one property of a field; `undefined` removes it, so the field inherits it again. */
export function setFieldProp<K extends keyof FieldOverride>(layer: FormLayer, fieldKey: string, prop: K, value: FieldOverride[K] | undefined): FormLayer {
  const config: FieldOverride = { ...layer.fields[fieldKey] };
  if (value === undefined) delete config[prop];
  else config[prop] = value;
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
  return setFieldProp(layer, fieldKey, prop, withText(layer.fields[fieldKey]?.[prop], lang, value));
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
  for (const key of new Set([...Object.keys(saved.fields), ...Object.keys(draft.fields)])) {
    if (!same(sortKeys(saved.fields[key]), sortKeys(draft.fields[key]))) out.push(key);
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
  return key === GROUPS_KEY ? (layer.groups ?? {}) : (layer.fields[key] ?? {});
}
