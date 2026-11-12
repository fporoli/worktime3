import { Fragment, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  InputAdornment,
  LinearProgress,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { minutes, periodLabel, periodRange, type Entry } from './aggregate';
import { useI18n, type TFunction } from './i18n';
import { formatDurationMinutes, formatFileSize, formatLocaleDate, formatLocaleNumber, formatSignedMinutes } from './localeFormat';
import { getSourceTitle } from './Timesheet';
import { getExpenseReportTitle } from './ExpenseReports';
import { getAbsenceTitle } from './Absences';
import type { ExpenseRow } from './Expenses';
import { PageHeader, TableEmptyRow } from './components';
import { CheckCircleIcon, DownloadIcon, SearchIcon } from './icons';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';

interface PeriodRow {
  id: string;
  user_id: string;
  user_display_name: string;
  user_email: string;
  period_start: string;
}

interface ProjectPeriodRow {
  id: string;
  user_id: string;
  user_display_name: string;
  user_email: string;
  period_start: string;
  project_id: string;
  project_name: string;
  minutes: number;
}

/** One day of a working-time month (GET day-targets). */
interface DayRow {
  date: string;
  target: number;
  attended: number;
  absence: number;
  absenceType?: string;
  holidayInfo: { name?: string; key?: string } | null;
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

interface StaticDataRow {
  enum_name: string;
  values: Record<string, string>;
  translation?: Record<string, Record<string, string>>;
}

function formatAbsenceType(type: string, t: TFunction): string {
  const key = `absences.type.${type}`;
  const translated = t(key);
  if (translated !== key) return translated;
  const spaced = type.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

interface ActionItem {
  id: string;
  source_table: string;
  step_status: 'pending' | 'approved' | 'rejected';
  workflow_data: { reason?: string; note?: string; decisionNote?: string | null };
  started: string | null;
  definition_name: string;
  source: string | null;
  source_name: string | null;
  timesheet_period: PeriodRow | null;
  expense_report: ExpenseReportRow | null;
  absence: AbsenceRow | null;
  project_time_period: ProjectPeriodRow | null;
}

function actionItemLabel(definitionName: string, t: TFunction): string {
  if (definitionName === 'approve timesheet') return t('approvals.kind.timesheet');
  if (definitionName === 'reopen approved timesheet') return t('approvals.kind.reopen');
  if (definitionName === 'approve expense report') return t('approvals.kind.expenseReport');
  if (definitionName === 'approve absence') return t('approvals.kind.absence');
  if (definitionName === 'approve project timesheet') return t('approvals.kind.projectTimesheet');
  return definitionName;
}

function actionItemDetail(item: ActionItem): string {
  const text = item.workflow_data.reason || item.workflow_data.note || '';
  if (item.project_time_period) return [formatDurationMinutes(item.project_time_period.minutes), text].filter(Boolean).join(' · ');
  return text || '—';
}

/** The person an action item is about, whatever kind of record it is. */
function itemPerson(item: ActionItem): { name: string; email: string } | null {
  const row = item.timesheet_period ?? item.expense_report ?? item.absence ?? item.project_time_period;
  return row ? { name: row.user_display_name, email: row.user_email } : null;
}

const SOURCE_TITLE_FNS: Record<string, (item: ActionItem) => string | null> = {
  getSourceTitle: (item) => (item.timesheet_period ? getSourceTitle(item.timesheet_period.period_start) : null),
  getExpenseReportTitle: (item) => (item.expense_report ? getExpenseReportTitle(item.expense_report) : null),
  getAbsenceTitle: (item) => (item.absence ? getAbsenceTitle(item.absence) : null),
  getProjectTimesheetTitle: (item) =>
    item.project_time_period ? `${item.project_time_period.project_name} · ${getSourceTitle(item.project_time_period.period_start)}` : null,
};

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
  onChanged?: () => void;
}

export default function Approvals({ orgId, role, authHeaders, onChanged }: ApprovalsProps) {
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
  /** Set when the entries dialog shows one project's month rather than nothing. */
  const [inspectingProject, setInspectingProject] = useState<string | null>(null);

  const [inspectingMonth, setInspectingMonth] = useState<PeriodRow | null>(null);
  const [inspectingMonthItemId, setInspectingMonthItemId] = useState<string | null>(null);
  const [monthDays, setMonthDays] = useState<DayRow[]>([]);
  const [monthLoading, setMonthLoading] = useState(false);
  const [monthError, setMonthError] = useState<string | null>(null);

  const [inspectingReport, setInspectingReport] = useState<ExpenseReportRow | null>(null);
  const [inspectingReportActionItemId, setInspectingReportActionItemId] = useState<string | null>(null);
  const [inspectingExpenses, setInspectingExpenses] = useState<ExpenseRow[]>([]);
  const [inspectingReportLoading, setInspectingReportLoading] = useState(false);
  const [inspectingReportError, setInspectingReportError] = useState<string | null>(null);

  const [categories, setCategories] = useState<Record<string, string>>({});
  const [subCategories, setSubCategories] = useState<Record<string, string>>({});
  const [catTranslations, setCatTranslations] = useState<Record<string, Record<string, string>>>({});
  const [subCatTranslations, setSubCatTranslations] = useState<Record<string, Record<string, string>>>({});

  const [inspectingAbsence, setInspectingAbsence] = useState<AbsenceRow | null>(null);
  const [absenceDocument, setAbsenceDocument] = useState<AbsenceDocumentRow | null>(null);
  const [absencePreviewUrl, setAbsencePreviewUrl] = useState<string | null>(null);

  useEffect(() => () => {
    if (absencePreviewUrl) URL.revokeObjectURL(absencePreviewUrl);
  }, [absencePreviewUrl]);

  function closeAbsenceDialog() {
    setInspectingAbsence(null);
    setAbsenceDocument(null);
    if (absencePreviewUrl) {
      URL.revokeObjectURL(absencePreviewUrl);
      setAbsencePreviewUrl(null);
    }
  }

  async function viewAbsenceDocument(absence: AbsenceRow) {
    setInspectingAbsence(absence);
    setAbsenceDocument(null);
    if (absencePreviewUrl) {
      URL.revokeObjectURL(absencePreviewUrl);
      setAbsencePreviewUrl(null);
    }
    try {
      const headers = await authHeaders();
      const res = await fetch(`${API}/organizations/${orgId}/absences/${absence.id}/document`, { headers });
      const data: AbsenceDocumentRow | null = await res.json();
      if (data) {
        setAbsenceDocument(data);
        if (data.mime_type.startsWith('image/') || data.mime_type === 'application/pdf') {
          const fileRes = await fetch(`${API}/absences/${absence.id}/document`, { headers });
          const blob = await fileRes.blob();
          setAbsencePreviewUrl(URL.createObjectURL(blob));
        }
      }
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

  /** A working-time month: the person's days with target, worked and difference. */
  async function inspect(period: PeriodRow, actionItemId: string | null) {
    setInspectingMonth(period);
    setInspectingMonthItemId(actionItemId);
    setMonthDays([]);
    setMonthLoading(true);
    setMonthError(null);
    try {
      const startDate = period.period_start.slice(0, 10);
      const [y, m] = startDate.split('-').map(Number);
      const lastDay = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
      const res = await fetch(`${API}/organizations/${orgId}/day-targets?userId=${period.user_id}&from=${startDate}&to=${lastDay}`, { headers: await authHeaders() });
      const data = await res.json();
      if (data?.ok === false) setMonthError(t('approvals.loadEntriesFailed'));
      setMonthDays(Array.isArray(data?.days) ? data.days : []);
    } catch {
      setMonthError(t('approvals.loadEntriesFailed'));
    } finally {
      setMonthLoading(false);
    }
  }

  /** A project month: that project's entries of the person in that month. */
  async function inspectProjectMonth(period: ProjectPeriodRow, actionItemId: string) {
    setInspectingPeriod({ id: period.id, user_id: period.user_id, user_display_name: period.user_display_name, user_email: period.user_email, period_start: period.period_start });
    setInspectingProject(period.project_name);
    setInspectingActionItemId(actionItemId);
    setInspectingEntries([]);
    setInspectingLoading(true);
    setInspectingError(null);
    try {
      const res = await fetch(`${API}/project-timesheets/${period.id}/entries`, { headers: await authHeaders() });
      const data = await res.json();
      if (data?.ok === false) setInspectingError(t('approvals.loadEntriesFailed'));
      setInspectingEntries(Array.isArray(data?.entries) ? data.entries.map((e: Entry) => ({ ...e, project_name: period.project_name })) : []);
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
      const headers = await authHeaders();
      const [iRes, aRes, sRes] = await Promise.all([
        fetch(`${API}/workflows/assigned-to-me`, { headers }),
        fetch(`${API}/organizations/${orgId}/timesheet-periods?status=approved`, { headers }),
        fetch(`${API}/organizations/${orgId}/static-data/expenses`, { headers }),
      ]);
      const [i, a, s] = await Promise.all([iRes.json(), aRes.json(), sRes.json()]);
      if (Array.isArray(i)) setActionItems(i);
      if (Array.isArray(a)) setApproved(a);
      if (Array.isArray(s)) {
        const rows = s as StaticDataRow[];
        const cat = rows.find((r) => r.enum_name === 'expense_category');
        const sub = rows.find((r) => r.enum_name === 'expense_subcategory');
        setCategories(cat?.values ?? {});
        setCatTranslations(cat?.translation ?? {});
        setSubCategories(sub?.values ?? {});
        setSubCatTranslations(sub?.translation ?? {});
      }
    } catch { /* offline fallback */ } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
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
      onChanged?.();
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
      onChanged?.();
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
      onChanged?.();
    } catch {
      setError(t('approvals.reopenFailed'));
    }
  }

  function categoryLabel(row: ExpenseRow): string {
    const cat = catTranslations[locale]?.[row.category] ?? categories[row.category] ?? row.category;
    if (!row.sub_category) return cat;
    const subKey = `${row.category}$${row.sub_category}`;
    const sub = subCatTranslations[locale]?.[subKey] ?? subCategories[subKey] ?? row.sub_category;
    return `${cat} / ${sub}`;
  }

  const reportTotalLabel = useMemo(() => {
    const totals = new Map<string, number>();
    for (const e of inspectingExpenses) {
      const v = Number(e.value);
      if (!Number.isFinite(v)) continue;
      totals.set(e.currency, (totals.get(e.currency) ?? 0) + v);
    }
    return [...totals.entries()]
      .map(([currency, sum]) => `${formatLocaleNumber(Math.round(sum * 100) / 100, locale)} ${currency}`)
      .join(' + ');
  }, [inspectingExpenses, locale]);

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
      item.project_time_period?.user_display_name,
      item.project_time_period?.user_email,
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
    <Box sx={{ display: 'grid', gap: 2 }}>
      <PageHeader title={t('approvals.title')} subtitle={t('approvals.subtitle')} />

      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
      {success && <Alert severity="success" onClose={() => setSuccess(null)}>{success}</Alert>}
      {loading && <LinearProgress />}

      <Paper sx={{ p: 2 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1.5, mb: 2 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
            {search.trim()
              ? t('approvals.actionItemsFiltered', { count: filteredActionItems.length, total: actionItems.length })
              : t('approvals.actionItems', { count: filteredActionItems.length })}
          </Typography>
          <TextField
            size="small"
            placeholder={t('approvals.searchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            sx={{ minWidth: { xs: '100%', sm: 300 } }}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" color="action" />
                  </InputAdornment>
                ),
              },
            }}
          />
        </Box>

        <TableContainer>
          <Table size="small">
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
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>{itemPerson(item)?.name ?? '—'}</Typography>
                      <Typography variant="caption" color="text.secondary">{itemPerson(item)?.email ?? ''}</Typography>
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
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                      {item.timesheet_period && (
                        <Button size="small" variant="outlined" sx={{ mr: 1 }} onClick={() => void inspect(item.timesheet_period!, item.id)}>{t('approvals.inspect')}</Button>
                      )}
                      {item.expense_report && (
                        <Button size="small" variant="outlined" sx={{ mr: 1 }} onClick={() => void inspectReport(item.expense_report!, item.id)}>{t('approvals.inspect')}</Button>
                      )}
                      {item.project_time_period && (
                        <Button size="small" variant="outlined" sx={{ mr: 1 }} onClick={() => void inspectProjectMonth(item.project_time_period!, item.id)}>{t('approvals.inspect')}</Button>
                      )}
                      {item.absence?.document_id && (
                        <Button size="small" variant="outlined" sx={{ mr: 1 }} onClick={() => void viewAbsenceDocument(item.absence!)}>{t('approvals.documents')}</Button>
                      )}
                      <Button size="small" variant="contained" sx={{ mr: 1 }} onClick={() => void approveItem(item.id)}>{t('approvals.approve')}</Button>
                      <Button size="small" color="error" onClick={() => setRejectingId(rejectingId === item.id ? null : item.id)}>{t('approvals.reject')}</Button>
                    </TableCell>
                  </TableRow>
                  {rejectingId === item.id && (
                    <TableRow>
                      <TableCell colSpan={5} sx={{ bgcolor: 'action.hover' }}>
                        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                          <TextField size="small" label={t('approvals.note')} value={note} onChange={(e) => setNote(e.target.value)} fullWidth />
                          <Button size="small" color="error" variant="contained" onClick={() => void rejectItem(item.id)}>{t('approvals.confirmReject')}</Button>
                        </Box>
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              ))}
              {filteredActionItems.length === 0 && (
                <TableEmptyRow
                  colSpan={5}
                  icon={<CheckCircleIcon fontSize="inherit" />}
                  title={actionItems.length === 0 ? t('approvals.nothingPending') : t('approvals.noMatch')}
                />
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      {role === 'admin' && (
        <Paper sx={{ p: 2 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>{t('approvals.approvedList', { count: approved.length })}</Typography>
          <TableContainer>
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
                      <Button size="small" variant="outlined" sx={{ mr: 1 }} onClick={() => void inspect(p, null)}>{t('approvals.inspect')}</Button>
                      <Button size="small" onClick={() => void reopen(p.id)}>{t('approvals.reopen')}</Button>
                    </TableCell>
                  </TableRow>
                ))}
                {approved.length === 0 && (
                  <TableEmptyRow colSpan={3} icon={<CheckCircleIcon fontSize="inherit" />} title={t('approvals.noneYet')} />
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}

      <Dialog open={!!inspectingMonth} onClose={() => setInspectingMonth(null)} maxWidth="md" fullWidth>
        <DialogTitle>
          {inspectingMonth
            ? t('approvals.reviewTimesheetFor', { name: inspectingMonth.user_display_name, period: periodLabel('month', inspectingMonth.period_start.slice(0, 10), locale) })
            : t('approvals.reviewTimesheet')}
        </DialogTitle>
        <DialogContent dividers>
          {monthError && <Alert severity="error" sx={{ mb: 2 }}>{monthError}</Alert>}
          {monthLoading && <LinearProgress sx={{ mb: 2 }} />}
          {inspectingMonth && (() => {
            const target = monthDays.reduce((sum, d) => sum + d.target, 0);
            const worked = monthDays.reduce((sum, d) => sum + d.attended, 0);
            return (
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center', mb: 2 }}>
                <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>{inspectingMonth.user_email}</Typography>
                <Chip label={`${t('timesheet.target')}: ${formatDurationMinutes(target)}`} variant="outlined" />
                <Chip label={`${t('timesheet.workHours')}: ${formatDurationMinutes(worked)}`} variant="outlined" />
                <Chip label={`${t('timesheet.difference')}: ${formatSignedMinutes(worked - target)}`} color={worked - target < 0 ? 'error' : 'success'} variant="outlined" />
              </Box>
            );
          })()}
          <TableContainer sx={{ maxHeight: 480 }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell>{t('timesheet.day')}</TableCell>
                  <TableCell align="right">{t('timesheet.target')}</TableCell>
                  <TableCell align="right">{t('timesheet.workHours')}</TableCell>
                  <TableCell align="right">{t('timesheet.difference')}</TableCell>
                  <TableCell>{t('timesheet.dayNote')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {monthDays.map((d) => {
                  const [y, m, dd] = d.date.split('-').map(Number);
                  const note = [d.holidayInfo?.name ?? '', d.absence > 0 && d.absenceType ? formatAbsenceType(d.absenceType, t) : ''].filter(Boolean).join(' · ');
                  return (
                    <TableRow key={d.date} sx={{ opacity: d.target === 0 && d.attended === 0 ? 0.5 : 1 }}>
                      <TableCell>{new Date(y, m - 1, dd).toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' })}</TableCell>
                      <TableCell align="right">{d.target ? formatDurationMinutes(d.target) : '—'}</TableCell>
                      <TableCell align="right">{d.attended ? formatDurationMinutes(d.attended) : '—'}</TableCell>
                      <TableCell align="right" sx={{ color: d.attended - d.target < 0 ? 'error.main' : undefined }}>
                        {d.target || d.attended ? formatSignedMinutes(d.attended - d.target) : ''}
                      </TableCell>
                      <TableCell>{note}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setInspectingMonth(null)}>{t('common.close')}</Button>
          {inspectingMonthItemId && (
            <>
              <Button
                color="error"
                onClick={() => {
                  const id = inspectingMonthItemId;
                  setInspectingMonth(null);
                  setRejectingId(id);
                }}
              >
                {t('approvals.reject')}…
              </Button>
              <Button
                variant="contained"
                onClick={async () => {
                  const id = inspectingMonthItemId;
                  setInspectingMonth(null);
                  await approveItem(id);
                }}
              >
                {t('approvals.approve')}
              </Button>
            </>
          )}
        </DialogActions>
      </Dialog>

      <Dialog open={!!inspectingPeriod} onClose={() => setInspectingPeriod(null)} maxWidth="md" fullWidth>
        <DialogTitle>
          {inspectingPeriod
            ? t('approvals.reviewProjectTimeFor', {
                name: inspectingPeriod.user_display_name,
                project: inspectingProject ?? '',
                period: periodLabel('month', inspectingPeriod.period_start.slice(0, 10), locale),
              })
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
                label={`${t('approvals.total')}: ${formatDurationMinutes(inspectingEntries.reduce((sum, e) => sum + minutes(e), 0))}`}
                color="primary"
                variant="outlined"
              />
            </Box>
          )}
          {inspectingEntries.length === 0 && !inspectingLoading ? (
            <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>{t('approvals.noEntries')}</Typography>
          ) : (
            <TableContainer>
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
                    const startTime = new Date(e.start_time).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
                    const endTime = new Date(e.end_time).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
                    return (
                      <TableRow key={e.id}>
                        <TableCell>{new Date(e.start_time).toLocaleDateString(locale)}</TableCell>
                        <TableCell>{`${startTime} – ${endTime}`}</TableCell>
                        <TableCell align="right">{formatDurationMinutes(minutes(e))}</TableCell>
                        <TableCell>{e.project_name ?? '—'}</TableCell>
                        <TableCell>{e.subproject_name ?? '—'}</TableCell>
                        <TableCell>{e.comment ?? '—'}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
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
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap', gap: 1 }}>
              <Typography variant="body2" color="text.secondary">{inspectingReport.user_email}</Typography>
              {reportTotalLabel && (
                <Chip label={`${t('approvals.total')}: ${reportTotalLabel}`} color="primary" variant="outlined" />
              )}
            </Box>
          )}
          {inspectingExpenses.length === 0 && !inspectingReportLoading ? (
            <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>{t('approvals.noExpenses')}</Typography>
          ) : (
            <TableContainer>
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
                      <TableCell>{formatLocaleDate(e.expense_date, locale)}</TableCell>
                      <TableCell>{categoryLabel(e)}</TableCell>
                      <TableCell align="right">{formatLocaleNumber(Number(e.value), locale)} {e.currency}</TableCell>
                      <TableCell>{e.project_name ?? '—'}</TableCell>
                      <TableCell>{e.subproject_name ?? '—'}</TableCell>
                      <TableCell>{e.comment ?? '—'}</TableCell>
                      <TableCell align="right">
                        {e.document_id && <Button size="small" onClick={() => void downloadExpenseDocument(e.id)}>{t('approvals.receipt')}</Button>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
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

      <Dialog open={!!inspectingAbsence} onClose={closeAbsenceDialog} maxWidth="sm" fullWidth>
        <DialogTitle>
          {inspectingAbsence ? t('approvals.evidenceFor', { name: inspectingAbsence.user_display_name }) : t('approvals.evidence')}
        </DialogTitle>
        <DialogContent dividers>
          {absenceDocument ? (
            <Box sx={{ display: 'grid', gap: 1.5 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
                <Box>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>{absenceDocument.file_name}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {t('absences.fileSize', { size: formatFileSize(absenceDocument.size_bytes, locale) })} · {new Date(absenceDocument.created_at).toLocaleString(locale)}
                  </Typography>
                </Box>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<DownloadIcon fontSize="small" />}
                  onClick={() => inspectingAbsence && void downloadAbsenceDocument(inspectingAbsence.id, absenceDocument)}
                >
                  {t('approvals.download')}
                </Button>
              </Box>
              {absencePreviewUrl && absenceDocument.mime_type.startsWith('image/') && (
                <Box component="img" src={absencePreviewUrl} alt={absenceDocument.file_name} sx={{ maxWidth: '100%', maxHeight: 360, objectFit: 'contain', borderRadius: 1 }} />
              )}
              {absencePreviewUrl && absenceDocument.mime_type === 'application/pdf' && (
                <Box component="iframe" src={absencePreviewUrl} title={absenceDocument.file_name} sx={{ width: '100%', height: 380, border: 1, borderColor: 'divider', borderRadius: 1 }} />
              )}
            </Box>
          ) : (
            <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>{t('approvals.noDocument')}</Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={closeAbsenceDialog}>{t('common.close')}</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
