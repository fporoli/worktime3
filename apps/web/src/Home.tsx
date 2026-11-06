import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  IconButton,
  LinearProgress,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import { BASICDATA_FORM, mergeForm, validateFields, writableKeys, type ResolvedForm } from '@worktime3/shared/fields';
import { useI18n } from './i18n';
import { ConfigFieldGroup, useGroupTitle } from './ConfigField';

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

/**
 * Each section saves its registry group's fields (as the org's template arranges them) plus the
 * nested lists it lays out by hand. Fields marked `editableBy: 'hr'` (the Personalien) are only
 * changed by an admin/HR direct edit; everything else may also be requested by the employee.
 */
const SECTION_NESTED_KEYS: Record<string, string[]> = {
  personalien: [],
  address: ['bankAccounts', 'emergencyContacts'],
  civilStatus: ['partner', 'children'],
};

/** The code defaults, used until the org's template has loaded (and when offline). */
const DEFAULT_FORM = mergeForm(BASICDATA_FORM);

/** Keys a section may save: all its writable fields for HR, only `self` ones for a change request. */
export function sectionKeys(form: ResolvedForm, group: string, direct: boolean): string[] {
  const fieldKeys = writableKeys(form, group).filter((k) => direct || form.fields.find((f) => f.key === k)?.editableBy === 'self');
  return [...fieldKeys, ...(SECTION_NESTED_KEYS[group] ?? [])];
}

/** Pick a patch containing only the given keys' current values from `data` — used to submit one section's fields at a time. */
function pick(data: BasicData, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) out[k] = (data as Record<string, unknown>)[k];
  return out;
}

type T = (key: string, vars?: Record<string, string | number>) => string;
interface Option { value: string; label: string }

/** A static_data row's options for the current locale — {key: "Default label"} plus an optional {locale: {key: "Localized label"}} override, same convention as Expenses.tsx's category picker. */
function optionsFromRow(row: StaticDataRow | undefined, locale: string): Option[] {
  if (!row?.values) return [];
  const localized = row.translation?.[locale] ?? {};
  return Object.keys(row.values)
    .map((key) => ({ value: key, label: localized[key] ?? row.values![key] ?? key }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

interface EditableGroup {
  /** Failed validation rule per field key. */
  errors: Record<string, string>;
  /** Fields shown read-only while editing, because this editor may not change them. */
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

/**
 * One independently editable section of the form (Personalien / Address / Family), each with its
 * own Edit-Save-Cancel cycle. `canRequest` gates whether a non-admin/HR viewer may submit a change
 * request at all for this section's keys — false for Personalien, since those are admin/HR only.
 */
function useEditableGroup(params: {
  orgId: string;
  userId: string;
  form: ResolvedForm;
  group: string;
  data: BasicData;
  canEditDirectly: boolean;
  /** Whether the viewer may request changes to their own data (self-service). */
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
      {!group.editing && group.canEdit && <Button size="small" variant="outlined" onClick={group.start}>{t('home.edit')}</Button>}
      {group.editing && (
        <>
          <Button size="small" variant="contained" onClick={group.save} disabled={group.saving}>{t('home.save')}</Button>
          <Button size="small" onClick={group.cancel} disabled={group.saving}>{t('home.cancel')}</Button>
        </>
      )}
    </Box>
  );
}

export interface BasicDataPanelProps {
  orgId: string;
  userId: string;
  /** Whether the signed-in user is the subject of this data (self-service vs. an admin/HR editing someone else's). */
  isSelf: boolean;
  authHeaders: () => Promise<Record<string, string>>;
}

/**
 * The "Meine Daten" panel: personal data + address on one tab, partner/children on another.
 * An admin/HR viewer edits directly (applied immediately); anyone else can only request a
 * change, which then sits pending until an admin/HR approves or rejects it — except the
 * Personalien section, which only an admin/HR may ever touch.
 */
export function BasicDataPanel({ orgId, userId, isSelf, authHeaders }: BasicDataPanelProps) {
  const { t, locale } = useI18n();
  const [tab, setTab] = useState<'personal' | 'family'>('personal');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [data, setData] = useState<BasicData>({});
  const [companyEmail, setCompanyEmail] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingEntry | null>(null);
  const [canEditDirectly, setCanEditDirectly] = useState(false);
  const [staticRows, setStaticRows] = useState<StaticDataRow[]>([]);
  const [rejectNote, setRejectNote] = useState('');
  const [resolving, setResolving] = useState(false);
  const [form, setForm] = useState<ResolvedForm>(DEFAULT_FORM);

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
    } catch { /* offline demo: dropdowns just show no options */ }
  }

  /** The org's template for this form; the code defaults stay in place if it cannot be loaded. */
  async function loadForm() {
    try {
      const res = await fetch(`${API}/organizations/${orgId}/forms/${BASICDATA_FORM.id}`, { headers: await authHeaders() });
      const body = await res.json();
      setForm(body.ok && body.form ? body.form : DEFAULT_FORM);
    } catch {
      setForm(DEFAULT_FORM);
    }
  }

  useEffect(() => {
    reload();
    loadStaticData();
    loadForm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, userId]);

  const localeOptions = useMemo(() => optionsFromRow(staticRows.find((r) => r.enum_name === 'locales'), locale), [staticRows, locale]);
  const nationOptions = useMemo(() => optionsFromRow(staticRows.find((r) => r.enum_name === 'nations'), locale), [staticRows, locale]);
  const countryOptions = useMemo(() => optionsFromRow(staticRows.find((r) => r.enum_name === 'countries'), locale), [staticRows, locale]);
  const cantonOptions = useMemo(() => SWISS_CANTONS.map((c) => ({ value: c, label: c })), []);

  const groupParams = { orgId, userId, form, data, canEditDirectly, canRequest: isSelf, authHeaders, t, onSaved: reload, setNotice };
  const personalien = useEditableGroup({ ...groupParams, group: 'personalien' });
  const address = useEditableGroup({ ...groupParams, group: 'address' });
  const family = useEditableGroup({ ...groupParams, group: 'civilStatus' });

  function switchTab(next: 'personal' | 'family') {
    setTab(next);
    personalien.cancel();
    address.cancel();
    family.cancel();
  }

  async function resolvePending(outcome: 'approve' | 'reject') {
    if (!pending) return;
    setResolving(true);
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
        setNotice(t('home.saveFailed', { error: body.error ?? 'unknown' }));
      }
    } finally {
      setResolving(false);
    }
  }

  const pendingIsMine = pending?.requested_by_user_id === userId;

  return (
    <Paper sx={{ p: 2 }}>
      <Typography variant="h6">{t('home.title')}</Typography>
      {error && <Alert severity="error" sx={{ my: 1 }} onClose={() => setError(null)}>{error}</Alert>}
      {notice && <Alert severity="info" sx={{ my: 1 }} onClose={() => setNotice(null)}>{notice}</Alert>}
      {loading && <LinearProgress sx={{ my: 1 }} />}

      {pending && (
        canEditDirectly ? (
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

      <Tabs value={tab} onChange={(_, v) => switchTab(v)} sx={{ mb: 2 }}>
        <Tab value="personal" label={t('home.tab.personal')} />
        <Tab value="family" label={t('home.tab.family')} />
      </Tabs>

      {tab === 'personal' ? (
        <Box sx={{ display: 'grid', gap: 1.5 }}>
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

          <Box>
            <AddressSection
              t={t}
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
        </Box>
      ) : (
        <Box>
          <FamilySection t={t} form={form} group={family} data={family.editing ? family.draft : data} editing={family.editing} onChange={family.setDraft} />
          <Box sx={{ mt: 1 }}><GroupActions t={t} group={family} /></Box>
        </Box>
      )}
    </Paper>
  );
}

function Field({ t, label, value, editing, onChange, type }: { t: T; label: string; value: string; editing: boolean; onChange: (v: string) => void; type?: 'text' | 'date' }) {
  if (!editing) {
    return (
      <Box sx={{ minWidth: 200 }}>
        <Typography variant="caption" color="text.secondary" display="block">{label}</Typography>
        <Typography variant="body2">{value || t('home.noneSet')}</Typography>
      </Box>
    );
  }
  return <TextField size="small" type={type ?? 'text'} label={label} value={value} onChange={(e) => onChange(e.target.value)} sx={{ minWidth: 200 }} slotProps={type === 'date' ? { inputLabel: { shrink: true } } : undefined} />;
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
  t: T; form: ResolvedForm; group: EditableGroup; data: BasicData; editing: boolean; onChange: (d: BasicData) => void; countryOptions: Option[]; cantonOptions: Option[];
}) {
  const title = useGroupTitle(form, 'address');
  const bankAccounts = data.bankAccounts ?? [];
  const emergencyContacts = data.emergencyContacts ?? [];

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
        <Table size="small">
          <TableHead>
            <TableRow><TableCell>{t('home.field.bankName')}</TableCell><TableCell>{t('home.field.iban')}</TableCell>{editing && <TableCell align="right" />}</TableRow>
          </TableHead>
          <TableBody>
            {bankAccounts.map((row, i) => (
              <TableRow key={i}>
                <TableCell>{editing ? <TextField size="small" value={row.bank} onChange={(e) => { const next = bankAccounts.slice(); next[i] = { ...row, bank: e.target.value }; set('bankAccounts', next); }} /> : row.bank}</TableCell>
                <TableCell>{editing ? <TextField size="small" value={row.iban} onChange={(e) => { const next = bankAccounts.slice(); next[i] = { ...row, iban: e.target.value }; set('bankAccounts', next); }} /> : row.iban}</TableCell>
                {editing && <TableCell align="right"><IconButton size="small" aria-label={t('home.remove')} onClick={() => set('bankAccounts', bankAccounts.filter((_, j) => j !== i))}>✕</IconButton></TableCell>}
              </TableRow>
            ))}
            {bankAccounts.length === 0 && !editing && <TableRow><TableCell colSpan={2}>{t('home.noBankAccounts')}</TableCell></TableRow>}
          </TableBody>
        </Table>
        {editing && <Button size="small" sx={{ mt: 1 }} onClick={() => set('bankAccounts', [...bankAccounts, { bank: '', iban: '' }])}>{t('home.addRow')}</Button>}
      </Box>

      <Box>
        <Typography variant="subtitle1" sx={{ mb: 1 }}>{t('home.section.emergencyContacts')}</Typography>
        <Table size="small">
          <TableHead>
            <TableRow><TableCell>{t('home.field.contactName')}</TableCell><TableCell>{t('home.field.contactPhone')}</TableCell><TableCell>{t('home.field.contactRelation')}</TableCell>{editing && <TableCell align="right" />}</TableRow>
          </TableHead>
          <TableBody>
            {emergencyContacts.map((row, i) => (
              <TableRow key={i}>
                <TableCell>{editing ? <TextField size="small" value={row.name} onChange={(e) => { const next = emergencyContacts.slice(); next[i] = { ...row, name: e.target.value }; set('emergencyContacts', next); }} /> : row.name}</TableCell>
                <TableCell>{editing ? <TextField size="small" value={row.phone} onChange={(e) => { const next = emergencyContacts.slice(); next[i] = { ...row, phone: e.target.value }; set('emergencyContacts', next); }} /> : row.phone}</TableCell>
                <TableCell>{editing ? <TextField size="small" value={row.relation} onChange={(e) => { const next = emergencyContacts.slice(); next[i] = { ...row, relation: e.target.value }; set('emergencyContacts', next); }} /> : row.relation}</TableCell>
                {editing && <TableCell align="right"><IconButton size="small" aria-label={t('home.remove')} onClick={() => set('emergencyContacts', emergencyContacts.filter((_, j) => j !== i))}>✕</IconButton></TableCell>}
              </TableRow>
            ))}
            {emergencyContacts.length === 0 && !editing && <TableRow><TableCell colSpan={3}>{t('home.noEmergencyContacts')}</TableCell></TableRow>}
          </TableBody>
        </Table>
        {editing && <Button size="small" sx={{ mt: 1 }} onClick={() => set('emergencyContacts', [...emergencyContacts, { name: '', phone: '', relation: '' }])}>{t('home.addRow')}</Button>}
      </Box>
    </Box>
  );
}

function FamilySection({ t, form, group, data, editing, onChange }: { t: T; form: ResolvedForm; group: EditableGroup; data: BasicData; editing: boolean; onChange: (d: BasicData) => void }) {
  const title = useGroupTitle(form, 'civilStatus');
  const partner = data.partner ?? { lastName: '', firstName: '', birthDate: '', socialSecurityNumber: '' };
  const children = data.children ?? [];

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
          <Field t={t} label={t('home.field.partnerLastName')} value={partner.lastName} editing={editing} onChange={(v) => set('partner', { ...partner, lastName: v })} />
          <Field t={t} label={t('home.field.partnerFirstName')} value={partner.firstName} editing={editing} onChange={(v) => set('partner', { ...partner, firstName: v })} />
          <Field t={t} label={t('home.field.birthDate')} value={partner.birthDate} editing={editing} onChange={(v) => set('partner', { ...partner, birthDate: v })} />
          <Field t={t} label={t('home.field.socialSecurityNumber')} value={partner.socialSecurityNumber} editing={editing} onChange={(v) => set('partner', { ...partner, socialSecurityNumber: v })} />
        </Box>
      </Box>

      <Box>
        <Typography variant="subtitle1" sx={{ mb: 1 }}>{t('home.section.children')}</Typography>
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
                <TableRow key={i}>
                  <TableCell>{editing ? <TextField size="small" value={row.name} onChange={(e) => setChild({ name: e.target.value })} /> : row.name}</TableCell>
                  <TableCell>{editing ? <TextField size="small" value={row.birthDate} onChange={(e) => setChild({ birthDate: e.target.value })} /> : row.birthDate}</TableCell>
                  <TableCell>{editing ? <TextField size="small" value={row.gender} onChange={(e) => setChild({ gender: e.target.value })} /> : row.gender}</TableCell>
                  <TableCell>{editing ? <TextField size="small" value={row.socialSecurityNumber} onChange={(e) => setChild({ socialSecurityNumber: e.target.value })} /> : row.socialSecurityNumber}</TableCell>
                  <TableCell>{editing ? <TextField size="small" value={row.allowanceUntil} onChange={(e) => setChild({ allowanceUntil: e.target.value })} /> : row.allowanceUntil}</TableCell>
                  {editing && <TableCell align="right"><IconButton size="small" aria-label={t('home.remove')} onClick={() => set('children', children.filter((_, j) => j !== i))}>✕</IconButton></TableCell>}
                </TableRow>
              );
            })}
            {children.length === 0 && !editing && <TableRow><TableCell colSpan={5}>{t('home.noChildren')}</TableCell></TableRow>}
          </TableBody>
        </Table>
        {editing && (
          <Button size="small" sx={{ mt: 1 }} onClick={() => set('children', [...children, { name: '', birthDate: '', gender: '', socialSecurityNumber: '', allowanceUntil: '' }])}>
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

/**
 * Every other employee's change request awaiting review — the API already scopes this to admin/HR
 * viewers and returns an empty list for anyone else, so this simply renders nothing for them.
 */
function ReviewQueue({ orgId, authHeaders }: { orgId: string; authHeaders: () => Promise<Record<string, string>> }) {
  const { t, locale } = useI18n();
  const [rows, setRows] = useState<PendingQueueRow[]>([]);
  const [busyFor, setBusyFor] = useState<string | null>(null);
  const [rejectNotes, setRejectNotes] = useState<Record<string, string>>({});

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
    try {
      await fetch(`${API}/organizations/${orgId}/users/${row.user_id}/basicdata/versions/${row.entry.version}/${outcome}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: outcome === 'reject' ? JSON.stringify({ note: rejectNotes[row.user_id] || undefined }) : undefined,
      });
      await reload();
    } finally {
      setBusyFor(null);
    }
  }

  if (rows.length === 0) return null;

  return (
    <Paper sx={{ p: 2 }}>
      <Typography variant="h6">{t('home.reviewQueue.title')}</Typography>
      <Table size="small" sx={{ mt: 1 }}>
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
    </Paper>
  );
}

export interface HomeProps {
  orgId: string;
  userId: string;
  authHeaders: () => Promise<Record<string, string>>;
}

/** The landing "Meine Daten" page: the signed-in user's own data, plus (for admin/HR) a queue of everyone else's pending change requests. */
export default function Home({ orgId, userId, authHeaders }: HomeProps) {
  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <BasicDataPanel orgId={orgId} userId={userId} isSelf authHeaders={authHeaders} />
      <ReviewQueue orgId={orgId} authHeaders={authHeaders} />
    </Box>
  );
}
