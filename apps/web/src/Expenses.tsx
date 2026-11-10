import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Collapse,
  IconButton,
  LinearProgress,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material';
import dayjs from 'dayjs';
import { EXPENSE_FORM, validateFields } from '@worktime3/shared/fields';
import { useI18n } from './i18n';
import { formatLocaleDate, formatLocaleNumber } from './localeFormat';
import { ConfigFieldGroup, useGroupTitle, type FieldOption } from './ConfigField';
import { FieldDesignScope, useFormTemplate } from './designMode';
import { DESIGN_PANEL_WIDTH, FormDesignPanel } from './FormDesigner';
import { ConfirmDialog, PageHeader, TableEmptyRow } from './components';
import { DeleteIcon, DownloadIcon, EditIcon, ExpandLessIcon, ExpandMoreIcon, ReceiptLongIcon, UploadIcon } from './icons';

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
  data?: Record<string, unknown> | null;
}

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
    ...(row.data ?? {}),
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

function isRowLocked(row: ExpenseRow): boolean {
  return !!row.expense_report_id && row.expense_report_status !== 'in_preparation' && row.expense_report_status !== 'rejected';
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
  const { form, savedForm, designer } = useFormTemplate(orgId, EXPENSE_FORM, authHeaders);
  const additionalTitle = useGroupTitle(form, 'additional');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAdditional, setShowAdditional] = useState(false);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [confirmRemoveDocId, setConfirmRemoveDocId] = useState<string | null>(null);

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

  function categoryLabel(key: string): string {
    return categoryTranslations[locale]?.[key] ?? categories[key] ?? key;
  }

  function translatedSubCategoryLabel(category: string, subCategory: string | null): string | null {
    if (!subCategory) return null;
    const key = `${category}$${subCategory}`;
    return subCategoryTranslations[locale]?.[key] ?? subCategories[key] ?? subCategory;
  }

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

  async function loadSubprojects(pid: string) {
    if (!pid) return;
    try {
      const res = await fetch(`${API}/projects/${pid}/subprojects`, { headers: await authHeaders() });
      const data = await res.json();
      setSubprojectsByProject((prev) => ({ ...prev, [pid]: Array.isArray(data) ? data : [] }));
    } catch { /* offline fallback */ }
  }

  useEffect(() => {
    void reload();
    void reloadStaticData();
    void reloadProjects();
    void loadDefaultCurrency();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, userId]);

  function updateField(key: string, value: unknown) {
    setValues((prev) => {
      const next = { ...prev, [key]: value };
      if (key === 'category') next.subCategory = '';
      if (key === 'projectId') next.subprojectId = '';
      if (key === 'originalCurrency' && prev.currency === prev.originalCurrency) next.currency = value;
      return next;
    });
    setFieldErrors((prev) => {
      if (!(key in prev)) return prev;
      const { [key]: _, ...rest } = prev;
      return rest;
    });
    if (key === 'projectId' && typeof value === 'string' && value) void loadSubprojects(value);
  }

  function showFieldErrors(list: { field: string; rule: string }[]) {
    setFieldErrors(Object.fromEntries(list.map((e) => [e.field, e.rule])));
    if (list.some((e) => form.fields.find((f) => f.key === e.field)?.group === 'additional')) setShowAdditional(true);
    setError(t('home.fixFieldErrors'));
  }

  function resetForm() {
    setEditingId(null);
    setValues(emptyForm(String(values.currency ?? '')));
    setFieldErrors({});
    setShowAdditional(false);
  }

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
      setSuccess(t('expenses.saved'));
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
      if (editingId === id) resetForm();
      setSuccess(t('expenses.removed'));
      await reload();
    } catch {
      setError(t('expenses.saveFailedOffline'));
    }
  }

  async function uploadPayslip(id: string, file: File) {
    setError(null);
    setSuccess(null);
    const body = new FormData();
    body.append('file', file);
    try {
      const res = await fetch(`${API}/expenses/${id}/document`, { method: 'POST', headers: await authHeaders(), body });
      const data = await res.json();
      if (!data.ok) {
        setError(t('expenses.uploadFailed', { error: data.error ?? 'unknown error' }));
        return;
      }
      setSuccess(t('expenses.uploadSuccess'));
      await reload();
    } catch {
      setError(t('expenses.uploadFailed', { error: 'offline' }));
    }
  }

  async function removePayslip(id: string) {
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`${API}/expenses/${id}/document`, { method: 'DELETE', headers: await authHeaders() });
      const data = await res.json();
      if (!data.ok) {
        setError(t('expenses.removePayslipFailed', { error: data.error ?? t('common.unknownError') }));
        return;
      }
      setSuccess(t('expenses.payslipRemoved'));
      await reload();
    } catch {
      setError(t('expenses.saveFailedOffline'));
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
    if (row.project_id) void loadSubprojects(row.project_id);
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
      <Box sx={{ display: 'grid', gap: 2, mr: designer ? { md: `${DESIGN_PANEL_WIDTH}px` } : 0 }}>
        <PageHeader title={t('expenses.title')} />

        {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
        {success && <Alert severity="success" onClose={() => setSuccess(null)}>{success}</Alert>}

        <Paper
          component="form"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
          sx={{ p: 2 }}
        >
          <Typography variant="h6">{editingId ? t('expenses.editExpense') : t('expenses.logExpense')}</Typography>
          <Box sx={{ mt: 1.5 }}>
            <ConfigFieldGroup group="expense" {...groupProps} />
          </Box>

          <Button
            type="button"
            size="small"
            onClick={() => setShowAdditional((v) => !v)}
            aria-expanded={showAdditional}
            startIcon={showAdditional || designer ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
            sx={{ mt: 1.5, px: 0 }}
          >
            {additionalTitle}
          </Button>
          <Collapse in={showAdditional || !!designer}>
            <Box sx={{ mt: 1.5 }}>
              <ConfigFieldGroup group="additional" {...groupProps} />
            </Box>
          </Collapse>
          <Box sx={{ display: 'flex', gap: 1, mt: 1.5 }}>
            <Button type="submit" variant="contained" disabled={saving}>{editingId ? t('expenses.save') : t('time.add')}</Button>
            {editingId && <Button onClick={resetForm} disabled={saving}>{t('expenses.cancel')}</Button>}
          </Box>
        </Paper>

        <Paper sx={{ p: 2 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>{t('expenses.entries')}</Typography>
          {loading && <LinearProgress sx={{ mb: 1 }} />}
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t('time.date')}</TableCell>
                  <TableCell>{t('expenses.category')}</TableCell>
                  <TableCell align="right">{t('expenses.value')}</TableCell>
                  <TableCell>{t('time.project')}</TableCell>
                  <TableCell>{t('time.subproject')}</TableCell>
                  <TableCell>{t('expenses.report')}</TableCell>
                  <TableCell align="right">{t('common.actions')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {entries.map((row) => {
                  const locked = isRowLocked(row);
                  const numVal = Number(row.value);
                  const formattedVal = Number.isFinite(numVal) ? formatLocaleNumber(numVal, locale) : row.value;
                  return (
                    <TableRow key={row.id} hover>
                      <TableCell>{formatLocaleDate(row.expense_date, locale)}</TableCell>
                      <TableCell>{categoryLabel(row.category)}{row.sub_category ? ` / ${translatedSubCategoryLabel(row.category, row.sub_category) ?? row.sub_category}` : ''}</TableCell>
                      <TableCell align="right">{formattedVal} {row.currency}</TableCell>
                      <TableCell>{row.project_name ?? '—'}</TableCell>
                      <TableCell>{row.subproject_name ?? '—'}</TableCell>
                      <TableCell>
                        {row.expense_report_id ? (
                          <Chip
                            size="small"
                            color={row.expense_report_status === 'approved' || row.expense_report_status === 'finished' ? 'success' : row.expense_report_status === 'rejected' ? 'error' : 'default'}
                            label={t('expenses.inReport', {
                              status: row.expense_report_status ? t(`expenseReports.status.${row.expense_report_status}`) : '',
                            })}
                          />
                        ) : (
                          <Chip size="small" variant="outlined" label={t('expenses.unmapped')} />
                        )}
                      </TableCell>
                      <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                        {row.document_id ? (
                          <>
                            <Tooltip title={t('expenses.download')}>
                              <IconButton size="small" aria-label={t('expenses.payslip')} onClick={() => void downloadPayslip(row.id)}>
                                <DownloadIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                            {!locked && (
                              <Tooltip title={t('expenses.removePayslip')}>
                                <IconButton size="small" color="error" aria-label={t('expenses.removePayslip')} onClick={() => setConfirmRemoveDocId(row.id)}>
                                  <DeleteIcon fontSize="small" />
                                </IconButton>
                              </Tooltip>
                            )}
                          </>
                        ) : (
                          <Tooltip title={locked ? t('expenses.lockedTooltip') : t('expenses.attachPayslip')}>
                            <span>
                              <IconButton size="small" component="label" disabled={locked} aria-label={t('expenses.attachPayslip')}>
                                <UploadIcon fontSize="small" />
                                <input type="file" hidden disabled={locked} onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadPayslip(row.id, f); }} />
                              </IconButton>
                            </span>
                          </Tooltip>
                        )}
                        <Tooltip title={locked ? t('expenses.lockedTooltip') : t('time.edit')}>
                          <span>
                            <IconButton size="small" disabled={locked} aria-label={t('time.edit')} onClick={() => startEdit(row)}>
                              <EditIcon fontSize="small" />
                            </IconButton>
                          </span>
                        </Tooltip>
                        <Tooltip title={row.expense_report_id ? t('expenses.mappedCannotDelete') : t('time.remove')}>
                          <span>
                            <IconButton size="small" color="error" disabled={!!row.expense_report_id} aria-label={t('time.remove')} onClick={() => setConfirmRemoveId(row.id)}>
                              <DeleteIcon fontSize="small" />
                            </IconButton>
                          </span>
                        </Tooltip>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {entries.length === 0 && (
                  <TableEmptyRow colSpan={7} icon={<ReceiptLongIcon fontSize="inherit" />} title={t('expenses.noEntries')} />
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      </Box>

      <ConfirmDialog
        open={!!confirmRemoveId}
        title={t('expenses.deleteTitle')}
        message={t('expenses.deleteConfirm')}
        confirmLabel={t('time.remove')}
        cancelLabel={t('common.cancel')}
        onClose={() => setConfirmRemoveId(null)}
        onConfirm={() => {
          if (confirmRemoveId) return remove(confirmRemoveId);
        }}
      />

      <ConfirmDialog
        open={!!confirmRemoveDocId}
        title={t('expenses.removePayslip')}
        message={t('expenses.removePayslipConfirm')}
        confirmLabel={t('common.remove')}
        cancelLabel={t('common.cancel')}
        onClose={() => setConfirmRemoveDocId(null)}
        onConfirm={() => {
          if (confirmRemoveDocId) return removePayslip(confirmRemoveDocId);
        }}
      />
    </FieldDesignScope>
  );
}
