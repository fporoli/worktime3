import { useEffect, useMemo, useState } from 'react';
import { Alert, Box, Button, Chip, LinearProgress, Paper, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from '@mui/material';
import { useT } from './i18n';
import { subCategoryLabel, type ExpenseRow } from './Expenses';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';

interface StaticDataRow {
  enum_name: string;
  values: Record<string, string>;
}

const STATUSES = [
  'in_preparation', 'submitted', 'approved', 'rejected',
  'submitted_processing', 'processing_finished', 'request_payment', 'finished',
] as const;
type Status = (typeof STATUSES)[number];

/** In-progress/reopened-for-correction — the only statuses a report's own builder may still edit. */
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

/** 'YYYY-MM-DD...' -> 'DD.MM.YYYY'. */
function toDisplayDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}.${m}.${y}`;
}

/**
 * A generic, human title for an expense report. Referenced by name ("getExpenseReportTitle")
 * from `workflow_definitions.steps[].source_name`, so a workflow row whose source is an expense
 * report can show a "Corresponding object" title without Workflow/Approvals code needing to know
 * anything about expenses.
 */
export function getExpenseReportTitle(report: { date_submitted: string | null }): string {
  return report.date_submitted ? toDisplayDate(report.date_submitted) : '—';
}

interface ExpenseReportsProps {
  orgId: string;
  userId: string;
  authHeaders: () => Promise<Record<string, string>>;
}

export default function ExpenseReports({ orgId, userId, authHeaders }: ExpenseReportsProps) {
  const t = useT();
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [items, setItems] = useState<ExpenseRow[]>([]);
  const [unmapped, setUnmapped] = useState<ExpenseRow[]>([]);
  const [categories, setCategories] = useState<Record<string, string>>({});
  const [subCategories, setSubCategories] = useState<Record<string, string>>({});
  const [submitNote, setSubmitNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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
      setCategories(data.find((r) => r.enum_name === 'expense_category')?.values ?? {});
      setSubCategories(data.find((r) => r.enum_name === 'expense_subcategory')?.values ?? {});
    } catch { /* offline fallback */ }
  }

  function categoryLabel(row: ExpenseRow): string {
    const cat = categories[row.category] ?? row.category;
    const sub = subCategoryLabel(subCategories, row.category, row.sub_category);
    return sub ? `${cat} / ${sub}` : cat;
  }

  useEffect(() => {
    reloadReports();
    reloadStaticData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, userId]);

  // The one report still open for editing, if any — a report is an explicit, user-curated bundle,
  // so there's at most one "in progress" at a time (a rejected one is reopened for correction, not replaced).
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
    reloadDraftDetail();
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
      await fetch(`${API}/expense-reports/${draft.id}/items/${expenseId}`, { method: 'DELETE', headers: await authHeaders() });
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

  return (
    <Paper sx={{ p: 2 }}>
      <Typography variant="h6">{t('expenseReports.title')}</Typography>
      {error && <Alert severity="error" sx={{ mt: 1 }} onClose={() => setError(null)}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mt: 1 }} onClose={() => setSuccess(null)}>{success}</Alert>}
      {loading && <LinearProgress sx={{ mt: 1 }} />}

      {!draft ? (
        <Box sx={{ mt: 2 }}>
          <Button variant="contained" onClick={createReport}>{t('expenseReports.newReport')}</Button>
        </Box>
      ) : (
        <Box sx={{ mt: 2 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
            <Typography variant="subtitle1">{t('expenseReports.draft')}</Typography>
            <Chip label={t(`expenseReports.status.${draft.status}`)} color={STATUS_COLOR[draft.status]} size="small" />
          </Box>
          {draft.status === 'rejected' && draft.review_note && (
            <Alert severity="warning" sx={{ mt: 1 }}>{t('expenseReports.rejected', { note: draft.review_note })}</Alert>
          )}

          <Typography variant="body2" sx={{ mt: 2, mb: 1 }}>{t('expenseReports.itemsInReport', { count: items.length })}</Typography>
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
                <TableRow key={e.id}>
                  <TableCell>{e.expense_date.slice(0, 10)}</TableCell>
                  <TableCell>{categoryLabel(e)}</TableCell>
                  <TableCell align="right">{e.value} {e.currency}</TableCell>
                  <TableCell align="right">
                    <Button size="small" onClick={() => detach(e.id)}>{t('expenseReports.remove')}</Button>
                  </TableCell>
                </TableRow>
              ))}
              {items.length === 0 && (
                <TableRow><TableCell colSpan={4}>{t('expenseReports.noItemsYet')}</TableCell></TableRow>
              )}
            </TableBody>
          </Table>

          <Typography variant="body2" sx={{ mt: 2, mb: 1 }}>{t('expenseReports.availableExpenses', { count: unmapped.length })}</Typography>
          <Table size="small">
            <TableBody>
              {unmapped.map((e) => (
                <TableRow key={e.id}>
                  <TableCell>{e.expense_date.slice(0, 10)}</TableCell>
                  <TableCell>{categoryLabel(e)}</TableCell>
                  <TableCell align="right">{e.value} {e.currency}</TableCell>
                  <TableCell align="right">
                    <Button size="small" onClick={() => attach(e.id)}>{t('expenseReports.add')}</Button>
                  </TableCell>
                </TableRow>
              ))}
              {unmapped.length === 0 && (
                <TableRow><TableCell colSpan={4}>{t('expenseReports.noUnmappedExpenses')}</TableCell></TableRow>
              )}
            </TableBody>
          </Table>

          <TextField
            size="small"
            label={t('expenseReports.submitNote')}
            value={submitNote}
            onChange={(e) => setSubmitNote(e.target.value)}
            multiline
            minRows={2}
            sx={{ mt: 2, mb: 1, display: 'block', width: '100%', maxWidth: 720, '& textarea': { resize: 'vertical' } }}
          />
          <Button variant="contained" onClick={submit} disabled={items.length === 0}>{t('expenseReports.submit')}</Button>
        </Box>
      )}

      {history.length > 0 && (
        <>
          <Typography variant="subtitle2" sx={{ mt: 3, mb: 1 }}>{t('expenseReports.history')}</Typography>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('time.date')}</TableCell>
                <TableCell>{t('expenseReports.statusLabel')}</TableCell>
                <TableCell>{t('timesheet.note')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {history.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{r.date_submitted ? toDisplayDate(r.date_submitted) : '—'}</TableCell>
                  <TableCell><Chip label={t(`expenseReports.status.${r.status}`)} size="small" color={STATUS_COLOR[r.status]} /></TableCell>
                  <TableCell>{r.review_note ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </>
      )}
    </Paper>
  );
}
