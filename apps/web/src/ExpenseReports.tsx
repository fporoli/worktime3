import { useEffect, useMemo, useState } from 'react';
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
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useI18n } from './i18n';
import { formatLocaleDate, formatLocaleNumber } from './localeFormat';
import { PageHeader, TableEmptyRow } from './components';
import { AddIcon, DeleteIcon, DownloadIcon, FolderCopyIcon, ReceiptLongIcon, VisibilityIcon } from './icons';
import type { ExpenseRow } from './Expenses';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';

interface StaticDataRow {
  enum_name: string;
  values: Record<string, string>;
  translation?: Record<string, Record<string, string>>;
}

const STATUSES = [
  'in_preparation', 'submitted', 'approved', 'rejected',
  'submitted_processing', 'processing_finished', 'request_payment', 'finished',
] as const;
type Status = (typeof STATUSES)[number];

const EDITABLE_STATUSES: readonly Status[] = ['in_preparation', 'rejected'];

interface ReportRow {
  id: string;
  status: Status;
  date_submitted: string | null;
  review_note: string | null;
}

const STATUS_COLOR: Record<Status, 'default' | 'warning' | 'success' | 'error' | 'info'> = {
  in_preparation: 'default',
  submitted: 'warning',
  approved: 'success',
  rejected: 'error',
  submitted_processing: 'info',
  processing_finished: 'info',
  request_payment: 'info',
  finished: 'success',
};

function toDisplayDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}.${m}.${y}`;
}

export function getExpenseReportTitle(report: { date_submitted: string | null }): string {
  return report.date_submitted ? toDisplayDate(report.date_submitted) : '—';
}

function totalsByCurrency(rows: ExpenseRow[], locale: string): string {
  const totals = new Map<string, number>();
  for (const r of rows) {
    const val = Number(r.value);
    if (!Number.isFinite(val)) continue;
    totals.set(r.currency, (totals.get(r.currency) ?? 0) + val);
  }
  return [...totals.entries()]
    .map(([currency, sum]) => `${formatLocaleNumber(Math.round(sum * 100) / 100, locale)} ${currency}`)
    .join(' + ');
}

interface ExpenseReportsProps {
  orgId: string;
  userId: string;
  authHeaders: () => Promise<Record<string, string>>;
}

export default function ExpenseReports({ orgId, userId, authHeaders }: ExpenseReportsProps) {
  const { t, locale } = useI18n();
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [items, setItems] = useState<ExpenseRow[]>([]);
  const [unmapped, setUnmapped] = useState<ExpenseRow[]>([]);
  const [categories, setCategories] = useState<Record<string, string>>({});
  const [subCategories, setSubCategories] = useState<Record<string, string>>({});
  const [catTranslations, setCatTranslations] = useState<Record<string, Record<string, string>>>({});
  const [subCatTranslations, setSubCatTranslations] = useState<Record<string, Record<string, string>>>({});
  const [submitNote, setSubmitNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [inspectingReport, setInspectingReport] = useState<ReportRow | null>(null);
  const [inspectingItems, setInspectingItems] = useState<ExpenseRow[]>([]);
  const [inspectingLoading, setInspectingLoading] = useState(false);

  async function reloadReports() {
    setLoading(true);
    try {
      const res = await fetch(`${API}/organizations/${orgId}/expense-reports?userId=${userId}`, { headers: await authHeaders() });
      const data = await res.json();
      if (Array.isArray(data)) setReports(data);
    } catch { /* offline fallback */ } finally {
      setLoading(false);
    }
  }

  async function reloadStaticData() {
    try {
      const res = await fetch(`${API}/organizations/${orgId}/static-data/expenses`, { headers: await authHeaders() });
      const data: StaticDataRow[] = await res.json();
      if (!Array.isArray(data)) return;
      const catRow = data.find((r) => r.enum_name === 'expense_category');
      const subRow = data.find((r) => r.enum_name === 'expense_subcategory');
      setCategories(catRow?.values ?? {});
      setCatTranslations(catRow?.translation ?? {});
      setSubCategories(subRow?.values ?? {});
      setSubCatTranslations(subRow?.translation ?? {});
    } catch { /* offline fallback */ }
  }

  function categoryLabel(row: ExpenseRow): string {
    const cat = catTranslations[locale]?.[row.category] ?? categories[row.category] ?? row.category;
    if (!row.sub_category) return cat;
    const subKey = `${row.category}$${row.sub_category}`;
    const sub = subCatTranslations[locale]?.[subKey] ?? subCategories[subKey] ?? row.sub_category;
    return `${cat} / ${sub}`;
  }

  useEffect(() => {
    void reloadReports();
    void reloadStaticData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, userId]);

  const draft = useMemo(() => reports.find((r) => EDITABLE_STATUSES.includes(r.status)) ?? null, [reports]);
  const history = useMemo(() => reports.filter((r) => r.id !== draft?.id).sort((a, b) => (a.date_submitted ?? '') < (b.date_submitted ?? '') ? 1 : -1), [reports, draft]);

  async function reloadDraftDetail() {
    if (!draft) {
      setItems([]);
      setUnmapped([]);
      return;
    }
    try {
      const [itemsRes, expensesRes] = await Promise.all([
        fetch(`${API}/expense-reports/${draft.id}/items`, { headers: await authHeaders() }),
        fetch(`${API}/organizations/${orgId}/expenses?userId=${userId}`, { headers: await authHeaders() }),
      ]);
      const itemsData = await itemsRes.json();
      const expensesData = await expensesRes.json();
      setItems(Array.isArray(itemsData) ? itemsData : []);
      const all: ExpenseRow[] = Array.isArray(expensesData.entries) ? expensesData.entries : [];
      setUnmapped(all.filter((e) => !e.expense_report_id));
    } catch { /* offline fallback */ }
  }

  useEffect(() => {
    void reloadDraftDetail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft?.id]);

  async function createReport() {
    setError(null);
    try {
      const res = await fetch(`${API}/organizations/${orgId}/expense-reports`, { method: 'POST', headers: await authHeaders() });
      const data = await res.json();
      if (!data.ok) { setError(t('expenseReports.createFailed', { error: data.error ?? 'unknown error' })); return; }
      await reloadReports();
    } catch {
      setError(t('expenseReports.createFailedOffline'));
    }
  }

  async function attach(expenseId: string) {
    if (!draft) return;
    setError(null);
    try {
      const res = await fetch(`${API}/expense-reports/${draft.id}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ expenseId }),
      });
      const data = await res.json();
      if (!data.ok) { setError(t('expenseReports.attachFailed', { error: data.error ?? 'unknown error' })); return; }
      await reloadDraftDetail();
    } catch {
      setError(t('expenseReports.attachFailedOffline'));
    }
  }

  async function detach(expenseId: string) {
    if (!draft) return;
    setError(null);
    try {
      const res = await fetch(`${API}/expense-reports/${draft.id}/items/${expenseId}`, { method: 'DELETE', headers: await authHeaders() });
      const data = await res.json();
      if (data.ok === false) {
        setError(t('expenseReports.attachFailed', { error: data.error ?? 'unknown error' }));
        return;
      }
      await reloadDraftDetail();
    } catch {
      setError(t('expenseReports.attachFailedOffline'));
    }
  }

  async function submit() {
    if (!draft) return;
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`${API}/expense-reports/${draft.id}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ note: submitNote }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error === 'no-items' ? t('expenseReports.noItems') : t('expenseReports.submitFailed', { error: data.error ?? 'unknown error' }));
        return;
      }
      setSuccess(data.autoApproved ? t('expenseReports.autoApproved') : t('expenseReports.submitted'));
      setSubmitNote('');
      await reloadReports();
    } catch {
      setError(t('expenseReports.submitFailedOffline'));
    }
  }

  async function inspectHistoryReport(report: ReportRow) {
    setInspectingReport(report);
    setInspectingItems([]);
    setInspectingLoading(true);
    try {
      const res = await fetch(`${API}/expense-reports/${report.id}/items`, { headers: await authHeaders() });
      const data = await res.json();
      setInspectingItems(Array.isArray(data) ? data : []);
    } catch {
      setInspectingItems([]);
    } finally {
      setInspectingLoading(false);
    }
  }

  async function downloadReceipt(expenseId: string) {
    try {
      const res = await fetch(`${API}/expenses/${expenseId}/document`, { headers: await authHeaders() });
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

  const draftTotals = useMemo(() => totalsByCurrency(items, locale), [items, locale]);
  const inspectTotals = useMemo(() => totalsByCurrency(inspectingItems, locale), [inspectingItems, locale]);

  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <PageHeader title={t('expenseReports.title')} />

      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
      {success && <Alert severity="success" onClose={() => setSuccess(null)}>{success}</Alert>}
      {loading && <LinearProgress />}

      <Paper sx={{ p: 2 }}>
        {!draft ? (
          <Button variant="contained" startIcon={<AddIcon fontSize="small" />} onClick={createReport}>{t('expenseReports.newReport')}</Button>
        ) : (
          <Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
                <Typography variant="h6">{t('expenseReports.draft')}</Typography>
                {draftTotals && (
                  <Chip size="small" color="primary" variant="outlined" label={t('expenseReports.total', { value: draftTotals })} />
                )}
              </Box>
              <Chip label={t(`expenseReports.status.${draft.status}`)} color={STATUS_COLOR[draft.status]} size="small" />
            </Box>
            {draft.status === 'rejected' && draft.review_note && (
              <Alert severity="warning" sx={{ mt: 1.5 }}>{t('expenseReports.rejected', { note: draft.review_note })}</Alert>
            )}

            <Typography variant="subtitle2" sx={{ mt: 2, mb: 1 }}>{t('expenseReports.itemsInReport', { count: items.length })}</Typography>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>{t('time.date')}</TableCell>
                    <TableCell>{t('expenses.category')}</TableCell>
                    <TableCell align="right">{t('expenses.value')}</TableCell>
                    <TableCell align="right" />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {items.map((e) => (
                    <TableRow key={e.id} hover>
                      <TableCell>{formatLocaleDate(e.expense_date, locale)}</TableCell>
                      <TableCell>{categoryLabel(e)}</TableCell>
                      <TableCell align="right">{formatLocaleNumber(Number(e.value), locale)} {e.currency}</TableCell>
                      <TableCell align="right">
                        <Tooltip title={t('expenseReports.remove')}>
                          <IconButton size="small" color="error" aria-label={t('expenseReports.remove')} onClick={() => void detach(e.id)}>
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </TableCell>
                    </TableRow>
                  ))}
                  {items.length === 0 && (
                    <TableEmptyRow colSpan={4} icon={<FolderCopyIcon fontSize="inherit" />} title={t('expenseReports.noItemsYet')} />
                  )}
                </TableBody>
              </Table>
            </TableContainer>

            <Typography variant="subtitle2" sx={{ mt: 2.5, mb: 1 }}>{t('expenseReports.availableExpenses', { count: unmapped.length })}</Typography>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>{t('time.date')}</TableCell>
                    <TableCell>{t('expenses.category')}</TableCell>
                    <TableCell align="right">{t('expenses.value')}</TableCell>
                    <TableCell align="right" />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {unmapped.map((e) => (
                    <TableRow key={e.id} hover>
                      <TableCell>{formatLocaleDate(e.expense_date, locale)}</TableCell>
                      <TableCell>{categoryLabel(e)}</TableCell>
                      <TableCell align="right">{formatLocaleNumber(Number(e.value), locale)} {e.currency}</TableCell>
                      <TableCell align="right">
                        <Button size="small" startIcon={<AddIcon fontSize="small" />} onClick={() => void attach(e.id)}>{t('expenseReports.add')}</Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {unmapped.length === 0 && (
                    <TableEmptyRow colSpan={4} icon={<ReceiptLongIcon fontSize="inherit" />} title={t('expenseReports.noUnmappedExpenses')} />
                  )}
                </TableBody>
              </Table>
            </TableContainer>

            <TextField
              size="small"
              label={t('expenseReports.submitNote')}
              value={submitNote}
              onChange={(e) => setSubmitNote(e.target.value)}
              multiline
              fullWidth
              minRows={4}
              sx={{ mt: 2, mb: 1.5, display: 'flex', maxWidth: 900, '& textarea': { resize: 'vertical' } }}
            />
            <Button variant="contained" onClick={submit} disabled={items.length === 0}>{t('expenseReports.submit')}</Button>
          </Box>
        )}
      </Paper>

      {history.length > 0 && (
        <Paper sx={{ p: 2 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>{t('expenseReports.history')}</Typography>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t('time.date')}</TableCell>
                  <TableCell>{t('expenseReports.statusLabel')}</TableCell>
                  <TableCell>{t('timesheet.note')}</TableCell>
                  <TableCell align="right" />
                </TableRow>
              </TableHead>
              <TableBody>
                {history.map((r) => (
                  <TableRow key={r.id} hover>
                    <TableCell>{r.date_submitted ? formatLocaleDate(r.date_submitted, locale) : '—'}</TableCell>
                    <TableCell><Chip label={t(`expenseReports.status.${r.status}`)} size="small" color={STATUS_COLOR[r.status]} /></TableCell>
                    <TableCell>{r.review_note ?? '—'}</TableCell>
                    <TableCell align="right">
                      <Button size="small" startIcon={<VisibilityIcon fontSize="small" />} onClick={() => void inspectHistoryReport(r)}>
                        {t('expenseReports.inspect')}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}

      <Dialog open={!!inspectingReport} onClose={() => setInspectingReport(null)} fullWidth maxWidth="md">
        <DialogTitle>
          {t('expenseReports.reportDetails', {
            date: inspectingReport?.date_submitted ? formatLocaleDate(inspectingReport.date_submitted, locale) : '—',
          })}
        </DialogTitle>
        <DialogContent dividers>
          {inspectingLoading && <LinearProgress sx={{ mb: 2 }} />}
          {inspectingReport && (
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap', gap: 1 }}>
              <Chip label={t(`expenseReports.status.${inspectingReport.status}`)} size="small" color={STATUS_COLOR[inspectingReport.status]} />
              {inspectTotals && <Chip label={t('expenseReports.total', { value: inspectTotals })} size="small" color="primary" variant="outlined" />}
            </Box>
          )}
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t('common.date')}</TableCell>
                  <TableCell>{t('expenses.category')}</TableCell>
                  <TableCell align="right">{t('expenses.value')}</TableCell>
                  <TableCell>{t('common.project')}</TableCell>
                  <TableCell>{t('common.comment')}</TableCell>
                  <TableCell align="right" />
                </TableRow>
              </TableHead>
              <TableBody>
                {inspectingItems.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell>{formatLocaleDate(e.expense_date, locale)}</TableCell>
                    <TableCell>{categoryLabel(e)}</TableCell>
                    <TableCell align="right">{formatLocaleNumber(Number(e.value), locale)} {e.currency}</TableCell>
                    <TableCell>{e.project_name ?? '—'}</TableCell>
                    <TableCell>{e.comment ?? '—'}</TableCell>
                    <TableCell align="right">
                      {e.document_id && (
                        <Tooltip title={t('approvals.receipt')}>
                          <IconButton size="small" onClick={() => void downloadReceipt(e.id)}>
                            <DownloadIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {inspectingItems.length === 0 && !inspectingLoading && (
                  <TableRow><TableCell colSpan={6}>{t('approvals.noExpenses')}</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setInspectingReport(null)}>{t('common.close')}</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
