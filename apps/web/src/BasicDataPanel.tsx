import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  LinearProgress,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import dayjs, { type Dayjs } from 'dayjs';
import { BASICDATA_FORM, BASICDATA_NESTED_KEYS_BY_GROUP, validateFields, writableKeys, type ResolvedForm } from '@worktime3/shared/fields';
import { FieldDesignScope, useFormTemplate } from './designMode';
import { DESIGN_PANEL_WIDTH, FormDesignPanel } from './FormDesigner';
import { useI18n } from './i18n';
import { ConfigFieldGroup, useGroupTitle } from './ConfigField';
import { formatLocaleDate } from './localeFormat';
import { AddIcon, CloseIcon, DeleteIcon, EditIcon, HistoryIcon } from './icons';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';

/** ISO 3166-2:CH canton codes — a fixed list, unlike nations/countries this never needs org customization. */
const SWISS_CANTONS = ['AG', 'AI', 'AR', 'BE', 'BL', 'BS', 'FR', 'GE', 'GL', 'GR', 'JU', 'LU', 'NE', 'NW', 'OW', 'SG', 'SH', 'SO', 'SZ', 'TG', 'TI', 'UR', 'VD', 'VS', 'ZG', 'ZH'];

interface BankAccount { bank: string; iban: string }
interface EmergencyContact { name: string; phone: string; relation: string }
interface Partner { lastName: string; firstName: string; birthDate: string; socialSecurityNumber: string }
interface Child { name: string; birthDate: string; gender: string; socialSecurityNumber: string; allowanceUntil: string }

/** Everything stored in users.basicdata — every field optional since it starts out empty. */
export interface BasicData {
  displayName?: string;
  firstName?: string;
  middleName?: string;
  lastName?: string;
  personnelNumber?: string;
  gender?: string;
  birthDate?: string;
  socialSecurityNumber?: string;
  languageCode?: string;
  placeOfOrigin?: string;
  nationality?: string;
  residencePermitCode?: string;
  salutation?: string;
  street?: string;
  postalCode?: string;
  city?: string;
  country?: string;
  canton?: string;
  phone1?: string;
  phone2?: string;
  mobile?: string;
  email?: string;
  bankAccounts?: BankAccount[];
  emergencyContacts?: EmergencyContact[];
  civilStatus?: string;
  civilStatusSince?: string;
  partner?: Partner;
  children?: Child[];
}

interface PendingEntry {
  version: number;
  status: 'approved' | 'changerequested' | 'rejected';
  data: Record<string, unknown>;
  requested_by_user_id: string;
  requested_at: string;
  reviewed_by_user_id: string | null;
  reviewed_at: string | null;
  note: string | null;
}

interface StaticDataRow {
  enum_name: string;
  values: Record<string, string> | null;
  translation: Record<string, Record<string, string>> | null;
}

const SECTION_NESTED_KEYS = BASICDATA_NESTED_KEYS_BY_GROUP;

/** Keys a section may save: all its writable fields for HR, only `self` ones for a change request. */
export function sectionKeys(form: ResolvedForm, group: string, direct: boolean): string[] {
  const fieldKeys = writableKeys(form, group).filter((k) => direct || form.fields.find((f) => f.key === k)?.editableBy === 'self');
  return [...fieldKeys, ...(SECTION_NESTED_KEYS[group] ?? [])];
}

function pick(data: BasicData, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) out[k] = (data as Record<string, unknown>)[k];
  return out;
}

type T = (key: string, vars?: Record<string, string | number>) => string;
interface Option { value: string; label: string }

function optionsFromRow(row: StaticDataRow | undefined, locale: string): Option[] {
  if (!row?.values) return [];
  const localized = row.translation?.[locale] ?? {};
  return Object.keys(row.values)
    .map((key) => ({ value: key, label: localized[key] ?? row.values![key] ?? key }))
    .sort((a, b) => {
      const aOther = a.value.toLowerCase() === 'other';
      const bOther = b.value.toLowerCase() === 'other';
      if (aOther !== bOther) return aOther ? 1 : -1;
      return a.label.localeCompare(b.label);
    });
}

function useRowKey() {
  const mapRef = useRef(new WeakMap<object, string>());
  const seqRef = useRef(0);
  return (row: object) => {
    let key = mapRef.current.get(row);
    if (!key) {
      seqRef.current += 1;
      key = `row-${seqRef.current}`;
      mapRef.current.set(row, key);
    }
    return key;
  };
}

interface EditableGroup {
  errors: Record<string, string>;
  readOnlyKeys: string[];
  editing: boolean;
  draft: BasicData;
  setDraft: (d: BasicData) => void;
  canEdit: boolean;
  start: () => void;
  cancel: () => void;
  save: () => void;
  saving: boolean;
}

function useEditableGroup(params: {
  orgId: string;
  userId: string;
  form: ResolvedForm;
  group: string;
  data: BasicData;
  canEditDirectly: boolean;
  canRequest: boolean;
  authHeaders: () => Promise<Record<string, string>>;
  t: T;
  onSaved: () => void;
  setNotice: (msg: string | null) => void;
}): EditableGroup {
  const { orgId, userId, form, group, data, canEditDirectly, authHeaders, t, onSaved, setNotice } = params;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<BasicData>({});
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const keys = sectionKeys(form, group, canEditDirectly);
  const canRequest = params.canRequest && sectionKeys(form, group, false).length > 0;
  const readOnlyKeys = canEditDirectly ? [] : writableKeys(form, group).filter((k) => !keys.includes(k));

  function showErrors(list: { field: string; rule: string }[]) {
    setErrors(Object.fromEntries(list.map((e) => [e.field, e.rule])));
    setNotice(t('home.fixFieldErrors'));
  }

  function start() {
    setDraft(pick(data, keys) as BasicData);
    setErrors({});
    setNotice(null);
    setEditing(true);
  }
  function cancel() {
    setErrors({});
    setEditing(false);
  }
  async function save() {
    setNotice(null);
    const checked = validateFields(form, pick(draft, keys));
    if (checked.errors.length > 0) {
      showErrors(checked.errors);
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      const patch = checked.values;
      const url = canEditDirectly
        ? `${API}/organizations/${orgId}/users/${userId}/basicdata`
        : `${API}/organizations/${orgId}/users/${userId}/basicdata/request`;
      const res = await fetch(url, {
        method: canEditDirectly ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ patch }),
      });
      const body = await res.json();
      if (!body.ok) {
        if (body.error === 'invalid-field' && Array.isArray(body.fields)) showErrors(body.fields);
        else setNotice(body.error === 'request-already-pending' ? t('home.requestAlreadyPending') : t('home.saveFailed', { error: body.error ?? 'unknown' }));
        return;
      }
      setNotice(canEditDirectly ? t('home.appliedDirectly') : t('home.requestSent'));
      setEditing(false);
      onSaved();
    } catch {
      setNotice(t('home.saveFailed', { error: 'offline' }));
    } finally {
      setSaving(false);
    }
  }

  return { errors, readOnlyKeys, editing, draft, setDraft, canEdit: canEditDirectly || canRequest, start, cancel, save, saving };
}

function GroupActions({ t, group }: { t: T; group: EditableGroup }) {
  return (
    <Box sx={{ display: 'flex', gap: 1 }}>
      {!group.editing && group.canEdit && (
        <Button size="small" variant="outlined" startIcon={<EditIcon fontSize="small" />} onClick={group.start}>
          {t('home.edit')}
        </Button>
      )}
      {group.editing && (
        <>
          <Button size="small" variant="contained" onClick={group.save} disabled={group.saving}>{t('home.save')}</Button>
          <Button size="small" onClick={group.cancel} disabled={group.saving}>{t('home.cancel')}</Button>
        </>
      )}
    </Box>
  );
}

/** What the caller may do with one section (GET .../basicdata `sections`). */
interface SectionAccess {
  see: boolean;
  request: boolean;
  direct: boolean;
}

export interface BasicDataPanelProps {
  orgId: string;
  userId: string;
  isSelf: boolean;
  embedded?: boolean;
  authHeaders: () => Promise<Record<string, string>>;
}

const HISTORY_STATUS_COLOR: Record<PendingEntry['status'], 'success' | 'warning' | 'error'> = {
  approved: 'success',
  changerequested: 'warning',
  rejected: 'error',
};

export function BasicDataPanel({ orgId, userId, isSelf, embedded = false, authHeaders }: BasicDataPanelProps) {
  const { t, locale } = useI18n();
  const [tab, setTab] = useState<'personal' | 'family'>('personal');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [data, setData] = useState<BasicData>({});
  const [companyEmail, setCompanyEmail] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingEntry | null>(null);
  const [canEditDirectly, setCanEditDirectly] = useState(false);
  // Per-section access from the API (section permissions); null from an older API.
  const [sections, setSections] = useState<Record<string, SectionAccess> | null>(null);
  const [staticRows, setStaticRows] = useState<StaticDataRow[]>([]);
  const [rejectNote, setRejectNote] = useState('');
  const [resolving, setResolving] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyRows, setHistoryRows] = useState<PendingEntry[]>([]);
  const { form, savedForm, designer } = useFormTemplate(orgId, BASICDATA_FORM, authHeaders);

  async function reload() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API}/organizations/${orgId}/users/${userId}/basicdata`, { headers: await authHeaders() });
      const body = await res.json();
      if (body.ok === false) {
        setError(body.error ?? 'forbidden');
      } else {
        setData(body.basicdata ?? {});
        setPending(body.pending ?? null);
        setCanEditDirectly(!!body.canEditDirectly);
        setSections(body.sections && typeof body.sections === 'object' ? body.sections : null);
        setCompanyEmail(body.companyEmail ?? null);
      }
    } catch {
      setError('offline');
    } finally {
      setLoading(false);
    }
  }

  async function loadStaticData() {
    try {
      const res = await fetch(`${API}/organizations/${orgId}/static-data/users`, { headers: await authHeaders() });
      const rows = await res.json();
      if (Array.isArray(rows)) setStaticRows(rows);
    } catch { /* offline demo */ }
  }

  async function openHistory() {
    setHistoryOpen(true);
    setHistoryLoading(true);
    try {
      const res = await fetch(`${API}/organizations/${orgId}/users/${userId}/basicdata/versions`, { headers: await authHeaders() });
      const body = await res.json();
      setHistoryRows(body.ok && Array.isArray(body.history) ? [...body.history].reverse() : []);
    } catch {
      setHistoryRows([]);
    } finally {
      setHistoryLoading(false);
    }
  }

  useEffect(() => {
    reload();
    loadStaticData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, userId]);

  const localeOptions = useMemo(() => optionsFromRow(staticRows.find((r) => r.enum_name === 'locales'), locale), [staticRows, locale]);
  const nationOptions = useMemo(() => optionsFromRow(staticRows.find((r) => r.enum_name === 'nations'), locale), [staticRows, locale]);
  const countryOptions = useMemo(() => optionsFromRow(staticRows.find((r) => r.enum_name === 'countries'), locale), [staticRows, locale]);
  const cantonOptions = useMemo(() => SWISS_CANTONS.map((c) => ({ value: c, label: c })), []);

  const access = (group: string): SectionAccess =>
    sections?.[group] ?? { see: true, request: isSelf && !canEditDirectly, direct: canEditDirectly };
  const groupParams = { orgId, userId, form: savedForm, data, authHeaders, t, onSaved: reload, setNotice };
  const personalien = useEditableGroup({ ...groupParams, group: 'personalien', canEditDirectly: access('personalien').direct, canRequest: access('personalien').request });
  const address = useEditableGroup({ ...groupParams, group: 'address', canEditDirectly: access('address').direct, canRequest: access('address').request });
  const family = useEditableGroup({ ...groupParams, group: 'civilStatus', canEditDirectly: access('civilStatus').direct, canRequest: access('civilStatus').request });
  const showPersonalTab = access('personalien').see || access('address').see;
  const showFamilyTab = access('civilStatus').see;
  const currentTab = tab === 'family' ? (showFamilyTab ? 'family' : 'personal') : showPersonalTab ? 'personal' : 'family';
  const canResolve = sections ? Object.values(sections).some((a) => a.direct) : canEditDirectly;

  function switchTab(next: 'personal' | 'family') {
    setTab(next);
    personalien.cancel();
    address.cancel();
    family.cancel();
  }

  async function resolvePending(outcome: 'approve' | 'reject') {
    if (!pending) return;
    setResolving(true);
    setError(null);
    try {
      const res = await fetch(`${API}/organizations/${orgId}/users/${userId}/basicdata/versions/${pending.version}/${outcome}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: outcome === 'reject' ? JSON.stringify({ note: rejectNote || undefined }) : undefined,
      });
      const body = await res.json();
      if (body.ok) {
        setRejectNote('');
        await reload();
      } else {
        setError(t('home.saveFailed', { error: body.error ?? 'unknown' }));
      }
    } catch {
      setError(t('home.saveFailed', { error: 'offline' }));
    } finally {
      setResolving(false);
    }
  }

  const pendingIsMine = pending?.requested_by_user_id === userId;

  const panelBody = (
    <>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        {!embedded ? <Typography variant="h6">{t('home.title')}</Typography> : <span />}
        <Button size="small" variant="text" startIcon={<HistoryIcon fontSize="small" />} onClick={openHistory}>
          {t('home.history')}
        </Button>
      </Box>
      {error && <Alert severity="error" sx={{ my: 1 }} onClose={() => setError(null)}>{error}</Alert>}
      {notice && <Alert severity="info" sx={{ my: 1 }} onClose={() => setNotice(null)}>{notice}</Alert>}
      {loading && <LinearProgress sx={{ my: 1 }} />}

      {pending && (
        canResolve ? (
          <Alert severity="warning" sx={{ my: 1.5 }}>
            <Typography variant="subtitle2">{t('home.pendingReviewTitle')}</Typography>
            <Typography variant="body2" sx={{ mb: 1 }}>
              {t('home.pendingReviewFrom', { name: pendingIsMine ? '—' : pending.requested_by_user_id, date: new Date(pending.requested_at).toLocaleString(locale) })}
            </Typography>
            <Typography variant="body2" sx={{ mb: 1 }}>{t('home.reviewQueue.viewedFields', { fields: Object.keys(pending.data).join(', ') })}</Typography>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
              <Button size="small" variant="contained" onClick={() => resolvePending('approve')} disabled={resolving}>{t('home.approve')}</Button>
              <TextField size="small" label={t('home.rejectReason')} value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} sx={{ minWidth: 220 }} />
              <Button size="small" color="error" onClick={() => resolvePending('reject')} disabled={resolving}>{t('home.reject')}</Button>
            </Box>
          </Alert>
        ) : (
          pendingIsMine && <Alert severity="info" sx={{ my: 1.5 }}>{t('home.pendingBanner')}</Alert>
        )
      )}

      {showPersonalTab && showFamilyTab && (
        <Tabs value={currentTab} onChange={(_, v) => switchTab(v)} sx={{ mb: 2 }}>
          <Tab value="personal" label={t('home.tab.personal')} />
          <Tab value="family" label={t('home.tab.family')} />
        </Tabs>
      )}

      {currentTab === 'personal' ? (
        <Box sx={{ display: 'grid', gap: 2 }}>
          {access('personalien').see && (
          <Box>
            <PersonalienSection
              form={form}
              group={personalien}
              data={personalien.editing ? personalien.draft : data}
              editing={personalien.editing}
              onChange={personalien.setDraft}
              companyEmail={companyEmail}
              localeOptions={localeOptions}
              nationOptions={nationOptions}
            />
            <Box sx={{ mt: 1 }}><GroupActions t={t} group={personalien} /></Box>
          </Box>
          )}

          {access('address').see && (
          <Box>
            <AddressSection
              t={t}
              locale={locale}
              form={form}
              group={address}
              data={address.editing ? address.draft : data}
              editing={address.editing}
              onChange={address.setDraft}
              countryOptions={countryOptions}
              cantonOptions={cantonOptions}
            />
            <Box sx={{ mt: 1 }}><GroupActions t={t} group={address} /></Box>
          </Box>
          )}
        </Box>
      ) : (
        <Box>
          <FamilySection t={t} locale={locale} form={form} group={family} data={family.editing ? family.draft : data} editing={family.editing} onChange={family.setDraft} />
          <Box sx={{ mt: 1 }}><GroupActions t={t} group={family} /></Box>
        </Box>
      )}

      <Dialog open={historyOpen} onClose={() => setHistoryOpen(false)} fullWidth maxWidth="md">
        <DialogTitle>{t('home.historyTitle')}</DialogTitle>
        <DialogContent dividers>
          {historyLoading && <LinearProgress sx={{ mb: 2 }} />}
          {historyRows.length === 0 && !historyLoading ? (
            <Typography variant="body2" color="text.secondary">{t('home.historyEmpty')}</Typography>
          ) : (
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>#</TableCell>
                    <TableCell>{t('common.status')}</TableCell>
                    <TableCell>{t('audit.col.when')}</TableCell>
                    <TableCell>{t('audit.col.details')}</TableCell>
                    <TableCell>{t('timesheet.note')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {historyRows.map((h) => (
                    <TableRow key={h.version}>
                      <TableCell>{h.version}</TableCell>
                      <TableCell>
                        <Chip label={t(`home.historyStatus.${h.status}`)} size="small" color={HISTORY_STATUS_COLOR[h.status]} />
                      </TableCell>
                      <TableCell>{new Date(h.requested_at).toLocaleString(locale)}</TableCell>
                      <TableCell>{Object.keys(h.data ?? {}).join(', ') || '—'}</TableCell>
                      <TableCell>{h.note ?? '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setHistoryOpen(false)}>{t('common.close')}</Button>
        </DialogActions>
      </Dialog>
    </>
  );

  return (
    <FieldDesignScope designer={designer}>
      {designer && <FormDesignPanel designer={designer} />}
      {embedded ? (
        <Box sx={{ mr: designer ? { md: `${DESIGN_PANEL_WIDTH}px` } : 0 }}>{panelBody}</Box>
      ) : (
        <Paper sx={{ p: 2, mr: designer ? { md: `${DESIGN_PANEL_WIDTH}px` } : 0 }}>{panelBody}</Paper>
      )}
    </FieldDesignScope>
  );
}

function DateOrTextField({
  t,
  locale,
  label,
  value,
  editing,
  onChange,
  isDate,
  compact = false,
}: {
  t: T;
  locale: string;
  label: string;
  value: string;
  editing: boolean;
  onChange: (v: string) => void;
  isDate?: boolean;
  compact?: boolean;
}) {
  if (!editing) {
    const shown = isDate && value ? formatLocaleDate(value, locale) : value;
    if (compact) return <>{shown || ''}</>;
    return (
      <Box sx={{ minWidth: 200 }}>
        <Typography variant="caption" color="text.secondary" display="block">{label}</Typography>
        <Typography variant="body2" color={shown ? 'text.primary' : 'text.disabled'}>{shown || '—'}</Typography>
      </Box>
    );
  }
  if (isDate) {
    const parsed = value ? dayjs(value) : null;
    if (!value || (parsed && parsed.isValid() && /^\d{4}-\d{2}-\d{2}/.test(value))) {
      return (
        <DatePicker
          label={compact ? undefined : label}
          value={parsed && parsed.isValid() ? parsed : null}
          onChange={(d: Dayjs | null) => onChange(d && d.isValid() ? d.format('YYYY-MM-DD') : '')}
          slotProps={{
            textField: {
              size: 'small',
              sx: compact ? { minWidth: 155 } : { minWidth: 200 },
            },
          }}
        />
      );
    }
  }
  return (
    <TextField
      size="small"
      label={compact ? undefined : label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      sx={compact ? { minWidth: 120 } : { minWidth: 200 }}
    />
  );
}

function PersonalienSection({
  form, group, data, editing, onChange, companyEmail, localeOptions, nationOptions,
}: {
  form: ResolvedForm; group: EditableGroup; data: BasicData; editing: boolean; onChange: (d: BasicData) => void; companyEmail: string | null; localeOptions: Option[]; nationOptions: Option[];
}) {
  const title = useGroupTitle(form, 'personalien');
  return (
    <Box>
      <Typography variant="subtitle1" sx={{ mb: 1 }}>{title}</Typography>
      <ConfigFieldGroup
        form={form}
        group="personalien"
        errors={group.errors}
        readOnlyKeys={group.readOnlyKeys}
        values={{ ...data, companyEmail: companyEmail ?? '' }}
        editing={editing}
        onChange={(key, value) => onChange({ ...data, [key]: value })}
        options={{ locales: localeOptions, nations: nationOptions }}
      />
    </Box>
  );
}

function AddressSection({
  t, form, group, data, editing, onChange, countryOptions, cantonOptions,
}: {
  t: T; locale: string; form: ResolvedForm; group: EditableGroup; data: BasicData; editing: boolean; onChange: (d: BasicData) => void; countryOptions: Option[]; cantonOptions: Option[];
}) {
  const title = useGroupTitle(form, 'address');
  const bankAccounts = data.bankAccounts ?? [];
  const emergencyContacts = data.emergencyContacts ?? [];
  const getKey = useRowKey();

  function set<K extends keyof BasicData>(key: K, value: BasicData[K]) {
    onChange({ ...data, [key]: value });
  }

  return (
    <Box sx={{ display: 'grid', gap: 3 }}>
      <Box>
        <Typography variant="subtitle1" sx={{ mb: 1 }}>{title}</Typography>
        <ConfigFieldGroup
          form={form}
          group="address"
          errors={group.errors}
          readOnlyKeys={group.readOnlyKeys}
          values={data as Record<string, unknown>}
          editing={editing}
          onChange={(key, value) => onChange({ ...data, [key]: value })}
          options={{ countries: countryOptions, cantons: cantonOptions }}
        />
      </Box>

      <Box>
        <Typography variant="subtitle1" sx={{ mb: 1 }}>{t('home.section.bank')}</Typography>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow><TableCell>{t('home.field.bankName')}</TableCell><TableCell>{t('home.field.iban')}</TableCell>{editing && <TableCell align="right" />}</TableRow>
            </TableHead>
            <TableBody>
              {bankAccounts.map((row, i) => (
                <TableRow key={getKey(row)}>
                  <TableCell>{editing ? <TextField size="small" value={row.bank} onChange={(e) => { const next = bankAccounts.slice(); next[i] = { ...row, bank: e.target.value }; set('bankAccounts', next); }} /> : row.bank}</TableCell>
                  <TableCell>{editing ? <TextField size="small" value={row.iban} onChange={(e) => { const next = bankAccounts.slice(); next[i] = { ...row, iban: e.target.value }; set('bankAccounts', next); }} /> : row.iban}</TableCell>
                  {editing && (
                    <TableCell align="right">
                      <Tooltip title={t('home.remove')}>
                        <IconButton size="small" color="error" aria-label={t('home.remove')} onClick={() => set('bankAccounts', bankAccounts.filter((_, j) => j !== i))}>
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  )}
                </TableRow>
              ))}
              {bankAccounts.length === 0 && !editing && <TableRow><TableCell colSpan={2}>{t('home.noBankAccounts')}</TableCell></TableRow>}
            </TableBody>
          </Table>
        </TableContainer>
        {editing && <Button size="small" startIcon={<AddIcon fontSize="small" />} sx={{ mt: 1 }} onClick={() => set('bankAccounts', [...bankAccounts, { bank: '', iban: '' }])}>{t('home.addRow')}</Button>}
      </Box>

      <Box>
        <Typography variant="subtitle1" sx={{ mb: 1 }}>{t('home.section.emergencyContacts')}</Typography>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow><TableCell>{t('home.field.contactName')}</TableCell><TableCell>{t('home.field.contactPhone')}</TableCell><TableCell>{t('home.field.contactRelation')}</TableCell>{editing && <TableCell align="right" />}</TableRow>
            </TableHead>
            <TableBody>
              {emergencyContacts.map((row, i) => (
                <TableRow key={getKey(row)}>
                  <TableCell>{editing ? <TextField size="small" value={row.name} onChange={(e) => { const next = emergencyContacts.slice(); next[i] = { ...row, name: e.target.value }; set('emergencyContacts', next); }} /> : row.name}</TableCell>
                  <TableCell>{editing ? <TextField size="small" value={row.phone} onChange={(e) => { const next = emergencyContacts.slice(); next[i] = { ...row, phone: e.target.value }; set('emergencyContacts', next); }} /> : row.phone}</TableCell>
                  <TableCell>{editing ? <TextField size="small" value={row.relation} onChange={(e) => { const next = emergencyContacts.slice(); next[i] = { ...row, relation: e.target.value }; set('emergencyContacts', next); }} /> : row.relation}</TableCell>
                  {editing && (
                    <TableCell align="right">
                      <Tooltip title={t('home.remove')}>
                        <IconButton size="small" color="error" aria-label={t('home.remove')} onClick={() => set('emergencyContacts', emergencyContacts.filter((_, j) => j !== i))}>
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  )}
                </TableRow>
              ))}
              {emergencyContacts.length === 0 && !editing && <TableRow><TableCell colSpan={3}>{t('home.noEmergencyContacts')}</TableCell></TableRow>}
            </TableBody>
          </Table>
        </TableContainer>
        {editing && <Button size="small" startIcon={<AddIcon fontSize="small" />} sx={{ mt: 1 }} onClick={() => set('emergencyContacts', [...emergencyContacts, { name: '', phone: '', relation: '' }])}>{t('home.addRow')}</Button>}
      </Box>
    </Box>
  );
}

function FamilySection({ t, locale, form, group, data, editing, onChange }: { t: T; locale: string; form: ResolvedForm; group: EditableGroup; data: BasicData; editing: boolean; onChange: (d: BasicData) => void }) {
  const title = useGroupTitle(form, 'civilStatus');
  const partner = data.partner ?? { lastName: '', firstName: '', birthDate: '', socialSecurityNumber: '' };
  const children = data.children ?? [];
  const getKey = useRowKey();

  function set<K extends keyof BasicData>(key: K, value: BasicData[K]) {
    onChange({ ...data, [key]: value });
  }

  return (
    <Box sx={{ display: 'grid', gap: 3 }}>
      <Box>
        <Typography variant="subtitle1" sx={{ mb: 1 }}>{title}</Typography>
        <ConfigFieldGroup
          form={form}
          group="civilStatus"
          errors={group.errors}
          readOnlyKeys={group.readOnlyKeys}
          values={data as Record<string, unknown>}
          editing={editing}
          onChange={(key, value) => onChange({ ...data, [key]: value })}
        />
      </Box>

      <Box>
        <Typography variant="subtitle1" sx={{ mb: 1 }}>{t('home.section.partner')}</Typography>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          <DateOrTextField t={t} locale={locale} label={t('home.field.partnerLastName')} value={partner.lastName} editing={editing} onChange={(v) => set('partner', { ...partner, lastName: v })} />
          <DateOrTextField t={t} locale={locale} label={t('home.field.partnerFirstName')} value={partner.firstName} editing={editing} onChange={(v) => set('partner', { ...partner, firstName: v })} />
          <DateOrTextField t={t} locale={locale} label={t('home.field.birthDate')} value={partner.birthDate} editing={editing} isDate onChange={(v) => set('partner', { ...partner, birthDate: v })} />
          <DateOrTextField t={t} locale={locale} label={t('home.field.socialSecurityNumber')} value={partner.socialSecurityNumber} editing={editing} onChange={(v) => set('partner', { ...partner, socialSecurityNumber: v })} />
        </Box>
      </Box>

      <Box>
        <Typography variant="subtitle1" sx={{ mb: 1 }}>{t('home.section.children')}</Typography>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('home.field.childName')}</TableCell>
                <TableCell>{t('home.field.birthDate')}</TableCell>
                <TableCell>{t('home.field.gender')}</TableCell>
                <TableCell>{t('home.field.socialSecurityNumber')}</TableCell>
                <TableCell>{t('home.field.childAllowanceUntil')}</TableCell>
                {editing && <TableCell align="right" />}
              </TableRow>
            </TableHead>
            <TableBody>
              {children.map((row, i) => {
                function setChild(patch: Partial<Child>) {
                  const next = children.slice();
                  next[i] = { ...row, ...patch };
                  set('children', next);
                }
                return (
                  <TableRow key={getKey(row)}>
                    <TableCell>{editing ? <TextField size="small" value={row.name} onChange={(e) => setChild({ name: e.target.value })} /> : row.name}</TableCell>
                    <TableCell>
                      <DateOrTextField t={t} locale={locale} label={t('home.field.birthDate')} value={row.birthDate} editing={editing} isDate compact onChange={(v) => setChild({ birthDate: v })} />
                    </TableCell>
                    <TableCell>{editing ? <TextField size="small" value={row.gender} onChange={(e) => setChild({ gender: e.target.value })} /> : row.gender}</TableCell>
                    <TableCell>{editing ? <TextField size="small" value={row.socialSecurityNumber} onChange={(e) => setChild({ socialSecurityNumber: e.target.value })} /> : row.socialSecurityNumber}</TableCell>
                    <TableCell>
                      <DateOrTextField t={t} locale={locale} label={t('home.field.childAllowanceUntil')} value={row.allowanceUntil} editing={editing} isDate compact onChange={(v) => setChild({ allowanceUntil: v })} />
                    </TableCell>
                    {editing && (
                      <TableCell align="right">
                        <Tooltip title={t('home.remove')}>
                          <IconButton size="small" color="error" aria-label={t('home.remove')} onClick={() => set('children', children.filter((_, j) => j !== i))}>
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
              {children.length === 0 && !editing && <TableRow><TableCell colSpan={5}>{t('home.noChildren')}</TableCell></TableRow>}
            </TableBody>
          </Table>
        </TableContainer>
        {editing && (
          <Button size="small" startIcon={<AddIcon fontSize="small" />} sx={{ mt: 1 }} onClick={() => set('children', [...children, { name: '', birthDate: '', gender: '', socialSecurityNumber: '', allowanceUntil: '' }])}>
            {t('home.addRow')}
          </Button>
        )}
      </Box>
    </Box>
  );
}

interface PendingQueueRow {
  user_id: string;
  display_name: string;
  email: string;
  entry: PendingEntry;
}

export function ReviewQueue({ orgId, authHeaders, onResolved }: { orgId: string; authHeaders: () => Promise<Record<string, string>>; onResolved?: () => void }) {
  const { t, locale } = useI18n();
  const [rows, setRows] = useState<PendingQueueRow[]>([]);
  const [busyFor, setBusyFor] = useState<string | null>(null);
  const [rejectNotes, setRejectNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    try {
      const res = await fetch(`${API}/organizations/${orgId}/basicdata/pending`, { headers: await authHeaders() });
      const body = await res.json();
      if (Array.isArray(body)) setRows(body);
    } catch { /* offline demo */ }
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  async function resolve(row: PendingQueueRow, outcome: 'approve' | 'reject') {
    setBusyFor(row.user_id);
    setError(null);
    try {
      const res = await fetch(`${API}/organizations/${orgId}/users/${row.user_id}/basicdata/versions/${row.entry.version}/${outcome}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: outcome === 'reject' ? JSON.stringify({ note: rejectNotes[row.user_id] || undefined }) : undefined,
      });
      const body = await res.json();
      if (body.ok === false) {
        setError(t('home.reviewError', { error: body.error ?? t('common.unknownError') }));
        return;
      }
      await reload();
      onResolved?.();
    } catch {
      setError(t('common.cannotReachApi'));
    } finally {
      setBusyFor(null);
    }
  }

  if (rows.length === 0) return null;

  return (
    <Paper sx={{ p: 2 }}>
      <Typography variant="h6">{t('home.reviewQueue.title')}</Typography>
      {error && <Alert severity="error" sx={{ my: 1 }} onClose={() => setError(null)}>{error}</Alert>}
      <TableContainer sx={{ mt: 1 }}>
        <Table size="small">
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.user_id}>
                <TableCell>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>{row.display_name}</Typography>
                  <Typography variant="caption" color="text.secondary" display="block">
                    {new Date(row.entry.requested_at).toLocaleString(locale)}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" display="block">
                    {t('home.reviewQueue.viewedFields', { fields: Object.keys(row.entry.data).join(', ') })}
                  </Typography>
                </TableCell>
                <TableCell align="right">
                  <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                    <Button size="small" variant="contained" onClick={() => resolve(row, 'approve')} disabled={busyFor === row.user_id}>{t('home.approve')}</Button>
                    <TextField
                      size="small"
                      label={t('home.rejectReason')}
                      value={rejectNotes[row.user_id] ?? ''}
                      onChange={(e) => setRejectNotes((p) => ({ ...p, [row.user_id]: e.target.value }))}
                      sx={{ minWidth: 200 }}
                    />
                    <Button size="small" color="error" onClick={() => resolve(row, 'reject')} disabled={busyFor === row.user_id}>{t('home.reject')}</Button>
                  </Box>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Paper>
  );
}

/** Small icon-only close button exported for consistent dialogs. */
export function DialogCloseButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <IconButton size="small" aria-label={label} onClick={onClick}>
      <CloseIcon fontSize="small" />
    </IconButton>
  );
}
