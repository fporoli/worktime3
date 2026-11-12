import { useEffect, useMemo, useState } from 'react';
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
  Typography,
  useTheme,
} from '@mui/material';
import { BarChart } from '@mui/x-charts/BarChart';
import { bucket, minutes, periodRange, shiftPeriod, startOfWeek, todayDate, type Entry } from './aggregate';
import BalanceOverview from './BalanceOverview';
import { useI18n } from './i18n';
import { formatDurationMinutes, formatSignedMinutes } from './localeFormat';
import { formatDays } from './BalancesPanel';
import { PageHeader, TableEmptyRow } from './components';
import { ReviewQueue } from './BasicDataPanel';
import {
  BeachAccessIcon,
  CalendarMonthIcon,
  CheckCircleIcon,
  PlayArrowIcon,
  ReceiptLongIcon,
  ScheduleIcon,
  StopIcon,
} from './icons';

export { BasicDataPanel, sectionKeys } from './BasicDataPanel';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';

interface WorkSession {
  id: string;
  check_in: string;
  check_out: string | null;
}

interface Balance {
  /** Closed months plus adjustments. */
  overtimeMinutes: number;
  /** Days before today in months not closed yet. */
  pendingOvertimeMinutes: number;
  vacationDays: number;
}

interface TimesheetPeriod {
  id: string;
  period_start: string;
  status: 'open' | 'submitted' | 'approved' | 'rejected';
}

interface ActionItemSummary {
  id: string;
  definition_name: string;
  source: string | null;
}

export interface HomeProps {
  orgId: string;
  userId: string;
  displayName: string;
  canManage: boolean;
  isHrOrAdmin: boolean;
  authHeaders: () => Promise<Record<string, string>>;
  onNavigate: (section: 'time' | 'timesheet' | 'workTime' | 'absences' | 'expenses' | 'approvals' | 'myData') => void;
  onWorkTimeChanged?: () => void;
  onReviewResolved?: () => void;
}

const TIMESHEET_COLOR: Record<TimesheetPeriod['status'], 'default' | 'warning' | 'success' | 'error'> = {
  open: 'default',
  submitted: 'warning',
  approved: 'success',
  rejected: 'error',
};

export default function Home({
  orgId,
  userId,
  displayName,
  canManage,
  isHrOrAdmin,
  authHeaders,
  onNavigate,
  onWorkTimeChanged,
  onReviewResolved,
}: HomeProps) {
  const { t, locale } = useI18n();
  const theme = useTheme();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<WorkSession | null>(null);
  const [balance, setBalance] = useState<Balance | null>(null);
  const [weekEntries, setWeekEntries] = useState<Entry[]>([]);
  const [timesheetStatus, setTimesheetStatus] = useState<TimesheetPeriod['status']>('open');
  const [approvalsCount, setApprovalsCount] = useState<number>(0);
  const [now, setNow] = useState(() => Date.now());
  const [clockBusy, setClockBusy] = useState(false);

  const today = todayDate();
  const currentMonthStart = `${today.slice(0, 7)}-01`;
  const weekStart = startOfWeek(today);

  async function loadDashboard() {
    setLoading(true);
    setError(null);
    const headers = await authHeaders();
    const { from, to } = periodRange('week', today);
    try {
      const requests: Promise<Response>[] = [
        fetch(`${API}/work-time/status`, { headers }),
        fetch(`${API}/organizations/${orgId}/balances`, { headers }),
        fetch(`${API}/organizations/${orgId}/project-time?userId=${userId}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, { headers }),
        fetch(`${API}/organizations/${orgId}/timesheet-periods?userId=${userId}`, { headers }),
      ];
      if (canManage) {
        requests.push(fetch(`${API}/workflows/assigned-to-me`, { headers }));
      }
      const responses = await Promise.all(requests);
      const [statusData, balanceData, entriesData, periodsData, workflowsData] = await Promise.all(
        responses.map((r) => r.json().catch(() => null)),
      );
      setStatus(statusData && statusData.check_in ? statusData : null);
      setBalance(
        balanceData && typeof balanceData.overtimeMinutes === 'number'
          ? { overtimeMinutes: balanceData.overtimeMinutes, pendingOvertimeMinutes: balanceData.pendingOvertimeMinutes ?? 0, vacationDays: balanceData.vacationDays ?? 0 }
          : null,
      );
      setWeekEntries(Array.isArray(entriesData?.entries) ? entriesData.entries : []);
      if (Array.isArray(periodsData)) {
        const cur = periodsData.find((p: TimesheetPeriod) => p.period_start === currentMonthStart);
        setTimesheetStatus(cur?.status ?? 'open');
      }
      if (canManage && Array.isArray(workflowsData)) {
        setApprovalsCount((workflowsData as ActionItemSummary[]).length);
      } else {
        setApprovalsCount(0);
      }
    } catch {
      /* offline fallback */
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadDashboard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, userId, canManage]);

  const checkedIn = !!status && !status.check_out;
  useEffect(() => {
    if (!checkedIn) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [checkedIn]);

  async function toggleClock() {
    setClockBusy(true);
    setError(null);
    try {
      const headers = { 'Content-Type': 'application/json', ...(await authHeaders()) };
      const res = checkedIn
        ? await fetch(`${API}/work-time/check-out`, { method: 'POST', headers })
        : await fetch(`${API}/organizations/${orgId}/work-time/check-in`, { method: 'POST', headers, body: JSON.stringify({}) });
      const data = await res.json();
      if (!data.ok) {
        setError(t(checkedIn ? 'workTime.checkOutFailed' : 'workTime.checkInFailed', { error: data.error ?? t('common.unknownError') }));
        return;
      }
      await loadDashboard();
      onWorkTimeChanged?.();
    } catch {
      setError(t('common.cannotReachApi'));
    } finally {
      setClockBusy(false);
    }
  }

  const elapsedMinutes = checkedIn ? Math.max(0, Math.round((now - new Date(status!.check_in).getTime()) / 60000)) : 0;
  const totalWeekMinutes = weekEntries.reduce((sum, e) => sum + minutes(e), 0);

  const weekChartData = useMemo(() => {
    const byDay = new Map(bucket(weekEntries, 'daily').map((r) => [r.label, r.minutes]));
    const days: { day: string; hours: number }[] = [];
    for (let i = 0; i < 7; i += 1) {
      const dStr = shiftPeriod('day', weekStart, i);
      const [y, m, d] = dStr.split('-').map(Number);
      const label = new Date(y, m - 1, d).toLocaleDateString(locale, { weekday: 'short' });
      const mins = byDay.get(dStr) ?? 0;
      days.push({ day: label, hours: Math.round((mins / 60) * 100) / 100 });
    }
    return days;
  }, [weekEntries, weekStart, locale]);

  const recentEntries = useMemo(
    () => [...weekEntries].sort((a, b) => (a.start_time < b.start_time ? 1 : -1)).slice(0, 5),
    [weekEntries],
  );

  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <PageHeader
        title={t('dashboard.title')}
        subtitle={t('dashboard.subtitle', { name: displayName })}
        end={
          <Button
            variant="contained"
            color={checkedIn ? 'warning' : 'success'}
            disabled={clockBusy}
            startIcon={checkedIn ? <StopIcon fontSize="small" /> : <PlayArrowIcon fontSize="small" />}
            onClick={toggleClock}
          >
            {checkedIn ? `${t('workTime.checkOut')} (${formatDurationMinutes(elapsedMinutes)})` : t('workTime.checkIn')}
          </Button>
        }
      />

      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
      {loading && <LinearProgress />}

      {/* Quick Actions */}
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        <Button size="small" variant="outlined" startIcon={<ScheduleIcon fontSize="small" />} onClick={() => onNavigate('time')}>
          {t('dashboard.logTime')}
        </Button>
        <Button size="small" variant="outlined" startIcon={<BeachAccessIcon fontSize="small" />} onClick={() => onNavigate('absences')}>
          {t('dashboard.requestAbsence')}
        </Button>
        <Button size="small" variant="outlined" startIcon={<ReceiptLongIcon fontSize="small" />} onClick={() => onNavigate('expenses')}>
          {t('dashboard.addExpense')}
        </Button>
        <Button size="small" variant="outlined" startIcon={<CalendarMonthIcon fontSize="small" />} onClick={() => onNavigate('timesheet')}>
          {t('dashboard.openTimesheet')}
        </Button>
      </Box>

      {/* KPI Cards */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' },
          gap: 2,
        }}
      >
        <Paper sx={{ p: 2, cursor: 'pointer' }} onClick={() => onNavigate('workTime')}>
          <Typography variant="caption" color="text.secondary">{t('dashboard.attendance')}</Typography>
          <Typography variant="h6" sx={{ mt: 0.5, color: checkedIn ? 'success.main' : 'text.primary' }}>
            {checkedIn ? formatDurationMinutes(elapsedMinutes) : t('dashboard.checkedOut')}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {checkedIn ? t('dashboard.checkedIn') : t('workTime.checkIn')}
          </Typography>
        </Paper>

        <Paper sx={{ p: 2, cursor: 'pointer' }} onClick={() => onNavigate('time')}>
          <Typography variant="caption" color="text.secondary">{t('dashboard.weekHours')}</Typography>
          <Typography variant="h6" sx={{ mt: 0.5 }}>{formatDurationMinutes(totalWeekMinutes)}</Typography>
          <Typography variant="caption" color="text.secondary">
            {weekEntries.length} {t('time.entries').toLowerCase()}
          </Typography>
        </Paper>

        <Paper sx={{ p: 2, cursor: 'pointer' }} onClick={() => onNavigate('workTime')}>
          <Typography variant="caption" color="text.secondary">{t('dashboard.overtime')}</Typography>
          <Typography
            variant="h6"
            sx={{ mt: 0.5, color: balance && balance.overtimeMinutes + balance.pendingOvertimeMinutes < 0 ? 'error.main' : 'success.main' }}
          >
            {balance ? formatSignedMinutes(balance.overtimeMinutes + balance.pendingOvertimeMinutes) : '—'}
          </Typography>
          <Typography variant="caption" color="text.secondary">{t('balances.type.overtime')}</Typography>
        </Paper>

        <Paper sx={{ p: 2, cursor: 'pointer' }} onClick={() => onNavigate('absences')}>
          <Typography variant="caption" color="text.secondary">{t('dashboard.vacation')}</Typography>
          <Typography variant="h6" sx={{ mt: 0.5 }}>
            {balance ? t('balances.days', { value: formatDays(balance.vacationDays, locale) }) : '—'}
          </Typography>
          <Typography variant="caption" color="text.secondary">{t('balances.type.vacation')}</Typography>
        </Paper>
      </Box>

      {/* Main grid: Weekly Hours Chart + Action Cards */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', lg: '2fr 1fr' },
          gap: 2,
          alignItems: 'start',
        }}
      >
        <Box sx={{ display: 'grid', gap: 2 }}>
          <Paper sx={{ p: 2 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>{t('dashboard.weeklyChart')}</Typography>
            <BarChart
              height={220}
              dataset={weekChartData}
              xAxis={[{ scaleType: 'band', dataKey: 'day' }]}
              series={[{ dataKey: 'hours', color: theme.palette.primary.main, valueFormatter: (v) => (v == null ? '' : `${v}h`) }]}
              margin={{ top: 16, right: 16, bottom: 28, left: 40 }}
            />
          </Paper>

          <Paper sx={{ p: 2 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>{t('dashboard.recentEntries')}</Typography>
              <Button size="small" onClick={() => onNavigate('time')}>{t('notifications.viewAction')}</Button>
            </Box>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>{t('time.date')}</TableCell>
                    <TableCell>{t('time.project')}</TableCell>
                    <TableCell>{t('time.comment')}</TableCell>
                    <TableCell align="right">{t('approvals.duration')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {recentEntries.map((e) => (
                    <TableRow key={e.id} hover>
                      <TableCell>{new Date(e.start_time).toLocaleDateString(locale)}</TableCell>
                      <TableCell>{e.project_name ?? '—'}</TableCell>
                      <TableCell>{e.comment || '—'}</TableCell>
                      <TableCell align="right">{formatDurationMinutes(minutes(e))}</TableCell>
                    </TableRow>
                  ))}
                  {recentEntries.length === 0 && (
                    <TableEmptyRow colSpan={4} icon={<ScheduleIcon fontSize="inherit" />} title={t('time.noEntries')} />
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>
        </Box>

        <Box sx={{ display: 'grid', gap: 2 }}>
          <BalanceOverview orgId={orgId} authHeaders={authHeaders} refreshKey={status?.check_out ?? status?.check_in} layout="column" />
          <Paper sx={{ p: 2 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>{t('dashboard.currentTimesheet')}</Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
              <Box>
                <Typography variant="body2" color="text.secondary">{currentMonthStart.slice(0, 7)}</Typography>
                <Chip
                  label={t(`timesheet.status.${timesheetStatus}`)}
                  color={TIMESHEET_COLOR[timesheetStatus]}
                  size="small"
                  sx={{ mt: 0.75 }}
                />
              </Box>
              <Button size="small" variant="outlined" onClick={() => onNavigate('timesheet')}>
                {t('dashboard.openTimesheet')}
              </Button>
            </Box>
          </Paper>

          {canManage && (
            <Paper sx={{ p: 2 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                <CheckCircleIcon fontSize="small" color={approvalsCount > 0 ? 'warning' : 'success'} />
                <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                  {t('dashboard.pendingApprovals', { count: approvalsCount })}
                </Typography>
              </Box>
              <Button size="small" variant="contained" onClick={() => onNavigate('approvals')}>
                {t('dashboard.openApprovals')}
              </Button>
            </Paper>
          )}

          {isHrOrAdmin && (
            <ReviewQueue orgId={orgId} authHeaders={authHeaders} onResolved={onReviewResolved} />
          )}
        </Box>
      </Box>
    </Box>
  );
}
