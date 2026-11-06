import { useEffect, useMemo, useState } from 'react';
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
  Typography,
} from '@mui/material';
import dayjs from 'dayjs';
import { EXPENSE_FORM, validateFields } from '@worktime3/shared/fields';
import { useI18n } from './i18n';
import { ConfigFieldGroup, useGroupTitle, type FieldOption } from './ConfigField';
import { FieldDesignScope, useFormTemplate } from './designMode';
import { DESIGN_PANEL_WIDTH, FormDesignPanel } from './FormDesigner';

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

/**
 * The form's values, keyed like the `expense` form in the field registry (and the API body):
 * strings for text, dates and choices, numbers (or null) for the amounts.
 */
type ExpenseValues = Record<string, unknown>;

function emptyForm(defaultCurrency: string): ExpenseValues {
  return {
    expenseDate: dayjs().format('YYYY-MM-DD'),
    category: '',
    subCategory: '',
    projectId: '',
    subprojectId: '',
    value: 0,
    currency: defaultCurrency,
    comment: '',
    originalValue: null,
    originalCurrency: defaultCurrency,
    quantity: null,
  };
}

function toNumber(v: string | null): number | null {
  if (v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function formFromRow(row: ExpenseRow): ExpenseValues {
  return {
    expenseDate: row.expense_date.slice(0, 10),
    category: row.category,
    subCategory: row.sub_category ?? '',
    projectId: row.project_id ?? '',
    subprojectId: row.subproject_id ?? '',
    value: toNumber(row.value) ?? 0,
    currency: row.currency,
    comment: row.comment ?? '',
    originalValue: toNumber(row.original_value),
    originalCurrency: row.original_currency ?? '',
    quantity: toNumber(row.quantity),
  };
}

const ERROR_MESSAGES: Record<string, (t: (key: string) => string) => string> = {
  'expense-mapped': (t) => t('expenses.mappedCannotDelete'),
  'forbidden': (t) => t('expenses.forbidden'),
};

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
  const [values, setValues] = useState<ExpenseValues>(emptyForm(''));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  // `form` renders (the draft preview while designing); saves are checked against the saved template.
  const { form, savedForm, designer } = useFormTemplate(orgId, EXPENSE_FORM, authHeaders);
  const additionalTitle = useGroupTitle(form, 'additional');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAdditional, setShowAdditional] = useState(false);

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
   * defaults `currency` to match (see `updateField`) until the user diverges them themselves. */
  async function loadDefaultCurrency() {
    try {
      const res = await fetch(`${API}/organizations/${orgId}`, { headers: await authHeaders() });
      const data = await res.json();
      const currency = typeof data?.default_currency === 'string' ? data.default_currency : '';
      if (currency) setValues((prev) => (prev.originalCurrency ? prev : { ...prev, originalCurrency: currency, currency }));
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

  function updateField(key: string, value: unknown) {
    setValues((prev) => {
      const next = { ...prev, [key]: value };
      // A sub-choice belongs to its parent: reset it when the parent changes.
      if (key === 'category') next.subCategory = '';
      if (key === 'projectId') next.subprojectId = '';
      // `currency` follows `originalCurrency` until the user gives it its own value.
      if (key === 'originalCurrency' && prev.currency === prev.originalCurrency) next.currency = value;
      return next;
    });
    setFieldErrors((prev) => {
      if (!(key in prev)) return prev;
      const { [key]: _, ...rest } = prev;
      return rest;
    });
    if (key === 'projectId' && typeof value === 'string' && value) loadSubprojects(value);
  }

  function showFieldErrors(list: { field: string; rule: string }[]) {
    setFieldErrors(Object.fromEntries(list.map((e) => [e.field, e.rule])));
    // Open "Additional data" when one of its fields needs fixing.
    if (list.some((e) => form.fields.find((f) => f.key === e.field)?.group === 'additional')) setShowAdditional(true);
    setError(t('home.fixFieldErrors'));
  }

  function resetForm() {
    setEditingId(null);
    setValues(emptyForm(String(values.currency ?? '')));
    setFieldErrors({});
    setShowAdditional(false);
  }

  /** Validates against the org's template, then creates (no `editingId`) or updates the expense. */
  async function save() {
    setError(null);
    setSuccess(null);
    const checked = validateFields(savedForm, values);
    if (checked.errors.length > 0) {
      showFieldErrors(checked.errors);
      return;
    }
    setFieldErrors({});
    setSaving(true);
    try {
      const res = await fetch(editingId ? `${API}/expenses/${editingId}` : `${API}/organizations/${orgId}/expenses`, {
        method: editingId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify(checked.values),
      });
      const data = await res.json();
      if (!data.ok) {
        if (data.error === 'invalid-field' && Array.isArray(data.fields)) showFieldErrors(data.fields);
        else setError(ERROR_MESSAGES[data.error]?.(t) ?? t('expenses.saveFailed', { error: data.error ?? 'unknown error' }));
        return;
      }
      resetForm();
      await reload();
    } catch {
      setError(t('expenses.saveFailedOffline'));
    } finally {
      setSaving(false);
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

  async function uploadPayslip(id: string, file: File) {
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

  async function downloadPayslip(id: string) {
    try {
      const res = await fetch(`${API}/expenses/${id}/document`, { headers: await authHeaders() });
      const disposition = res.headers.get('content-disposition') ?? '';
      const fileName = /filename="([^"]+)"/.exec(disposition)?.[1] ?? 'payslip';
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
    setValues(formFromRow(row));
    setFieldErrors({});
    setShowAdditional(true);
    if (row.project_id) loadSubprojects(row.project_id);
  }

  const category = String(values.category ?? '');
  const projectId = String(values.projectId ?? '');
  const subprojects = subprojectsByProject[projectId] ?? [];
  const options = useMemo<Record<string, FieldOption[]>>(
    () => ({
      categories: Object.keys(categories).map((key) => ({ value: key, label: categoryLabel(key) })),
      subCategories: subCategoryOptions(subCategories, category).map(({ key }) => ({ value: key, label: translatedSubCategoryLabel(category, key) ?? key })),
      projects: projects.map((p) => ({ value: p.id, label: p.name })),
      subprojects: subprojects.map((sp) => ({ value: sp.id, label: sp.name })),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [categories, subCategories, categoryTranslations, subCategoryTranslations, projects, subprojects, category, locale],
  );
  const disabledKeys = [...(category ? [] : ['subCategory']), ...(projectId && subprojects.length > 0 ? [] : ['subprojectId'])];
  const groupProps = { form, values, editing: true, onChange: updateField, options, errors: fieldErrors, disabledKeys };

  return (
    <FieldDesignScope designer={designer}>
    {designer && <FormDesignPanel designer={designer} />}
    <Paper sx={{ p: 2, mr: designer ? { md: `${DESIGN_PANEL_WIDTH}px` } : 0 }}>
      <Typography variant="h6">{t('expenses.title')}</Typography>
      {error && <Alert severity="error" sx={{ mt: 1 }} onClose={() => setError(null)}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mt: 1 }} onClose={() => setSuccess(null)}>{success}</Alert>}
      {loading && <LinearProgress sx={{ mt: 1 }} />}

      <Typography variant="subtitle1" sx={{ mt: 2 }}>{editingId ? t('expenses.editExpense') : t('expenses.logExpense')}</Typography>
      <Box sx={{ mt: 1.5 }}>
        <ConfigFieldGroup group="expense" {...groupProps} />
      </Box>

      <Typography
        component="button"
        type="button"
        onClick={() => setShowAdditional((v) => !v)}
        variant="body2"
        color="primary"
        sx={{ mt: 1.5, background: 'none', border: 'none', p: 0, cursor: 'pointer', fontWeight: 600 }}
      >
        {showAdditional || designer ? '▾' : '▸'} {additionalTitle}
      </Typography>
      {/* Open while designing, so every field can be selected. */}
      <Collapse in={showAdditional || !!designer}>
        <Box sx={{ mt: 1.5 }}>
          <ConfigFieldGroup group="additional" {...groupProps} />
        </Box>
      </Collapse>
      <Box sx={{ display: 'flex', gap: 1, mt: 1.5 }}>
        <Button variant="contained" onClick={save} disabled={saving}>{editingId ? t('expenses.save') : t('time.add')}</Button>
        {editingId && <Button onClick={resetForm} disabled={saving}>{t('expenses.cancel')}</Button>}
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
                  <Button size="small" onClick={() => downloadPayslip(row.id)}>{t('expenses.payslip')}</Button>
                ) : (
                  <Button size="small" component="label">
                    {t('expenses.attachPayslip')}
                    <input type="file" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadPayslip(row.id, f); }} />
                  </Button>
                )}
                <Button size="small" onClick={() => startEdit(row)}>{t('time.edit')}</Button>
                <Button size="small" color="error" onClick={() => remove(row.id)}>{t('time.remove')}</Button>
              </TableCell>
            </TableRow>
          ))}
          {entries.length === 0 && (
            <TableRow><TableCell colSpan={7}>{t('expenses.noEntries')}</TableCell></TableRow>
          )}
        </TableBody>
      </Table>
    </Paper>
    </FieldDesignScope>
  );
}
