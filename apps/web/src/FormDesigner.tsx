import { useState, type DragEvent, type ReactNode } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  MenuItem,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  ENTRY_TYPES,
  GROUPS_KEY,
  VALIDATORS,
  WIDTHS,
  checkCustomKey,
  formFields,
  resolveText,
  type EditableBy,
  type EntryType,
  type FieldType,
  type ResolvedField,
  type Width,
} from '@worktime3/shared/fields';
import { useI18n, type TFunction } from './i18n';
import { DICTIONARIES, type Locale } from './dictionaries';
import {
  addCustomField,
  designDef,
  fieldConfig,
  isCustomIn,
  moveField,
  nudgeField,
  nudgeGroup,
  propertySource,
  removeCustomField,
  setFieldProp,
  setFieldText,
  setGroupText,
  type FieldConfig,
  type FieldProp,
  type TextProp,
} from './formDesign';
import type { DesignError, FormDesigner } from './designMode';

/** Width of the side panel on screens wide enough to show it next to the form. */
export const DESIGN_PANEL_WIDTH = 420;

const LANGUAGES = Object.keys(DICTIONARIES) as Locale[];

/** The text a language shows when the edited layer sets none: the layer below, else the dictionary. */
function inheritedText(designer: FormDesigner, fieldKey: string, prop: TextProp, i18nKey: string | undefined, lang: Locale): string {
  if (designer.scope === 'org') {
    const global = fieldConfig(designer.draft.global, fieldKey)?.[prop]?.[lang];
    if (global) return global;
  }
  const key = prop === 'patternMessage' ? 'validation.pattern' : i18nKey;
  return key ? (DICTIONARIES[lang][key] ?? '') : '';
}

function errorLine(e: DesignError, designer: FormDesigner, t: TFunction, locale: string): string {
  const field = designer.preview.fields.find((f) => f.key === e.key);
  const name = e.key === GROUPS_KEY ? t('design.structure') : field ? resolveText(field.texts.caption, field.caption, locale, t) : e.key;
  const scope = t(`design.scope.${e.scope}`);
  const property = e.property && !e.property.includes('.') ? ` (${t(`design.prop.${e.property}`)})` : '';
  return `${name}${property}, ${scope}: ${t(`design.reason.${e.reason}`)}`;
}

/** One property row: label, control, where the value comes from, and a reset button. */
function PropRow({ designer, field, prop, label, children }: { designer: FormDesigner; field: ResolvedField; prop: FieldProp; label: string; children: ReactNode }) {
  const { t } = useI18n();
  const source = propertySource(designer.draft, field.key, prop);
  // A custom field's type and section are part of its definition and cannot be reset.
  const fixed = isCustomIn(designer.draft[designer.scope], field.key) && (prop === 'type' || prop === 'group');
  const setHere = !fixed && fieldConfig(designer.draft[designer.scope], field.key)?.[prop] !== undefined;
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: '110px 1fr auto', alignItems: 'center', gap: 1, py: 0.5 }}>
      <Typography variant="body2" color="text.secondary">{label}</Typography>
      <Box sx={{ minWidth: 0 }}>{children}</Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
        <Chip size="small" variant={source === 'code' ? 'outlined' : 'filled'} color={source === 'org' ? 'primary' : source === 'global' ? 'secondary' : 'default'} label={t(`design.source.${source}`)} />
        <Tooltip title={t('design.reset')}>
          <span>
            <IconButton size="small" aria-label={t('design.reset')} disabled={!setHere} onClick={() => designer.update((l) => setFieldProp(l, field.key, prop, undefined))}>↺</IconButton>
          </span>
        </Tooltip>
      </Box>
    </Box>
  );
}

function FieldProperties({ designer, field }: { designer: FormDesigner; field: ResolvedField }) {
  const { t, locale } = useI18n();
  const def = designDef(designer.formDef, designer.saved, designer.draft, designer.scope, field.key);
  const set = <K extends FieldProp>(prop: K, value: FieldConfig[K]) => designer.update((l) => setFieldProp(l, field.key, prop, value));
  if (!def) return null;
  const ownCustom = isCustomIn(designer.draft[designer.scope], field.key);
  const types = [def.type, ...(def.allowedTypes ?? []).filter((x) => x !== def.type)] as FieldType[];
  const hasBounds = field.type === 'number' || field.type === 'date' || field.type === 'datetime';
  const boundInput = field.type === 'number' ? 'number' : 'date';
  const parseBound = (v: string) => (v === '' ? undefined : field.type === 'number' ? Number(v) : v);

  return (
    <Box>
      <PropRow designer={designer} field={field} prop="group" label={t('design.prop.group')}>
        <TextField select size="small" fullWidth value={field.group} onChange={(e) => designer.update((l) => moveField(designer.preview, l, field.key, e.target.value, null))}>
          {designer.preview.groups.map((g) => (<MenuItem key={g.key} value={g.key}>{resolveText(g.texts.caption, g.caption, locale, t)}</MenuItem>))}
        </TextField>
      </PropRow>
      <PropRow designer={designer} field={field} prop="newRow" label={t('design.prop.newRow')}>
        <Switch size="small" checked={!!field.newRow} onChange={(e) => set('newRow', e.target.checked)} />
      </PropRow>
      <PropRow designer={designer} field={field} prop="width" label={t('design.prop.width')}>
        <ToggleButtonGroup size="small" exclusive value={field.width} onChange={(_, v: Width | null) => v && set('width', v)}>
          {WIDTHS.map((w) => (<ToggleButton key={w} value={w} sx={{ px: 1, py: 0.25 }}>{t(`design.width.${w}`)}</ToggleButton>))}
        </ToggleButtonGroup>
      </PropRow>
      {field.type === 'text' && (
        <PropRow designer={designer} field={field} prop="height" label={t('design.prop.height')}>
          <TextField select size="small" value={field.height ?? 1} onChange={(e) => set('height', Number(e.target.value))} sx={{ width: 80 }}>
            {[1, 2, 3, 4, 5, 6].map((n) => (<MenuItem key={n} value={n}>{n}</MenuItem>))}
          </TextField>
        </PropRow>
      )}
      <PropRow designer={designer} field={field} prop="type" label={t('design.prop.type')}>
        <TextField select size="small" fullWidth value={field.type} disabled={types.length < 2} onChange={(e) => set('type', e.target.value as FieldType)}>
          {types.map((x) => (<MenuItem key={x} value={x}>{t(`design.type.${x}`)}</MenuItem>))}
        </TextField>
      </PropRow>
      {ownCustom && designer.formDef.selfService && (
        <PropRow designer={designer} field={field} prop="editableBy" label={t('design.prop.editableBy')}>
          <TextField select size="small" fullWidth value={field.editableBy} onChange={(e) => set('editableBy', e.target.value as EditableBy)}>
            <MenuItem value="hr">{t('design.editableBy.hr')}</MenuItem>
            <MenuItem value="self">{t('design.editableBy.self')}</MenuItem>
          </TextField>
        </PropRow>
      )}
      <PropRow designer={designer} field={field} prop="hidden" label={t('design.prop.hidden')}>
        <Tooltip title={def.optional ? '' : t('design.reason.not-hideable')}>
          <span><Switch size="small" checked={!!field.hidden} disabled={!def.optional} onChange={(e) => set('hidden', e.target.checked)} /></span>
        </Tooltip>
      </PropRow>
      {!def.readOnly && (
        <>
          <PropRow designer={designer} field={field} prop="required" label={t('design.prop.required')}>
            <Tooltip title={def.required ? t('design.lockedByCode') : ''}>
              <span><Switch size="small" checked={!!field.required} disabled={def.required} onChange={(e) => set('required', e.target.checked)} /></span>
            </Tooltip>
          </PropRow>
          {(field.type === 'text' || field.type === 'select') && (
            <>
              <PropRow designer={designer} field={field} prop="validator" label={t('design.prop.validator')}>
                <TextField select size="small" fullWidth value={field.validator ?? ''} disabled={!!def.validator} onChange={(e) => set('validator', e.target.value || undefined)}>
                  <MenuItem value="">{t('design.validator.none')}</MenuItem>
                  {VALIDATORS.map((v) => (<MenuItem key={v} value={v}>{t(`design.validator.${v}`)}</MenuItem>))}
                </TextField>
              </PropRow>
              <PropRow designer={designer} field={field} prop="pattern" label={t('design.prop.pattern')}>
                <TextField size="small" fullWidth value={field.pattern ?? ''} placeholder="^[A-Z]{2}\d+$" onChange={(e) => set('pattern', e.target.value || undefined)} slotProps={{ htmlInput: { style: { fontFamily: 'monospace' } } }} />
              </PropRow>
            </>
          )}
          {hasBounds && (
            <>
              <PropRow designer={designer} field={field} prop="min" label={t('design.prop.min')}>
                <TextField size="small" fullWidth type={boundInput} value={field.min ?? ''} onChange={(e) => set('min', parseBound(e.target.value))} />
              </PropRow>
              <PropRow designer={designer} field={field} prop="max" label={t('design.prop.max')}>
                <TextField size="small" fullWidth type={boundInput} value={field.max ?? ''} onChange={(e) => set('max', parseBound(e.target.value))} />
              </PropRow>
            </>
          )}
        </>
      )}
    </Box>
  );
}

/** One row per text, one column per language; the inherited text shows as placeholder. */
function FieldTexts({ designer, field }: { designer: FormDesigner; field: ResolvedField }) {
  const { t } = useI18n();
  const layer = fieldConfig(designer.draft[designer.scope], field.key) ?? {};
  // A custom field needs its English caption; there is no dictionary text to fall back to.
  const needsEnglish = isCustomIn(designer.draft[designer.scope], field.key);
  const rows: { prop: TextProp; key?: string }[] = [
    { prop: 'caption', key: field.caption },
    { prop: 'tooltip', key: field.tooltip },
    { prop: 'placeholder', key: field.placeholder },
  ];
  if (field.pattern) rows.push({ prop: 'patternMessage' });

  return (
    <Table size="small" sx={{ '& td, & th': { px: 0.5 } }}>
      <TableHead>
        <TableRow>
          <TableCell />
          {LANGUAGES.map((lang) => (<TableCell key={lang}>{lang.toUpperCase()}</TableCell>))}
        </TableRow>
      </TableHead>
      <TableBody>
        {rows.map(({ prop, key }) => {
          const texts = layer[prop];
          const started = !!texts && Object.keys(texts).length > 0;
          return (
            <TableRow key={prop}>
              <TableCell sx={{ verticalAlign: 'top', pt: 1.5 }}><Typography variant="caption">{t(`design.prop.${prop}`)}</Typography></TableCell>
              {LANGUAGES.map((lang) => {
                const missing = (started || (lang === 'en' && (prop === 'patternMessage' || (prop === 'caption' && needsEnglish)))) && !texts?.[lang];
                return (
                  <TableCell key={lang}>
                    <TextField
                      size="small"
                      multiline
                      maxRows={4}
                      value={texts?.[lang] ?? ''}
                      placeholder={inheritedText(designer, field.key, prop, key, lang)}
                      onChange={(e) => designer.update((l) => setFieldText(l, field.key, prop, lang, e.target.value))}
                      title={missing ? t('design.missingTranslation') : undefined}
                      sx={missing ? { '& fieldset': { borderColor: 'warning.main' } } : undefined}
                      slotProps={{ htmlInput: { 'aria-label': `${t(`design.prop.${prop}`)} ${lang}` } }}
                    />
                  </TableCell>
                );
              })}
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function GroupProperties({ designer, groupKey }: { designer: FormDesigner; groupKey: string }) {
  const { t } = useI18n();
  const group = designer.preview.groups.find((g) => g.key === groupKey);
  if (!group) return null;
  const texts = designer.draft[designer.scope].groups?.[groupKey]?.caption;
  const started = !!texts && Object.keys(texts).length > 0;
  return (
    <Box sx={{ display: 'grid', gap: 1 }}>
      {LANGUAGES.map((lang) => {
        const inherited = (designer.scope === 'org' ? designer.draft.global.groups?.[groupKey]?.caption?.[lang] : undefined) ?? DICTIONARIES[lang][group.caption] ?? '';
        const missing = started && !texts?.[lang];
        return (
          <TextField
            key={lang}
            size="small"
            label={`${t('design.prop.caption')} ${lang.toUpperCase()}`}
            value={texts?.[lang] ?? ''}
            placeholder={inherited}
            onChange={(e) => designer.update((l) => setGroupText(l, groupKey, lang, e.target.value))}
            sx={missing ? { '& fieldset': { borderColor: 'warning.main' } } : undefined}
            slotProps={{ inputLabel: { shrink: true } }}
          />
        );
      })}
    </Box>
  );
}

/** Creating a custom field: key (fixed once saved), English caption, entry type and section. */
function AddField({ designer }: { designer: FormDesigner }) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState('');
  const [caption, setCaption] = useState('');
  const [type, setType] = useState<EntryType>('text');
  const [group, setGroup] = useState(designer.preview.groups[0]?.key ?? '');
  if (!designer.formDef.customStorage) return null;

  const taken = [...Object.keys(designer.draft.global.custom ?? {}), ...Object.keys(designer.draft.org.custom ?? {})];
  const keyCheck = checkCustomKey(designer.formDef, key, taken);
  const keyError = key !== '' && !keyCheck.ok ? t(`design.reason.${keyCheck.reason}`) : undefined;

  function add() {
    designer.update((l) => addCustomField(designer.preview, l, key, type, group, caption.trim()));
    designer.select(key);
    setOpen(false);
    setKey('');
    setCaption('');
  }

  if (!open) {
    return <Button size="small" onClick={() => setOpen(true)} sx={{ mt: 0.5 }}>+ {t('design.addField')}</Button>;
  }
  return (
    <Box sx={{ display: 'grid', gap: 1, p: 1, mt: 0.5, border: 1, borderColor: 'divider', borderRadius: 1 }}>
      <Typography variant="subtitle2">{t('design.addField')}</Typography>
      <TextField size="small" label={`${t('design.prop.caption')} EN`} value={caption} onChange={(e) => setCaption(e.target.value)} autoFocus />
      <TextField
        size="small"
        label={t('design.prop.key')}
        value={key}
        onChange={(e) => setKey(e.target.value.trim())}
        error={!!keyError}
        helperText={keyError ?? t('design.keyHelp')}
        slotProps={{ htmlInput: { style: { fontFamily: 'monospace' } } }}
      />
      <TextField select size="small" label={t('design.prop.type')} value={type} onChange={(e) => setType(e.target.value as EntryType)}>
        {ENTRY_TYPES.map((x) => (<MenuItem key={x} value={x}>{t(`design.type.${x}`)}</MenuItem>))}
      </TextField>
      <TextField select size="small" label={t('design.prop.group')} value={group} onChange={(e) => setGroup(e.target.value)}>
        {designer.preview.groups.map((g) => (<MenuItem key={g.key} value={g.key}>{resolveText(g.texts.caption, g.caption, locale, t)}</MenuItem>))}
      </TextField>
      <Typography variant="caption" color="text.secondary">{t(`design.addFieldScope.${designer.scope}`)}</Typography>
      <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
        <Button size="small" onClick={() => setOpen(false)}>{t('design.cancel')}</Button>
        <Button size="small" variant="contained" disabled={!keyCheck.ok || caption.trim() === '' || !group} onClick={add}>{t('design.add')}</Button>
      </Box>
    </Box>
  );
}

/**
 * Where a custom field stands and what can happen to it: a new one can be removed again, a saved
 * one retired (hidden and no longer written; values and key are kept) or restored.
 */
function CustomFieldStatus({ designer, field }: { designer: FormDesigner; field: ResolvedField }) {
  const { t } = useI18n();
  if (!field.custom) return null;
  if (field.custom !== designer.scope) {
    return <Alert severity="info" sx={{ my: 1 }}>{t('design.customFromGlobal')}</Alert>;
  }
  const saved = !!designer.saved[designer.scope].custom?.[field.key];
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, my: 1 }}>
      <Chip size="small" color="secondary" label={t('design.custom')} />
      <Typography variant="caption" color="text.secondary" sx={{ flex: 1, fontFamily: 'monospace' }}>{field.key}</Typography>
      {!saved ? (
        <Button size="small" color="error" onClick={() => { designer.update((l) => removeCustomField(l, field.key)); designer.select(null); }}>{t('design.remove')}</Button>
      ) : field.retired ? (
        <Button size="small" onClick={() => designer.update((l) => setFieldProp(l, field.key, 'retired', undefined))}>{t('design.restore')}</Button>
      ) : (
        <Tooltip title={t('design.retireHelp')}>
          <Button size="small" color="warning" onClick={() => designer.update((l) => setFieldProp(l, field.key, 'retired', true))}>{t('design.retire')}</Button>
        </Tooltip>
      )}
    </Box>
  );
}

/** Sections with their fields: drag to reorder or move, arrows for keyboard and touch. */
function StructureList({ designer }: { designer: FormDesigner }) {
  const { t, locale } = useI18n();
  const [dragged, setDragged] = useState<string | null>(null);
  const form = designer.preview;

  function drop(e: DragEvent, group: string, beforeKey: string | null) {
    e.preventDefault();
    e.stopPropagation();
    const key = dragged ?? e.dataTransfer.getData('text/plain');
    setDragged(null);
    if (key) designer.update((l) => moveField(form, l, key, group, beforeKey));
  }

  return (
    <List dense disablePadding>
      {form.groups.map((g, gi) => (
        <Box key={g.key} onDragOver={(e) => e.preventDefault()} onDrop={(e) => drop(e, g.key, null)} sx={{ mb: 1 }}>
          <ListItemButton
            selected={designer.selected === `group:${g.key}`}
            onClick={() => designer.select(`group:${g.key}`)}
            sx={{ bgcolor: 'action.hover', borderRadius: 1 }}
          >
            <ListItemText primary={resolveText(g.texts.caption, g.caption, locale, t)} slotProps={{ primary: { variant: 'subtitle2' } }} />
            <IconButton size="small" aria-label={t('design.moveUp')} disabled={gi === 0} onClick={(e) => { e.stopPropagation(); designer.update((l) => nudgeGroup(form, l, g.key, -1)); }}>▲</IconButton>
            <IconButton size="small" aria-label={t('design.moveDown')} disabled={gi === form.groups.length - 1} onClick={(e) => { e.stopPropagation(); designer.update((l) => nudgeGroup(form, l, g.key, 1)); }}>▼</IconButton>
          </ListItemButton>
          {formFields(form, g.key).map((f, fi, all) => (
            <ListItemButton
              key={f.key}
              draggable
              onDragStart={(e) => { setDragged(f.key); e.dataTransfer.setData('text/plain', f.key); e.dataTransfer.effectAllowed = 'move'; }}
              onDragEnd={() => setDragged(null)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => drop(e, g.key, f.key)}
              selected={designer.selected === f.key}
              onClick={() => designer.select(f.key)}
              sx={{ pl: 1, opacity: dragged === f.key ? 0.4 : 1 }}
            >
              <Box component="span" aria-hidden sx={{ cursor: 'grab', color: 'text.disabled', mr: 1 }}>⠿</Box>
              <ListItemText
                primary={resolveText(f.texts.caption, f.caption, locale, t)}
                slotProps={{ primary: { sx: { color: f.hidden || f.retired ? 'text.disabled' : undefined, textDecoration: f.hidden || f.retired ? 'line-through' : undefined } } }}
              />
              {f.retired ? <Chip size="small" label={t('design.retired')} sx={{ mr: 0.5 }} /> : f.hidden && <Chip size="small" label={t('design.hidden')} sx={{ mr: 0.5 }} />}
              <IconButton size="small" aria-label={t('design.moveUp')} disabled={fi === 0} onClick={(e) => { e.stopPropagation(); designer.update((l) => nudgeField(form, l, f.key, -1)); }}>▲</IconButton>
              <IconButton size="small" aria-label={t('design.moveDown')} disabled={fi === all.length - 1} onClick={(e) => { e.stopPropagation(); designer.update((l) => nudgeField(form, l, f.key, 1)); }}>▼</IconButton>
            </ListItemButton>
          ))}
        </Box>
      ))}
    </List>
  );
}

/**
 * The design mode side panel (docs/FIELD_CONFIG.md, "Design mode"): scope, the form's sections
 * and fields, the selected field's properties and texts, Save and Discard. Edits preview live on
 * the form behind it.
 */
export function FormDesignPanel({ designer }: { designer: FormDesigner }) {
  const { t, locale } = useI18n();
  const [savedNotice, setSavedNotice] = useState(false);
  const selectedField = designer.selected && !designer.selected.startsWith('group:') ? designer.preview.fields.find((f) => f.key === designer.selected) : undefined;
  const selectedGroup = designer.selected?.startsWith('group:') ? designer.selected.slice('group:'.length) : null;

  async function save() {
    setSavedNotice(false);
    const errors = await designer.save();
    setSavedNotice(errors.length === 0);
  }

  return (
    <Drawer
      variant="persistent"
      anchor="right"
      open
      sx={{
        '& .MuiDrawer-paper': {
          width: { xs: '100%', md: DESIGN_PANEL_WIDTH },
          top: designer.panelTop,
          right: { xs: 0, md: designer.panelRight },
          height: `calc(100% - ${designer.panelTop}px)`,
          display: 'flex',
          flexDirection: 'column',
        },
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', px: 2, py: 1 }}>
        <Typography variant="h6" sx={{ flex: 1 }}>{t('design.title')}</Typography>
        <IconButton aria-label={t('design.close')} onClick={designer.close}>✕</IconButton>
      </Box>
      <Box sx={{ px: 2, pb: 1 }}>
        <ToggleButtonGroup size="small" exclusive fullWidth value={designer.scope} onChange={(_, v) => v && designer.setScope(v)}>
          <ToggleButton value="org">{t('design.scope.org')}</ToggleButton>
          <ToggleButton value="global" disabled={!designer.canEditGlobal}>{t('design.scope.global')}</ToggleButton>
        </ToggleButtonGroup>
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>{t('design.scopeHelp')}</Typography>
      </Box>
      <Divider />

      <Box sx={{ flex: 1, overflowY: 'auto', px: 2, py: 1 }}>
        <Typography variant="overline">{t('design.structure')}</Typography>
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>{t('design.dragHint')}</Typography>
        <StructureList designer={designer} />
        <AddField designer={designer} />

        <Divider sx={{ my: 1 }} />
        {selectedField ? (
          <>
            <Typography variant="overline">{t('design.properties')}: {resolveText(selectedField.texts.caption, selectedField.caption, locale, t)}</Typography>
            <CustomFieldStatus designer={designer} field={selectedField} />
            <FieldProperties designer={designer} field={selectedField} />
            <Typography variant="overline" display="block" sx={{ mt: 1 }}>{t('design.translations')}</Typography>
            <FieldTexts designer={designer} field={selectedField} />
          </>
        ) : selectedGroup ? (
          <>
            <Typography variant="overline" display="block">{t('design.section')}</Typography>
            <GroupProperties designer={designer} groupKey={selectedGroup} />
          </>
        ) : (
          <Typography variant="body2" color="text.secondary">{t('design.selectHint')}</Typography>
        )}
      </Box>

      <Divider />
      <Box sx={{ px: 2, py: 1, display: 'grid', gap: 1 }}>
        {designer.problems.length > 0 && (
          <Alert severity="warning">
            {t('design.problems')}
            {designer.problems.map((e) => (<div key={`${e.scope}.${e.key}`}>{errorLine(e, designer, t, locale)}</div>))}
          </Alert>
        )}
        {designer.saveErrors.length > 0 && (
          <Alert severity="error">
            {t('design.saveFailed')}
            {designer.saveErrors.map((e) => (<div key={`${e.scope}.${e.key}`}>{errorLine(e, designer, t, locale)}</div>))}
          </Alert>
        )}
        {savedNotice && designer.changes === 0 && <Alert severity="success" onClose={() => setSavedNotice(false)}>{t('design.saved')}</Alert>}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
            {designer.changes > 0 ? t('design.changes', { count: designer.changes }) : t('design.noChanges')}
          </Typography>
          <Button onClick={designer.discard} disabled={designer.changes === 0 || designer.saving}>{t('design.discard')}</Button>
          <Button variant="contained" onClick={save} disabled={designer.changes === 0 || designer.saving || designer.problems.length > 0}>{t('design.save')}</Button>
        </Box>
      </Box>
    </Drawer>
  );
}
