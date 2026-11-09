import { Fragment, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { minutes, periodLabel, periodRange, type Entry } from './aggregate';
import { useI18n, type TFunction } from './i18n';
import { getSourceTitle } from './Timesheet';
import { getExpenseReportTitle } from './ExpenseReports';
import { getAbsenceTitle } from './Absences';
import type { ExpenseRow } from './Expenses';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';

interface PeriodRow {
  id: string;
  user_id: string;
  user_display_name: string;
  user_email: string;
  period_start: string;
}

interface ExpenseReportRow {
  id: string;
  user_id: string;
  user_display_name: string;
  user_email: string;
  status: string;
  date_submitted: string | null;
}

interface AbsenceRow {
  id: string;
  user_id: string;
  user_display_name: string;
  user_email: string;
  date_start: string;
  date_end: string;
  absence_type: string;
  half_day: boolean;
  document_id: string | null;
}

interface AbsenceDocumentRow {
  id: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
}

/** Translated absence type; an org-defined type with no dictionary entry falls back to "military_service" -> "Military service". */
function formatAbsenceType(type: string, t: TFunction): string {
  const key = `absences.type.${type}`;
  const translated = t(key);
  if (translated !== key) return translated;
  const spaced = type.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** A workflow row assigned to the caller — generic across every workflow_definitions type. */
interface ActionItem {
  id: string;
  source_table: string;
  step_status: 'pending' | 'approved' | 'rejected';
  workflow_data: { reason?: string; note?: string; decisionNote?: string | null };
  started: string | null;
  definition_name: string;
  /** Human label for the kind of record this workflow concerns, e.g. "Timesheet Period" — from the step's `source`. */
  source: string | null;
  /** Which formatter in `SOURCE_TITLE_FNS` renders this record's title — from the step's `source_name`. */
  source_name: string | null;
  timesheet_period: PeriodRow | null;
  expense_report: ExpenseReportRow | null;
  absence: AbsenceRow | null;
}

/** Friendly label for a workflow_definitions name — unrecognized ones just show as-is, so new workflow types need no frontend change to appear. */
function actionItemLabel(definitionName: string, t: TFunction): string {
  if (definitionName === 'approve timesheet') return t('approvals.kind.timesheet');
  if (definitionName === 'reopen approved timesheet') return t('approvals.kind.reopen');
  if (definitionName === 'approve expense report') return t('approvals.kind.expenseReport');
  if (definitionName === 'approve absence') return t('approvals.kind.absence');
  return definitionName;
}

function actionItemDetail(item: ActionItem): string {
  return item.workflow_data.reason || item.workflow_data.note || '—';
}

/**
 * Registry of `source_name` -> title formatter, keyed by the name a workflow_definitions step
 * configures. Lets a new source type show a "Corresponding object" title with no change here —
 * only a new entry in this map once its formatter exists.
 */
const SOURCE_TITLE_FNS: Record<string, (item: ActionItem) => string | null> = {
  getSourceTitle: (item) => (item.timesheet_period ? getSourceTitle(item.timesheet_period.period_start) : null),
  getExpenseReportTitle: (item) => (item.expense_report ? getExpenseReportTitle(item.expense_report) : null),
  getAbsenceTitle: (item) => (item.absence ? getAbsenceTitle(item.absence) : null),
};

/** "<source> <formatted title>", e.g. "Timesheet Period 01.09.2026-01.10.2026" — or just the source, or '—' if neither is configured. */
function correspondingObject(item: ActionItem): string {
  if (!item.source) return '—';
  const fn = item.source_name ? SOURCE_TITLE_FNS[item.source_name] : undefined;
  const title = fn?.(item);
  return title ? `${item.source} ${title}` : item.source;
}

interface ApprovalsProps {
  orgId: string;
  role: 'admin' | 'manager' | 'user';
  authHeaders: () => Promise<Record<string, string>>;
}

export default function Approvals({ orgId, role, authHeaders }: ApprovalsProps) {
  const { t, locale } = useI18n();
  const [actionItems, setActionItems] = useState<ActionItem[]>([]);
  const [approved, setApproved] = useState<PeriodRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const [inspectingPeriod, setInspectingPeriod] = useState<PeriodRow | null>(null);
  const [inspectingActionItemId, setInspectingActionItemId] = useState<string | null>(null);
  const [inspectingEntries, setInspectingEntries] = useState<Entry[]>([]);
  const [inspectingLoading, setInspectingLoading] = useState(false);
  const [inspectingError, setInspectingError] = useState<string | null>(null);

  const [inspectingReport, setInspectingReport] = useState<ExpenseReportRow | null>(null);
  const [inspectingReportActionItemId, setInspectingReportActionItemId] = useState<string | null>(null);
  const [inspectingExpenses, setInspectingExpenses] = useState<ExpenseRow[]>([]);
  const [inspectingReportLoading, setInspectingReportLoading] = useState(false);
  const [inspectingReportError, setInspectingReportError] = useState<string | null>(null);

  const [inspectingAbsence, setInspectingAbsence] = useState<AbsenceRow | null>(null);
  const [absenceDocument, setAbsenceDocument] = useState<AbsenceDocumentRow | null>(null);

  async function viewAbsenceDocument(absence: AbsenceRow) {
    setInspectingAbsence(absence);
    setAbsenceDocument(null);
    try {
      const res = await fetch(`${API}/organizations/${orgId}/absences/${absence.id}/document`, { headers: await authHeaders() });
      const data = await res.json();
      if (data) setAbsenceDocument(data);
    } catch { /* offline fallback */ }
  }

  async function downloadExpenseDocument(expenseId: string) {
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

  async function downloadAbsenceDocument(absenceId: string, doc: AbsenceDocumentRow) {
    try {
      const res = await fetch(`${API}/absences/${absenceId}/document`, { headers: await authHeaders() });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = doc.file_name;
      a.click();
      URL.revokeObjectURL(url);
    } catch { /* offline fallback */ }
  }

  async function inspect(period: PeriodRow, actionItemId: string | null) {
    setInspectingPeriod(period);
    setInspectingActionItemId(actionItemId);
    setInspectingEntries([]);
    setInspectingLoading(true);
    setInspectingError(null);
    try {
      const { from, to } = periodRange('month', period.period_start.slice(0, 10));
      const url = new URL(`${API}/organizations/${orgId}/project-time`);
      url.searchParams.set('userId', period.user_id);
      url.searchParams.set('from', from);
      url.searchParams.set('to', to);
      const res = await fetch(url.toString(), { headers: await authHeaders() });
      const data = await res.json();
      setInspectingEntries(Array.isArray(data.entries) ? data.entries : []);
    } catch {
      setInspectingError(t('approvals.loadEntriesFailed'));
    } finally {
      setInspectingLoading(false);
    }
  }

  async function inspectReport(report: ExpenseReportRow, actionItemId: string | null) {
    setInspectingReport(report);
    setInspectingReportActionItemId(actionItemId);
    setInspectingExpenses([]);
    setInspectingReportLoading(true);
    setInspectingReportError(null);
    try {
      const res = await fetch(`${API}/expense-reports/${report.id}/items`, { headers: await authHeaders() });
      const data = await res.json();
      setInspectingExpenses(Array.isArray(data) ? data : []);
    } catch {
      setInspectingReportError(t('approvals.loadReportFailed'));
    } finally {
      setInspectingReportLoading(false);
    }
  }

  async function reload() {
    setLoading(true);
    try {
      const [iRes, aRes] = await Promise.all([
        fetch(`${API}/workflows/assigned-to-me`, { headers: await authHeaders() }),
        fetch(`${API}/organizations/${orgId}/timesheet-periods?status=approved`, { headers: await authHeaders() }),
      ]);
      const i = await iRes.json();
      const a = await aRes.json();
      if (Array.isArray(i)) setActionItems(i);
      if (Array.isArray(a)) setApproved(a);
    } catch { /* offline fallback */ } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  async function approveItem(id: string) {
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`${API}/workflows/${id}/approve`, { method: 'POST', headers: await authHeaders() });
      const data = await res.json();
      if (!data.ok) { setError(t('approvals.approveFailedWith', { error: data.error ?? t('common.unknownError') })); return; }
      setSuccess(t('approvals.approved'));
      await reload();
    } catch {
      setError(t('approvals.approveFailed'));
    }
  }

  async function rejectItem(id: string) {
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`${API}/workflows/${id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ note }),
      });
      const data = await res.json();
      if (!data.ok) { setError(t('approvals.declineFailedWith', { error: data.error ?? t('common.unknownError') })); return; }
      setSuccess(t('approvals.declined'));
      setRejectingId(null);
      setNote('');
      await reload();
    } catch {
      setError(t('approvals.declineFailed'));
    }
  }

  async function reopen(id: string) {
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`${API}/timesheet-periods/${id}/reopen`, { method: 'POST', headers: await authHeaders() });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error === 'forbidden' ? t('approvals.reopenForbidden') : t('approvals.reopenFailedWith', { error: data.error ?? t('common.unknownError') }));
        return;
      }
      setSuccess(t('approvals.reopened'));
      await reload();
    } catch {
      setError(t('approvals.reopenFailed'));
    }
  }

  const filteredActionItems = actionItems.filter((item) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    const haystack = [
      item.timesheet_period?.user_display_name,
      item.timesheet_period?.user_email,
      item.expense_report?.user_display_name,
      item.expense_report?.user_email,
      item.absence?.user_display_name,
      item.absence?.user_email,
      actionItemLabel(item.definition_name, t),
      correspondingObject(item),
      actionItemDetail(item),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return haystack.includes(q);
  });

  return (
    <Paper sx={{ p: 2 }}>
      <Typography variant="h6">{t('approvals.title')}</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t('approvals.subtitle')}
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess(null)}>{success}</Alert>}
      {loading && <LinearProgress sx={{ mb: 2 }} />}

      <TextField
        size="small"
        placeholder={t('approvals.searchPlaceholder')}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        sx={{ mb: 2, maxWidth: 320, display: 'block' }}
      />

      <Typography variant="subtitle1" sx={{ mb: 1 }}>
        {search.trim()
          ? t('approvals.actionItemsFiltered', { count: filteredActionItems.length, total: actionItems.length })
          : t('approvals.actionItems', { count: filteredActionItems.length })}
      </Typography>
      <Table size="small" sx={{ mb: 3 }}>
        <TableHead>
          <TableRow>
            <TableCell>{t('teamHours.member')}</TableCell>
            <TableCell>{t('approvals.col.type')}</TableCell>
            <TableCell>{t('approvals.col.object')}</TableCell>
            <TableCell>{t('audit.col.details')}</TableCell>
            <TableCell align="right">{t('common.actions')}</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {filteredActionItems.map((item) => (
            <Fragment key={item.id}>
              <TableRow hover>
                <TableCell>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>{item.timesheet_period?.user_display_name ?? item.expense_report?.user_display_name ?? item.absence?.user_display_name ?? '—'}</Typography>
                  <Typography variant="caption" color="text.secondary">{item.timesheet_period?.user_email ?? item.expense_report?.user_email ?? item.absence?.user_email ?? ''}</Typography>
                </TableCell>
                <TableCell><Chip label={actionItemLabel(item.definition_name, t)} size="small" variant="outlined" /></TableCell>
                <TableCell>
                  {correspondingObject(item)}
                  {item.absence && (
                    <Box sx={{ mt: 0.5, display: 'flex', gap: 0.5 }}>
                      <Chip label={formatAbsenceType(item.absence.absence_type, t)} size="small" variant="outlined" />
                      {item.absence.half_day && <Chip label={t('approvals.halfDay')} size="small" />}
                    </Box>
                  )}
                </TableCell>
                <TableCell>{actionItemDetail(item)}</TableCell>
                <TableCell align="right">
                  {item.timesheet_period && (
                    <Button size="small" variant="outlined" sx={{ mr: 1 }} onClick={() => inspect(item.timesheet_period!, item.id)}>{t('approvals.inspect')}</Button>
                  )}
                  {item.expense_report && (
                    <Button size="small" variant="outlined" sx={{ mr: 1 }} onClick={() => inspectReport(item.expense_report!, item.id)}>{t('approvals.inspect')}</Button>
                  )}
                  {item.absence?.document_id && (
                    <Button size="small" variant="outlined" sx={{ mr: 1 }} onClick={() => viewAbsenceDocument(item.absence!)}>{t('approvals.documents')}</Button>
                  )}
                  <Button size="small" variant="contained" sx={{ mr: 1 }} onClick={() => approveItem(item.id)}>{t('approvals.approve')}</Button>
                  <Button size="small" color="error" onClick={() => setRejectingId(rejectingId === item.id ? null : item.id)}>{t('approvals.reject')}</Button>
                </TableCell>
              </TableRow>
              {rejectingId === item.id && (
                <TableRow>
                  <TableCell colSpan={5} sx={{ bgcolor: 'action.hover' }}>
                    <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                      <TextField size="small" label={t('approvals.note')} value={note} onChange={(e) => setNote(e.target.value)} fullWidth />
                      <Button size="small" color="error" variant="contained" onClick={() => rejectItem(item.id)}>{t('approvals.confirmReject')}</Button>
                    </Box>
                  </TableCell>
                </TableRow>
              )}
            </Fragment>
          ))}
          {filteredActionItems.length === 0 && (
            <TableRow><TableCell colSpan={5}>{actionItems.length === 0 ? t('approvals.nothingPending') : t('approvals.noMatch')}</TableCell></TableRow>
          )}
        </TableBody>
      </Table>

      {role === 'admin' && (
        <>
          <Typography variant="subtitle1" sx={{ mb: 1 }}>{t('approvals.approvedList', { count: approved.length })}</Typography>
          <Table size="small">
            <TableHead>
              <TableRow><TableCell>{t('teamHours.member')}</TableCell><TableCell>{t('time.period')}</TableCell><TableCell align="right">{t('common.actions')}</TableCell></TableRow>
            </TableHead>
            <TableBody>
              {approved.map((p) => (
                <TableRow key={p.id} hover>
                  <TableCell>{p.user_display_name}</TableCell>
                  <TableCell>{p.period_start.slice(0, 7)}</TableCell>
                  <TableCell align="right">
                    <Button size="small" variant="outlined" sx={{ mr: 1 }} onClick={() => inspect(p, null)}>{t('approvals.inspect')}</Button>
                    <Button size="small" onClick={() => reopen(p.id)}>{t('approvals.reopen')}</Button>
                  </TableCell>
                </TableRow>
              ))}
              {approved.length === 0 && (
                <TableRow><TableCell colSpan={3}>{t('approvals.noneYet')}</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </>
      )}

      <Dialog open={!!inspectingPeriod} onClose={() => setInspectingPeriod(null)} maxWidth="md" fullWidth>
        <DialogTitle>
          {inspectingPeriod
            ? t('approvals.reviewTimesheetFor', { name: inspectingPeriod.user_display_name, period: periodLabel('month', inspectingPeriod.period_start.slice(0, 10), locale) })
            : t('approvals.reviewTimesheet')}
        </DialogTitle>
        <DialogContent dividers>
          {inspectingError && <Alert severity="error" sx={{ mb: 2 }}>{inspectingError}</Alert>}
          {inspectingLoading && <LinearProgress sx={{ mb: 2 }} />}
          {inspectingPeriod && (
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
              <Typography variant="body2" color="text.secondary">
                {inspectingPeriod.user_email}
              </Typography>
              <Chip
                label={`${t('approvals.total')}: ${Math.floor(inspectingEntries.reduce((sum, e) => sum + minutes(e), 0) / 60)}h ${Math.round(inspectingEntries.reduce((sum, e) => sum + minutes(e), 0) % 60)}m`}
                color="primary"
                variant="outlined"
              />
            </Box>
          )}
          {inspectingEntries.length === 0 && !inspectingLoading ? (
            <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>{t('approvals.noEntries')}</Typography>
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t('common.date')}</TableCell>
                  <TableCell>{t('time.time')}</TableCell>
                  <TableCell align="right">{t('approvals.duration')}</TableCell>
                  <TableCell>{t('common.project')}</TableCell>
                  <TableCell>{t('common.subproject')}</TableCell>
                  <TableCell>{t('common.comment')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {inspectingEntries.map((e) => {
                  const m = Math.round(minutes(e));
                  const h = Math.floor(m / 60);
                  const rem = m % 60;
                  const startTime = new Date(e.start_time).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
                  const endTime = new Date(e.end_time).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
                  return (
                    <TableRow key={e.id}>
                      <TableCell>{new Date(e.start_time).toLocaleDateString(locale)}</TableCell>
                      <TableCell>{`${startTime} – ${endTime}`}</TableCell>
                      <TableCell align="right">{`${h}h ${rem}m`}</TableCell>
                      <TableCell>{e.project_name ?? '—'}</TableCell>
                      <TableCell>{e.subproject_name ?? '—'}</TableCell>
                      <TableCell>{e.comment ?? '—'}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setInspectingPeriod(null)}>{t('common.close')}</Button>
          {inspectingActionItemId && (
            <>
              <Button
                color="error"
                onClick={() => {
                  const id = inspectingActionItemId;
                  setInspectingPeriod(null);
                  setRejectingId(id);
                }}
              >
                {t('approvals.reject')}…
              </Button>
              <Button
                variant="contained"
                onClick={async () => {
                  const id = inspectingActionItemId;
                  setInspectingPeriod(null);
                  await approveItem(id);
                }}
              >
                {t('approvals.approve')}
              </Button>
            </>
          )}
        </DialogActions>
      </Dialog>

      <Dialog open={!!inspectingReport} onClose={() => setInspectingReport(null)} maxWidth="md" fullWidth>
        <DialogTitle>
          {inspectingReport ? t('approvals.reviewReportFor', { name: inspectingReport.user_display_name }) : t('approvals.reviewReport')}
        </DialogTitle>
        <DialogContent dividers>
          {inspectingReportError && <Alert severity="error" sx={{ mb: 2 }}>{inspectingReportError}</Alert>}
          {inspectingReportLoading && <LinearProgress sx={{ mb: 2 }} />}
          {inspectingReport && (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>{inspectingReport.user_email}</Typography>
          )}
          {inspectingExpenses.length === 0 && !inspectingReportLoading ? (
            <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>{t('approvals.noExpenses')}</Typography>
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t('common.date')}</TableCell>
                  <TableCell>{t('approvals.category')}</TableCell>
                  <TableCell align="right">{t('approvals.value')}</TableCell>
                  <TableCell>{t('common.project')}</TableCell>
                  <TableCell>{t('common.subproject')}</TableCell>
                  <TableCell>{t('common.comment')}</TableCell>
                  <TableCell />
                </TableRow>
              </TableHead>
              <TableBody>
                {inspectingExpenses.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell>{e.expense_date.slice(0, 10)}</TableCell>
                    <TableCell>{e.category}{e.sub_category ? ` / ${e.sub_category}` : ''}</TableCell>
                    <TableCell align="right">{e.value} {e.currency}</TableCell>
                    <TableCell>{e.project_name ?? '—'}</TableCell>
                    <TableCell>{e.subproject_name ?? '—'}</TableCell>
                    <TableCell>{e.comment ?? '—'}</TableCell>
                    <TableCell align="right">
                      {e.document_id && <Button size="small" onClick={() => downloadExpenseDocument(e.id)}>{t('approvals.receipt')}</Button>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setInspectingReport(null)}>{t('common.close')}</Button>
          {inspectingReportActionItemId && (
            <>
              <Button
                color="error"
                onClick={() => {
                  const id = inspectingReportActionItemId;
                  setInspectingReport(null);
                  setRejectingId(id);
                }}
              >
                {t('approvals.reject')}…
              </Button>
              <Button
                variant="contained"
                onClick={async () => {
                  const id = inspectingReportActionItemId;
                  setInspectingReport(null);
                  await approveItem(id);
                }}
              >
                {t('approvals.approve')}
              </Button>
            </>
          )}
        </DialogActions>
      </Dialog>

      <Dialog open={!!inspectingAbsence} onClose={() => setInspectingAbsence(null)} maxWidth="sm" fullWidth>
        <DialogTitle>
          {inspectingAbsence ? t('approvals.evidenceFor', { name: inspectingAbsence.user_display_name }) : t('approvals.evidence')}
        </DialogTitle>
        <DialogContent dividers>
          {absenceDocument ? (
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', py: 0.5 }}>
              <Typography variant="body2">{absenceDocument.file_name}</Typography>
              <Button size="small" onClick={() => downloadAbsenceDocument(inspectingAbsence!.id, absenceDocument)}>{t('approvals.download')}</Button>
            </Box>
          ) : (
            <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>{t('approvals.noDocument')}</Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setInspectingAbsence(null)}>{t('common.close')}</Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
}
