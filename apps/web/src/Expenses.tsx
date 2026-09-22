import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Collapse,
  LinearProgress,
  MenuItem,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { useI18n } from './i18n';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';

interface Option {
  id: string;
  name: string;
}

interface StaticDataRow {
  enum_name: string;
  values: Record<string, string>;
  translation: Record<string, Record<string, string>>;
}

/**
 * `expense_subcategory` static_data keys are "<category key>$<sub-category key>" (e.g.
 * "travel$taxi"), so one enum can serve every category's sub-categories while still letting the
 * UI filter down to just the options under whichever category is selected. The `expenses.sub_category`
 * column itself stores only the plain sub-key ("taxi") — the "$" scoping is a static_data-only
 * convention, not part of the domain data.
 */
function subCategoryOptions(subCategories: Record<string, string>, category: string): Array<{ key: string; label: string }> {
  const prefix = `${category}$`;
  return Object.entries(subCategories)
    .filter(([k]) => k.startsWith(prefix))
    .map(([k, label]) => ({ key: k.slice(prefix.length), label }));
}

export function subCategoryLabel(subCategories: Record<string, string>, category: string, subCategory: string | null): string | null {
  if (!subCategory) return null;
  return subCategories[`${category}$${subCategory}`] ?? subCategory;
}

export interface ExpenseRow {
  id: string;
  expense_date: string;
  category: string;
  sub_category: string | null;
  original_value: string | null;
  original_currency: string | null;
  currency: string;
  value: string;
  quantity: string | null;
  comment: string | null;
  project_id: string | null;
  subproject_id: string | null;
  project_name: string | null;
  subproject_name: string | null;
  expense_report_id: string | null;
  expense_report_status: string | null;
  document_id: string | null;
}

/** The form fields shared by "add new" and "edit existing" — kept as strings, matching what the TextFields hold. */
interface ExpenseForm {
  expenseDate: string;
  category: string;
  subCategory: string;
  originalValue: string;
  originalCurrency: string;
  currency: string;
  value: string;
  quantity: string;
  comment: string;
  projectId: string;
  subprojectId: string;
}

function emptyForm(defaultCurrency: string): ExpenseForm {
  return {
    expenseDate: new Date().toISOString().slice(0, 10),
    category: '',
    subCategory: '',
    originalValue: '',
    originalCurrency: defaultCurrency,
    currency: defaultCurrency,
    value: '0',
    quantity: '',
    comment: '',
    projectId: '',
    subprojectId: '',
  };
}

function formFromRow(row: ExpenseRow): ExpenseForm {
  return {
    expenseDate: row.expense_date.slice(0, 10),
    category: row.category,
    subCategory: row.sub_category ?? '',
    originalValue: row.original_value ?? '',
    originalCurrency: row.original_currency ?? '',
    currency: row.currency,
    value: row.value,
    quantity: row.quantity ?? '',
    comment: row.comment ?? '',
    projectId: row.project_id ?? '',
    subprojectId: row.subproject_id ?? '',
  };
}

const ERROR_MESSAGES: Record<string, (t: (key: string) => string) => string> = {
  'expense-mapped': (t) => t('expenses.mappedCannotDelete'),
  'forbidden': (t) => t('expenses.forbidden'),
  'expense-report-locked': () => 'This expense report is pending or closed, so its expense and receipt can no longer be changed.',
};

function canEditReceipt(row: ExpenseRow): boolean {
  return !row.expense_report_status || row.expense_report_status === 'in_preparation' || row.expense_report_status === 'rejected';
}

function canEditExpense(row: ExpenseRow): boolean {
  return canEditReceipt(row);
}

interface ExpensesProps {
  orgId: string;
  userId: string;
  authHeaders: () => Promise<Record<string, string>>;
}

export default function Expenses({ orgId, userId, authHeaders }: ExpensesProps) {
  const { t, locale } = useI18n();
  const [entries, setEntries] = useState<ExpenseRow[]>([]);
  const [projects, setProjects] = useState<Option[]>([]);
  const [subprojectsByProject, setSubprojectsByProject] = useState<Record<string, Option[]>>({});
  const [categories, setCategories] = useState<Record<string, string>>({});
  const [subCategories, setSubCategories] = useState<Record<string, string>>({});
  const [categoryTranslations, setCategoryTranslations] = useState<Record<string, Record<string, string>>>({});
  const [subCategoryTranslations, setSubCategoryTranslations] = useState<Record<string, Record<string, string>>>({});
  const [form, setForm] = useState<ExpenseForm>(emptyForm(''));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAdditional, setShowAdditional] = useState(false);
  const [paySlipFile, setPaySlipFile] = useState<File | null>(null);

  async function reload() {
    setLoading(true);
    try {
      const res = await fetch(`${API}/organizations/${orgId}/expenses?userId=${userId}`, { headers: await authHeaders() });
      const data = await res.json();
      if (Array.isArray(data.entries)) setEntries(data.entries);
    } catch { /* offline fallback */ } finally {
      setLoading(false);
    }
  }

  async function reloadStaticData() {
    try {
      const res = await fetch(`${API}/organizations/${orgId}/static-data/expenses`, { headers: await authHeaders() });
      const data: StaticDataRow[] = await res.json();
      if (!Array.isArray(data)) return;
      const categoryRow = data.find((r) => r.enum_name === 'expense_category');
      const subCategoryRow = data.find((r) => r.enum_name === 'expense_subcategory');
      setCategories(categoryRow?.values ?? {});
      setCategoryTranslations(categoryRow?.translation ?? {});
      setSubCategories(subCategoryRow?.values ?? {});
      setSubCategoryTranslations(subCategoryRow?.translation ?? {});
    } catch { /* offline fallback */ }
  }

  /** `values` is the enum's base-language label; `translation[locale]` overrides it when set. */
  function categoryLabel(key: string): string {
    return categoryTranslations[locale]?.[key] ?? categories[key] ?? key;
  }

  function translatedSubCategoryLabel(category: string, subCategory: string | null): string | null {
    if (!subCategory) return null;
    const key = `${category}$${subCategory}`;
    return subCategoryTranslations[locale]?.[key] ?? subCategories[key] ?? subCategory;
  }

  /** The org's default currency — pre-fills a new expense's `originalCurrency`, which in turn
   * defaults `currency` to match (see `updateForm`) until the user diverges them themselves. */
  async function loadDefaultCurrency() {
    try {
      const res = await fetch(`${API}/organizations/${orgId}`, { headers: await authHeaders() });
      const data = await res.json();
      const currency = typeof data?.default_currency === 'string' ? data.default_currency : '';
      if (currency) setForm((prev) => (prev.originalCurrency ? prev : { ...prev, originalCurrency: currency, currency }));
    } catch { /* offline fallback */ }
  }

  async function reloadProjects() {
    try {
      const res = await fetch(`${API}/organizations/${orgId}/projects`, { headers: await authHeaders() });
      const data = await res.json();
      if (Array.isArray(data)) setProjects(data);
    } catch { /* offline fallback */ }
  }

  /**
   * Always re-fetches (no "already cached" skip) — a project's subproject list can change
   * elsewhere (Management) at any time, and an empty result is a valid, truthy `[]` that a
   * cache-presence check can't tell apart from "not fetched yet". Called on project selection
   * and again whenever the subproject dropdown is opened, so it can't go stale mid-session.
   */
  async function loadSubprojects(pid: string) {
    if (!pid) return;
    try {
      const res = await fetch(`${API}/projects/${pid}/subprojects`, { headers: await authHeaders() });
      const data = await res.json();
      setSubprojectsByProject((prev) => ({ ...prev, [pid]: Array.isArray(data) ? data : [] }));
    } catch { /* offline fallback */ }
  }

  useEffect(() => {
    reload();
    reloadStaticData();
    reloadProjects();
    loadDefaultCurrency();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, userId]);

  function updateForm(patch: Partial<ExpenseForm>) {
    setForm((prev) => {
      const next = { ...prev, ...patch };
      // `currency` defaults to whatever `originalCurrency` is, until the user gives it its
      // own value — at which point they've diverged and this stops following.
      if (patch.originalCurrency !== undefined && prev.currency === prev.originalCurrency) {
        next.currency = patch.originalCurrency;
      }
      return next;
    });
    if (patch.projectId) loadSubprojects(patch.projectId);
  }

  function payloadFrom(f: ExpenseForm) {
    return {
      expenseDate: f.expenseDate,
      category: f.category,
      subCategory: f.subCategory || undefined,
      originalValue: f.originalValue ? Number(f.originalValue) : undefined,
      originalCurrency: f.originalCurrency ? f.originalCurrency.toUpperCase() : undefined,
      currency: f.currency.toUpperCase(),
      value: f.value ? Number(f.value) : 0,
      quantity: f.quantity ? Number(f.quantity) : undefined,
      comment: f.comment || undefined,
      projectId: f.projectId || undefined,
      subprojectId: f.subprojectId || undefined,
    };
  }

  // Amount and receipt currency live in the collapsed "Additional data" section — both are
  // optional, but if given at all, amount must be positive and currency a 3-letter code.
  const additionalDataValid =
    (form.originalValue === '' || Number(form.originalValue) > 0) &&
    (form.originalCurrency === '' || /^[A-Za-z]{3}$/.test(form.originalCurrency));
  const formValid = !!form.expenseDate && !!form.category && additionalDataValid && /^[A-Za-z]{3}$/.test(form.currency);

  async function add() {
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`${API}/organizations/${orgId}/expenses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify(payloadFrom(form)),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(ERROR_MESSAGES[data.error]?.(t) ?? t('expenses.saveFailed', { error: data.error ?? 'unknown error' }));
        return;
      }
      if (paySlipFile) {
        const uploadForm = new FormData();
        uploadForm.append('file', paySlipFile);
        const uploadRes = await fetch(`${API}/expenses/${data.id}/document`, { method: 'POST', headers: await authHeaders(), body: uploadForm });
        const uploadData = await uploadRes.json();
        if (!uploadData.ok) {
          setError(ERROR_MESSAGES[uploadData.error]?.(t) ?? t('expenses.uploadFailed', { error: uploadData.error ?? 'unknown error' }));
          return;
        }
      }
      setForm(emptyForm(form.currency));
      setShowAdditional(false);
      setPaySlipFile(null);
      await reload();
    } catch {
      setError(t('expenses.saveFailedOffline'));
    }
  }

  async function saveEdit() {
    if (!editingId) return;
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`${API}/expenses/${editingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify(payloadFrom(form)),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(ERROR_MESSAGES[data.error]?.(t) ?? t('expenses.saveFailed', { error: data.error ?? 'unknown error' }));
        return;
      }
      setEditingId(null);
      setForm(emptyForm(form.currency));
      setShowAdditional(false);
      setPaySlipFile(null);
      await reload();
    } catch {
      setError(t('expenses.saveFailedOffline'));
    }
  }

  async function remove(id: string) {
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`${API}/expenses/${id}`, { method: 'DELETE', headers: await authHeaders() });
      const data = await res.json();
      if (!data.ok) {
        setError(ERROR_MESSAGES[data.error]?.(t) ?? t('expenses.saveFailed', { error: data.error ?? 'unknown error' }));
        return;
      }
      await reload();
    } catch {
      setError(t('expenses.saveFailedOffline'));
    }
  }

  async function uploadReceipt(id: string, file: File) {
    setError(null);
    setSuccess(null);
    const form = new FormData();
    form.append('file', file);
    try {
      const res = await fetch(`${API}/expenses/${id}/document`, { method: 'POST', headers: await authHeaders(), body: form });
      const data = await res.json();
      if (!data.ok) {
        setError(t('expenses.uploadFailed', { error: data.error ?? 'unknown error' }));
        return;
      }
      await reload();
    } catch {
      setError(t('expenses.uploadFailed', { error: 'offline' }));
    }
  }

  async function downloadReceipt(id: string) {
    try {
      const res = await fetch(`${API}/expenses/${id}/document`, { headers: await authHeaders() });
      const disposition = res.headers.get('content-disposition') ?? '';
      const fileName = /filename="([^"]+)"/.exec(disposition)?.[1] ?? 'receipt';
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
    } catch { /* offline fallback */ }
  }

  function startEdit(row: ExpenseRow) {
    setEditingId(row.id);
    setForm(formFromRow(row));
    setShowAdditional(true);
    if (row.project_id) loadSubprojects(row.project_id);
  }

  function cancelEdit() {
    setEditingId(null);
    setForm(emptyForm(form.currency));
    setShowAdditional(false);
  }

  const subprojects = subprojectsByProject[form.projectId] ?? [];

  return (
    <Paper sx={{ p: 2 }}>
      <Typography variant="h6">{t('expenses.title')}</Typography>
      {error && <Alert severity="error" sx={{ mt: 1 }} onClose={() => setError(null)}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mt: 1 }} onClose={() => setSuccess(null)}>{success}</Alert>}
      {loading && <LinearProgress sx={{ mt: 1 }} />}

      <Typography variant="subtitle1" sx={{ mt: 2 }}>{editingId ? t('expenses.editExpense') : t('expenses.logExpense')}</Typography>
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 1 }}>
        <TextField label={t('time.date')} type="date" value={form.expenseDate} onChange={(e) => e.target.value && updateForm({ expenseDate: e.target.value })} size="small" />
        <TextField select label={t('expenses.category')} value={form.category} onChange={(e) => updateForm({ category: e.target.value, subCategory: '' })} size="small" sx={{ minWidth: 160 }}>
          {Object.keys(categories).map((key) => (<MenuItem key={key} value={key}>{categoryLabel(key)}</MenuItem>))}
        </TextField>
        <TextField
          select
          label={t('expenses.subCategory')}
          value={form.subCategory}
          onChange={(e) => updateForm({ subCategory: e.target.value })}
          size="small"
          sx={{ minWidth: 160 }}
          disabled={!form.category}
        >
          <MenuItem value=""><em>{t('time.none')}</em></MenuItem>
          {subCategoryOptions(subCategories, form.category).map(({ key }) => (<MenuItem key={key} value={key}>{translatedSubCategoryLabel(form.category, key)}</MenuItem>))}
        </TextField>
        <TextField
          select
          label={t('time.project')}
          value={form.projectId}
          onChange={(e) => updateForm({ projectId: e.target.value, subprojectId: '' })}
          size="small"
          sx={{ minWidth: 160 }}
        >
          <MenuItem value=""><em>{t('time.none')}</em></MenuItem>
          {projects.map((p) => (<MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>))}
        </TextField>
        <TextField
          select
          label={t('time.subproject')}
          value={form.subprojectId}
          onChange={(e) => updateForm({ subprojectId: e.target.value })}
          size="small"
          sx={{ minWidth: 160 }}
          disabled={!form.projectId || subprojects.length === 0}
        >
          <MenuItem value=""><em>{t('time.none')}</em></MenuItem>
          {subprojects.map((s) => (<MenuItem key={s.id} value={s.id}>{s.name}</MenuItem>))}
        </TextField>
      </Box>
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 1 }}>
        <TextField
          label={t('expenses.value')}
          type="number"
          value={form.value}
          onChange={(e) => updateForm({ value: e.target.value })}
          size="small"
          slotProps={{ htmlInput: { step: 0.01, min: 0 } }}
          sx={{ maxWidth: 140 }}
        />
        <TextField label={t('expenses.currency')} value={form.currency} onChange={(e) => updateForm({ currency: e.target.value.toUpperCase() })} size="small" slotProps={{ htmlInput: { maxLength: 3 } }} sx={{ maxWidth: 100 }} />
      </Box>
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 1, alignItems: 'flex-start' }}>
        <TextField
          label={t('time.comment')}
          value={form.comment}
          onChange={(e) => updateForm({ comment: e.target.value })}
          size="small"
          multiline
          minRows={2}
          sx={{ flex: 1, minWidth: 260, '& textarea': { resize: 'vertical' } }}
        />
      </Box>

      <Typography
        component="button"
        type="button"
        onClick={() => setShowAdditional((v) => !v)}
        variant="body2"
        color="primary"
        sx={{ mt: 1.5, background: 'none', border: 'none', p: 0, cursor: 'pointer', fontWeight: 600 }}
      >
        {showAdditional ? '▾' : '▸'} {t('expenses.additionalData')}
      </Typography>
      <Collapse in={showAdditional}>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 1 }}>
          <TextField
            label={t('expenses.originalValue')}
            type="number"
            value={form.originalValue}
            onChange={(e) => updateForm({ originalValue: e.target.value })}
            size="small"
            slotProps={{ htmlInput: { step: 0.01, min: 0.01 } }}
            sx={{ maxWidth: 140 }}
          />
          <TextField label={t('expenses.originalCurrency')} value={form.originalCurrency} onChange={(e) => updateForm({ originalCurrency: e.target.value.toUpperCase() })} size="small" slotProps={{ htmlInput: { maxLength: 3 } }} sx={{ maxWidth: 100 }} />
          <TextField
            label={t('expenses.quantity')}
            type="number"
            value={form.quantity}
            onChange={(e) => updateForm({ quantity: e.target.value })}
            size="small"
            slotProps={{ htmlInput: { step: 0.01, min: 0 } }}
            sx={{ maxWidth: 120 }}
          />
        </Box>
      </Collapse>
      <Box sx={{ display: 'flex', gap: 1, mt: 1.5 }}>
        {!editingId && (
          <Button size="small" component="label" variant="outlined">
            {paySlipFile ? paySlipFile.name : 'Optional receipt'}
            <input type="file" hidden onChange={(e) => setPaySlipFile(e.target.files?.[0] ?? null)} />
          </Button>
        )}
        {editingId ? (
          <>
            <Button variant="contained" onClick={saveEdit} disabled={!formValid}>{t('expenses.save')}</Button>
            <Button onClick={cancelEdit}>{t('expenses.cancel')}</Button>
          </>
        ) : (
          <Button variant="contained" onClick={add} disabled={!formValid}>{t('time.add')}</Button>
        )}
      </Box>

      <Typography variant="subtitle1" sx={{ mt: 3 }}>{t('expenses.entries')}</Typography>
      <Table size="small" sx={{ mt: 1 }}>
        <TableHead>
          <TableRow>
            <TableCell>{t('time.date')}</TableCell>
            <TableCell>{t('expenses.category')}</TableCell>
            <TableCell align="right">{t('expenses.value')}</TableCell>
            <TableCell>{t('time.project')}</TableCell>
            <TableCell>{t('time.subproject')}</TableCell>
            <TableCell>{t('expenses.report')}</TableCell>
            <TableCell align="right" />
          </TableRow>
        </TableHead>
        <TableBody>
          {entries.map((row) => (
            <TableRow key={row.id} hover>
              <TableCell>{row.expense_date.slice(0, 10)}</TableCell>
              <TableCell>{categoryLabel(row.category)}{row.sub_category ? ` / ${translatedSubCategoryLabel(row.category, row.sub_category) ?? row.sub_category}` : ''}</TableCell>
              <TableCell align="right">{row.value} {row.currency}</TableCell>
              <TableCell>{row.project_name ?? '—'}</TableCell>
              <TableCell>{row.subproject_name ?? '—'}</TableCell>
              <TableCell>
                {row.expense_report_id ? (
                  <Chip size="small" label={t('expenses.inReport', { status: row.expense_report_status ?? '' })} />
                ) : (
                  <Chip size="small" variant="outlined" label={t('expenses.unmapped')} />
                )}
              </TableCell>
              <TableCell align="right">
                {row.document_id ? (
                  <Button size="small" onClick={() => downloadReceipt(row.id)}>{t('expenses.receipt')}</Button>
                ) : canEditReceipt(row) ? (
                  <Button size="small" component="label">
                    {t('expenses.attachReceipt')}
                    <input type="file" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadReceipt(row.id, f); }} />
                  </Button>
                ) : null}
                {canEditExpense(row) && <Button size="small" onClick={() => startEdit(row)}>{t('time.edit')}</Button>}
                {canEditExpense(row) && <Button size="small" color="error" onClick={() => remove(row.id)}>{t('time.remove')}</Button>}
              </TableCell>
            </TableRow>
          ))}
          {entries.length === 0 && (
            <TableRow><TableCell colSpan={7}>{t('expenses.noEntries')}</TableCell></TableRow>
          )}
        </TableBody>
      </Table>
    </Paper>
  );
}
