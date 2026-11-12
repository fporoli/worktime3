import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Chip,
  Dialog,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  LinearProgress,
  Paper,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { useI18n } from './i18n';
import { formatDurationMinutes, formatSignedMinutes } from './localeFormat';
import { PageHeader, TableEmptyRow } from './components';
import { AccountBalanceWalletIcon, ChevronLeftIcon, ChevronRightIcon, CloseIcon } from './icons';
import { BalancesPanel, MonthStatusChip, formatDays, monthName, type MonthBalance } from './BalancesPanel';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';

type ReportAlert =
  | 'overtime-high'
  | 'overtime-low'
  | 'not-submitted'
  | 'awaiting-approval'
  | 'rejected'
  | 'vacation-negative'
  | 'legal-overtime'
  | 'legal-overtime-limit';

interface ReportRow {
  userId: string;
  displayName: string;
  email: string;
  month: MonthBalance;
  vacationRemaining: number;
  /** Überzeit accrued in the year up to the end of the month, and the legal yearly limit. */
  legalYearToDate: number;
  legalYearLimit: number;
  alerts: ReportAlert[];
}

const ALERT_COLOR: Record<ReportAlert, 'error' | 'warning' | 'info'> = {
  'overtime-high': 'warning',
  'overtime-low': 'error',
  'not-submitted': 'warning',
  'awaiting-approval': 'info',
  rejected: 'error',
  'vacation-negative': 'error',
  'legal-overtime': 'info',
  'legal-overtime-limit': 'error',
};

/** The month before the current one, as 'YYYY-MM' — the one HR usually reviews. */
function defaultMonth(): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + by, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Time balances: one month for everyone the caller may see (managers their reports, HR and
 * admins everyone), with overtime and vacation balances and alerts — balance beyond the
 * organization's thresholds, timesheet not submitted or not yet approved, vacation overdrawn.
 */
export default function BalanceReport({ orgId, authHeaders }: { orgId: string; authHeaders: () => Promise<Record<string, string>> }) {
  const { t, locale } = useI18n();
  const [month, setMonth] = useState(defaultMonth());
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [onlyAlerts, setOnlyAlerts] = useState(false);
  const [selected, setSelected] = useState<ReportRow | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`${API}/organizations/${orgId}/balances/report?month=${month}`, { headers: await authHeaders() });
        const body = await res.json();
        if (cancelled) return;
        if (body.ok === false) setError(t(`balances.error.${body.error}`));
        else {
          setRows(Array.isArray(body.rows) ? body.rows : []);
          setError(null);
        }
      } catch {
        if (!cancelled) setError(t('balances.error.load'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, month, refreshKey]);

  const shown = useMemo(() => (onlyAlerts ? rows.filter((r) => r.alerts.length > 0) : rows), [rows, onlyAlerts]);
  const alertCount = rows.filter((r) => r.alerts.length > 0).length;

  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <PageHeader title={t('nav.balances')} subtitle={t('balanceReport.subtitle')} />
      <Paper sx={{ p: 2, display: 'grid', gap: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <IconButton size="small" aria-label={t('balanceReport.previousMonth')} onClick={() => setMonth((m) => shiftMonth(m, -1))}>
            <ChevronLeftIcon fontSize="small" />
          </IconButton>
          <Typography variant="h6" sx={{ minWidth: 160, textAlign: 'center' }}>{monthName(`${month}-01`, locale)}</Typography>
          <IconButton size="small" aria-label={t('balanceReport.nextMonth')} onClick={() => setMonth((m) => shiftMonth(m, 1))}>
            <ChevronRightIcon fontSize="small" />
          </IconButton>
          <Box sx={{ flex: 1 }} />
          <FormControlLabel
            control={<Switch checked={onlyAlerts} onChange={(e) => setOnlyAlerts(e.target.checked)} />}
            label={t('balanceReport.onlyAlerts', { count: alertCount })}
          />
        </Box>
        {loading && <LinearProgress />}
        {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('balanceReport.person')}</TableCell>
                <TableCell>{t('balances.status')}</TableCell>
                <TableCell align="right">{t('balances.target')}</TableCell>
                <TableCell align="right">{t('balances.actual')}</TableCell>
                <TableCell align="right">{t('balances.difference')}</TableCell>
                <TableCell align="right">{t('balances.balance')}</TableCell>
                <TableCell align="right">{t('balanceReport.legalYearToDate')}</TableCell>
                <TableCell align="right">{t('balanceReport.vacationLeft')}</TableCell>
                <TableCell>{t('balanceReport.alerts')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {shown.map((r) => {
                const m = r.month;
                const inactive = m.status === 'before-start';
                return (
                  <TableRow key={r.userId} hover sx={{ cursor: 'pointer' }} onClick={() => setSelected(r)}>
                    <TableCell>
                      <Typography variant="body2" fontWeight={600}>{r.displayName}</Typography>
                      <Typography variant="caption" color="text.secondary">{r.email}</Typography>
                    </TableCell>
                    <TableCell><MonthStatusChip status={m.status} /></TableCell>
                    <TableCell align="right">{inactive ? '—' : formatDurationMinutes(m.monthTarget)}</TableCell>
                    <TableCell align="right">{inactive || m.status === 'future' ? '—' : formatDurationMinutes(m.actual)}</TableCell>
                    <TableCell align="right" sx={{ color: m.delta < 0 ? 'error.main' : undefined }}>
                      {inactive || m.status === 'future' ? '—' : formatSignedMinutes(m.delta)}
                    </TableCell>
                    <TableCell align="right" sx={{ fontWeight: 600, color: m.overtimeBalance < 0 ? 'error.main' : undefined }}>
                      {formatSignedMinutes(m.overtimeBalance)}
                    </TableCell>
                    <TableCell align="right" sx={{ color: r.legalYearToDate > r.legalYearLimit ? 'error.main' : undefined, whiteSpace: 'nowrap' }}>
                      {r.legalYearToDate ? `${formatDurationMinutes(r.legalYearToDate)} / ${formatDurationMinutes(r.legalYearLimit)}` : '—'}
                    </TableCell>
                    <TableCell align="right" sx={{ color: r.vacationRemaining < 0 ? 'error.main' : undefined }}>
                      {formatDays(r.vacationRemaining, locale)}
                    </TableCell>
                    <TableCell>
                      <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                        {r.alerts.map((a) => (
                          <Chip key={a} size="small" color={ALERT_COLOR[a]} label={t(`balanceReport.alert.${a}`)} />
                        ))}
                      </Box>
                    </TableCell>
                  </TableRow>
                );
              })}
              {!loading && shown.length === 0 && (
                <TableEmptyRow
                  colSpan={9}
                  icon={<AccountBalanceWalletIcon fontSize="inherit" />}
                  title={onlyAlerts ? t('balanceReport.noAlerts') : t('balanceReport.empty')}
                />
              )}
            </TableBody>
          </Table>
        </TableContainer>
        <Typography variant="caption" color="text.secondary">{t('balanceReport.help')}</Typography>
      </Paper>

      <Dialog open={!!selected} onClose={() => setSelected(null)} fullWidth maxWidth="lg">
        <DialogTitle sx={{ display: 'flex', alignItems: 'center' }}>
          <Box sx={{ flex: 1 }}>{selected ? t('balances.forUser', { name: selected.displayName }) : ''}</Box>
          <IconButton aria-label={t('common.close')} onClick={() => setSelected(null)}>
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent>
          {selected && (
            <BalancesPanel orgId={orgId} userId={selected.userId} authHeaders={authHeaders} onChanged={() => setRefreshKey((k) => k + 1)} />
          )}
        </DialogContent>
      </Dialog>
    </Box>
  );
}
