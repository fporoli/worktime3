import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
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
import { periodLabel } from './aggregate';
import { useI18n } from './i18n';
import { formatDurationMinutes } from './localeFormat';
import { PageHeader, TableEmptyRow } from './components';
import { ChevronLeftIcon, ChevronRightIcon, WorkspacesIcon } from './icons';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';

type Status = 'open' | 'submitted' | 'approved' | 'rejected';

interface ProjectMonth {
  project_id: string;
  project_name: string | null;
  owner_user_id: string | null;
  owner_name: string | null;
  minutes: number;
  entries: number;
  period: { id: string; status: Status; submitted_at: string | null; reviewed_at: string | null; review_note: string | null; reviewer_name: string | null } | null;
}

const STATUS_COLOR: Record<Status, 'default' | 'warning' | 'success' | 'error'> = {
  open: 'default',
  submitted: 'warning',
  approved: 'success',
  rejected: 'error',
};

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + by, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Project timesheet: the month's project time per project, submitted for approval by each
 * project's owner. Separate from the working-time timesheet (Timesheet.tsx), which goes to the
 * line manager. A project month that is submitted or approved can no longer be changed; a
 * rejected one can be corrected and submitted again.
 */
export default function ProjectTimesheet({ orgId, authHeaders }: { orgId: string; authHeaders: () => Promise<Record<string, string>> }) {
  const { t, locale } = useI18n();
  const [month, setMonth] = useState(currentMonth());
  const [projects, setProjects] = useState<ProjectMonth[]>([]);
  const [unassigned, setUnassigned] = useState({ minutes: 0, entries: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  async function reload(m = month) {
    setLoading(true);
    try {
      const res = await fetch(`${API}/organizations/${orgId}/project-timesheets?month=${m}`, { headers: await authHeaders() });
      const data = await res.json();
      if (data?.ok === false) setError(t(`projectTimesheet.error.${data.error}`));
      setProjects(Array.isArray(data?.projects) ? data.projects : []);
      setUnassigned(data?.unassigned ?? { minutes: 0, entries: 0 });
    } catch {
      setError(t('common.cannotReachApi'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload(month);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, month]);

  async function post(path: string, body?: unknown): Promise<{ ok: boolean; error?: string; [k: string]: unknown } | null> {
    setError(null);
    setSuccess(null);
    setBusy(true);
    try {
      const res = await fetch(`${API}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify(body ?? {}),
      });
      const data = await res.json();
      if (!data?.ok) {
        setError(t(`projectTimesheet.error.${data?.error ?? 'failed'}`, { count: String(data?.entries ?? '') }));
        return null;
      }
      return data;
    } catch {
      setError(t('common.cannotReachApi'));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    const data = await post(`/organizations/${orgId}/project-timesheets/submit`, { periodStart: `${month}-01`, note: note.trim() || undefined });
    if (!data) return;
    const results = (data.projects ?? []) as { status: string }[];
    const approvedNow = results.filter((r) => r.status === 'approved').length;
    setSuccess(t('projectTimesheet.submitted', { count: String(results.length - approvedNow), approved: String(approvedNow) }));
    setNote('');
    await reload();
  }

  async function withdraw(periodId: string) {
    if (await post(`/project-timesheets/${periodId}/withdraw`)) {
      setSuccess(t('projectTimesheet.withdrawn'));
      await reload();
    }
  }

  const openProjects = projects.filter((p) => p.minutes > 0 && (!p.period || p.period.status === 'open' || p.period.status === 'rejected'));
  const total = projects.reduce((s, p) => s + p.minutes, 0) + unassigned.minutes;
  const statusOf = (p: ProjectMonth): Status => p.period?.status ?? 'open';

  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <PageHeader title={t('projectTimesheet.title')} subtitle={t('projectTimesheet.subtitle')} />
      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
      {success && <Alert severity="success" onClose={() => setSuccess(null)}>{success}</Alert>}
      {loading && <LinearProgress />}

      <Paper sx={{ p: 2, display: 'grid', gap: 2 }}>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
          <Button size="small" startIcon={<ChevronLeftIcon fontSize="small" />} onClick={() => setMonth((m) => shiftMonth(m, -1))}>
            {t('balanceReport.previousMonth')}
          </Button>
          <TextField type="month" size="small" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
          <Button size="small" endIcon={<ChevronRightIcon fontSize="small" />} onClick={() => setMonth((m) => shiftMonth(m, 1))}>
            {t('balanceReport.nextMonth')}
          </Button>
          <Box sx={{ flex: 1 }} />
          <Typography variant="body2" color="text.secondary">
            {periodLabel('month', `${month}-01`, locale)} · {t('projectTimesheet.total', { value: formatDurationMinutes(total) })}
          </Typography>
        </Box>

        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('common.project')}</TableCell>
                <TableCell>{t('projectTimesheet.approver')}</TableCell>
                <TableCell align="right">{t('time.entries')}</TableCell>
                <TableCell align="right">{t('approvals.duration')}</TableCell>
                <TableCell>{t('timesheet.status')}</TableCell>
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {projects.map((p) => {
                const status = statusOf(p);
                return (
                  <TableRow key={p.project_id}>
                    <TableCell sx={{ fontWeight: 600 }}>{p.project_name ?? '—'}</TableCell>
                    <TableCell>{p.owner_name ?? t('projectTimesheet.noOwner')}</TableCell>
                    <TableCell align="right">{p.entries}</TableCell>
                    <TableCell align="right">{formatDurationMinutes(p.minutes)}</TableCell>
                    <TableCell>
                      <Chip size="small" label={t(`timesheet.status.${status}`)} color={STATUS_COLOR[status]} />
                      {p.period?.review_note && (
                        <Typography variant="caption" color={status === 'rejected' ? 'error' : 'text.secondary'} sx={{ display: 'block', mt: 0.5 }}>
                          {p.period.reviewer_name ? `${p.period.reviewer_name}: ` : ''}
                          {p.period.review_note}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell align="right">
                      {status === 'submitted' && p.period && (
                        <Button size="small" disabled={busy} onClick={() => void withdraw(p.period!.id)}>{t('projectTimesheet.withdraw')}</Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
              {unassigned.entries > 0 && (
                <TableRow>
                  <TableCell colSpan={2}>
                    <Typography variant="body2" color="error">{t('projectTimesheet.unassigned')}</Typography>
                  </TableCell>
                  <TableCell align="right">{unassigned.entries}</TableCell>
                  <TableCell align="right">{formatDurationMinutes(unassigned.minutes)}</TableCell>
                  <TableCell colSpan={2} />
                </TableRow>
              )}
              {!loading && projects.length === 0 && unassigned.entries === 0 && (
                <TableEmptyRow colSpan={6} icon={<WorkspacesIcon fontSize="inherit" />} title={t('projectTimesheet.empty')} />
              )}
            </TableBody>
          </Table>
        </TableContainer>

        {unassigned.entries > 0 && <Alert severity="warning">{t('projectTimesheet.unassignedHelp')}</Alert>}

        {openProjects.length > 0 && (
          <>
            <Alert severity="info">{t('projectTimesheet.submitExplain', { count: String(openProjects.length) })}</Alert>
            <TextField
              size="small"
              label={t('timesheet.submitNote')}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              multiline
              minRows={2}
              sx={{ maxWidth: 900 }}
            />
            <Box>
              <Button variant="contained" size="small" disabled={busy || unassigned.entries > 0} onClick={() => void submit()}>
                {t('projectTimesheet.submit', { count: String(openProjects.length) })}
              </Button>
            </Box>
          </>
        )}
      </Paper>
    </Box>
  );
}
