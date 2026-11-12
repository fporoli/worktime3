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
  IconButton,
  LinearProgress,
  MenuItem,
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
import { formatLocaleDate, formatSignedMinutes, formatDurationMinutes, parseLocaleNumber } from './localeFormat';
import { TableEmptyRow } from './components';
import { AccountBalanceWalletIcon, AddIcon, ChevronLeftIcon, ChevronRightIcon, DeleteIcon, EditIcon } from './icons';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';

export type MonthStatus = 'closed' | 'submitted' | 'rejected' | 'open' | 'current' | 'future' | 'before-start';

export interface MonthBalance {
  month: string;
  status: MonthStatus;
  closedAt: string | null;
  scheduled: number;
  holiday: number;
  absenceByType: Record<string, number>;
  target: number;
  actual: number;
  delta: number;
  vacationDays: number;
  monthTarget: number;
  plannedVacationDays: number;
  adjustmentMinutes: number;
  overtimeOpening: number;
  overtimeBalance: number;
  vacationOpening: number;
  vacationCredited: number;
  vacationAdjustmentDays: number;
  vacationBalance: number;
  legalOvertimeMinutes: number;
  legalOvertimeAdjustments: number;
  legalOvertimeBalance: number;
}

export type BalanceAccount = 'overtime' | 'vacation' | 'legal_overtime';

interface Adjustment {
  id: string;
  balance: BalanceAccount;
  kind: 'opening' | 'correction' | 'payout';
  effectiveDate: string;
  amount: number;
  note: string | null;
}

interface YearBalances {
  ok: boolean;
  error?: string;
  year: number;
  start: string;
  months: MonthBalance[];
  overtime: { opening: number; closing: number; bookedMinutes: number; pendingMinutes: number };
  vacation: { carryOver: number; entitlement: number; entitlementOverridden: boolean; adjustments: number; taken: number; planned: number; remaining: number };
  legalOvertime: { opening: number; closing: number; accrued: number; adjustments: number; yearLimitMinutes: number; maxWeeklyMinutes: number };
  adjustments: Adjustment[];
  canEdit: boolean;
}

const STATUS_COLOR: Record<MonthStatus, 'success' | 'info' | 'error' | 'warning' | 'default'> = {
  closed: 'success',
  submitted: 'info',
  rejected: 'error',
  open: 'warning',
  current: 'default',
  future: 'default',
  'before-start': 'default',
};

export function formatDays(days: number, locale: string): string {
  return new Intl.NumberFormat(locale, { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(days);
}

export function monthName(month: string, locale: string, style: 'long' | 'short' = 'long'): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(locale, { month: style, year: style === 'short' ? undefined : 'numeric' });
}

/** "-1:30", "+2:15", "-1.5" or "1,5" hours as signed minutes; null when not readable. */
export function parseSignedHours(text: string): number | null {
  const s = text.trim().replace('−', '-');
  const sign = s.startsWith('-') ? -1 : 1;
  const body = s.replace(/^[+-]/, '').trim();
  const hm = /^(\d{1,5}):([0-5]\d)$/.exec(body);
  if (hm) return sign * (Number(hm[1]) * 60 + Number(hm[2]));
  if (/^\d{1,5}([.,]\d+)?$/.test(body)) return sign * Math.round(Number(body.replace(',', '.')) * 60);
  return null;
}

export function MonthStatusChip({ status }: { status: MonthStatus }) {
  const { t } = useI18n();
  if (status === 'before-start') return <Typography variant="body2" color="text.disabled">—</Typography>;
  return <Chip size="small" label={t(`balances.status.${status}`)} color={STATUS_COLOR[status]} variant={status === 'future' || status === 'current' ? 'outlined' : 'filled'} />;
}

/**
 * One person's balances for a year: overtime month by month (closed months frozen at timesheet
 * approval, open ones computed live), vacation in days, and the adjustments behind them.
 * HR (edit on Time balances) books adjustments and sets the vacation entitlement here.
 */
export function BalancesPanel({
  orgId,
  userId,
  authHeaders,
  refreshKey = 0,
  onChanged,
}: {
  orgId: string;
  /** Someone else's balances; omitted for the caller's own. */
  userId?: string;
  authHeaders: () => Promise<Record<string, string>>;
  refreshKey?: number;
  onChanged?: () => void;
}) {
  const { t, locale } = useI18n();
  const [year, setYear] = useState(new Date().getFullYear());
  const [data, setData] = useState<YearBalances | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [entitlementOpen, setEntitlementOpen] = useState(false);

  async function reload() {
    setLoading(true);
    try {
      const params = new URLSearchParams({ year: String(year) });
      if (userId) params.set('userId', userId);
      const res = await fetch(`${API}/organizations/${orgId}/balances/year?${params}`, { headers: await authHeaders() });
      const body = (await res.json()) as YearBalances;
      if (body.ok === false) {
        setError(t(`balances.error.${body.error ?? 'load'}`));
        setData(null);
      } else if (Array.isArray(body.months)) {
        setData(body);
        setError(null);
      }
    } catch {
      setError(t('balances.error.load'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, userId, year, refreshKey]);

  async function deleteAdjustment(id: string) {
    const res = await fetch(`${API}/organizations/${orgId}/balances/adjustments/${id}`, { method: 'DELETE', headers: await authHeaders() });
    const body = await res.json().catch(() => ({ ok: false, error: 'load' }));
    if (body.ok === false) setError(t(`balances.error.${body.error}`));
    else {
      setSuccess(t('balances.adjustmentDeleted'));
      await reload();
      onChanged?.();
    }
  }

  const targetUserId = userId;
  const months = data?.months ?? [];
  const visibleMonths = months.filter((m) => m.status !== 'before-start');
  const absenceTitle = (m: MonthBalance) =>
    Object.entries(m.absenceByType)
      .map(([type, minutes]) => {
        // An organization's own absence types have no translation: show the key.
        const label = t(`absences.type.${type}`);
        return `${label === `absences.type.${type}` ? type : label}: ${formatDurationMinutes(minutes)}`;
      })
      .join('\n');

  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <IconButton size="small" aria-label={t('balances.previousYear')} onClick={() => setYear((y) => y - 1)}>
          <ChevronLeftIcon fontSize="small" />
        </IconButton>
        <Typography variant="h6" sx={{ minWidth: 64, textAlign: 'center' }}>{year}</Typography>
        <IconButton size="small" aria-label={t('balances.nextYear')} onClick={() => setYear((y) => y + 1)}>
          <ChevronRightIcon fontSize="small" />
        </IconButton>
        {data && (
          <Typography variant="body2" color="text.secondary" sx={{ ml: 1 }}>
            {t('balances.since', { date: formatLocaleDate(data.start, locale) })}
          </Typography>
        )}
        <Box sx={{ flex: 1 }} />
        {data?.canEdit && targetUserId && (
          <Button size="small" startIcon={<AddIcon />} onClick={() => setAdjustOpen(true)}>
            {t('balances.addAdjustment')}
          </Button>
        )}
      </Box>

      {loading && <LinearProgress />}
      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
      {success && <Alert severity="success" onClose={() => setSuccess(null)}>{success}</Alert>}

      {data && (
        <>
          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' } }}>
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Typography variant="subtitle2" color="text.secondary">{t('balances.type.overtime')}</Typography>
              <Typography variant="h5" color={data.overtime.closing < 0 ? 'error.main' : 'success.main'}>
                {formatSignedMinutes(data.overtime.closing)}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {t('balances.overtimeOpening', { value: formatSignedMinutes(data.overtime.opening) })}
              </Typography>
              <Typography variant="body2" color={data.legalOvertime.accrued > data.legalOvertime.yearLimitMinutes ? 'error.main' : 'text.secondary'}>
                {t('balances.legalLine', {
                  value: formatSignedMinutes(data.legalOvertime.closing),
                  accrued: formatDurationMinutes(data.legalOvertime.accrued),
                  limit: formatDurationMinutes(data.legalOvertime.yearLimitMinutes),
                  max: formatDurationMinutes(data.legalOvertime.maxWeeklyMinutes),
                })}
              </Typography>
            </Paper>
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Box sx={{ display: 'flex', alignItems: 'center' }}>
                <Typography variant="subtitle2" color="text.secondary" sx={{ flex: 1 }}>{t('balances.type.vacation')}</Typography>
                {data.canEdit && targetUserId && (
                  <Tooltip title={t('balances.editEntitlement')}>
                    <IconButton size="small" aria-label={t('balances.editEntitlement')} onClick={() => setEntitlementOpen(true)}>
                      <EditIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                )}
              </Box>
              <Typography variant="h5" color={data.vacation.remaining < 0 ? 'error.main' : 'text.primary'}>
                {t('balances.daysLeft', { value: formatDays(data.vacation.remaining, locale) })}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {t('balances.vacationBreakdown', {
                  carry: formatDays(data.vacation.carryOver, locale),
                  entitlement: formatDays(data.vacation.entitlement, locale),
                  adjustments: formatDays(data.vacation.adjustments, locale),
                  taken: formatDays(data.vacation.taken, locale),
                  planned: formatDays(data.vacation.planned, locale),
                })}
                {data.vacation.entitlementOverridden && ` ${t('balances.entitlementOverridden')}`}
              </Typography>
            </Paper>
          </Box>

          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t('balances.month')}</TableCell>
                  <TableCell>{t('balances.status')}</TableCell>
                  <TableCell align="right">{t('balances.target')}</TableCell>
                  <TableCell align="right">{t('balances.actual')}</TableCell>
                  <TableCell align="right">{t('balances.holidays')}</TableCell>
                  <TableCell align="right">{t('balances.absences')}</TableCell>
                  <TableCell align="right">{t('balances.difference')}</TableCell>
                  <TableCell align="right">{t('balances.type.legal_overtime')}</TableCell>
                  <TableCell align="right">{t('balances.balance')}</TableCell>
                  <TableCell align="right">{t('balances.vacationDays')}</TableCell>
                  <TableCell align="right">{t('balanceReport.vacationLeft')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {visibleMonths.map((m) => {
                  const absenceMinutes = Object.values(m.absenceByType).reduce((a, b) => a + b, 0);
                  const partial = m.status === 'current';
                  return (
                    <TableRow key={m.month} hover>
                      <TableCell>{monthName(m.month, locale)}</TableCell>
                      <TableCell><MonthStatusChip status={m.status} /></TableCell>
                      <TableCell align="right">
                        {partial ? (
                          <Tooltip title={t('balances.toDate', { value: formatDurationMinutes(m.target) })}>
                            <span>{formatDurationMinutes(m.monthTarget)}</span>
                          </Tooltip>
                        ) : (
                          formatDurationMinutes(m.monthTarget)
                        )}
                      </TableCell>
                      <TableCell align="right">{m.status === 'future' ? '—' : formatDurationMinutes(m.actual)}</TableCell>
                      <TableCell align="right">{m.holiday ? formatDurationMinutes(m.holiday) : '—'}</TableCell>
                      <TableCell align="right">
                        {absenceMinutes ? (
                          <Tooltip title={<span style={{ whiteSpace: 'pre-line' }}>{absenceTitle(m)}</span>}>
                            <span>{formatDurationMinutes(absenceMinutes)}</span>
                          </Tooltip>
                        ) : (
                          '—'
                        )}
                      </TableCell>
                      <TableCell align="right" sx={{ color: m.delta < 0 ? 'error.main' : undefined }}>
                        {m.status === 'future' ? '—' : formatSignedMinutes(m.delta)}
                        {m.adjustmentMinutes !== 0 && (
                          <Tooltip title={t('balances.adjustmentInMonth', { value: formatSignedMinutes(m.adjustmentMinutes) })}>
                            <Typography component="span" variant="caption" color="text.secondary"> ({formatSignedMinutes(m.adjustmentMinutes)})</Typography>
                          </Tooltip>
                        )}
                      </TableCell>
                      <TableCell align="right">
                        {m.legalOvertimeMinutes ? formatDurationMinutes(m.legalOvertimeMinutes) : '—'}
                        {m.legalOvertimeAdjustments !== 0 && (
                          <Typography component="span" variant="caption" color="text.secondary"> ({formatSignedMinutes(m.legalOvertimeAdjustments)})</Typography>
                        )}
                      </TableCell>
                      <TableCell align="right" sx={{ fontWeight: 600, color: m.overtimeBalance < 0 ? 'error.main' : undefined }}>
                        {m.status === 'future' ? '—' : formatSignedMinutes(m.overtimeBalance)}
                      </TableCell>
                      <TableCell align="right">
                        {m.vacationDays ? formatDays(m.vacationDays, locale) : ''}
                        {m.plannedVacationDays ? (
                          <Typography component="span" variant="body2" color="text.secondary">
                            {m.vacationDays ? ' + ' : ''}
                            {t('balances.plannedDays', { value: formatDays(m.plannedVacationDays, locale) })}
                          </Typography>
                        ) : null}
                        {!m.vacationDays && !m.plannedVacationDays && '—'}
                      </TableCell>
                      <TableCell align="right" sx={{ fontWeight: 600, color: m.vacationBalance < 0 ? 'error.main' : undefined }}>
                        {m.vacationCredited ? (
                          <Tooltip title={t('timesheet.carry.entitlement', { year: m.month.slice(0, 4) }) + `: +${formatDays(m.vacationCredited, locale)}`}>
                            <span>{formatDays(m.vacationBalance, locale)}</span>
                          </Tooltip>
                        ) : (
                          formatDays(m.vacationBalance, locale)
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {visibleMonths.length === 0 && (
                  <TableEmptyRow colSpan={11} icon={<AccountBalanceWalletIcon fontSize="inherit" />} title={t('balances.noMonths')} />
                )}
              </TableBody>
            </Table>
          </TableContainer>

          {(data.adjustments.length > 0 || data.canEdit) && (
            <Fragment>
              <Typography variant="subtitle2">{t('balances.adjustments')}</Typography>
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>{t('balances.date')}</TableCell>
                      <TableCell>{t('balances.account')}</TableCell>
                      <TableCell>{t('balances.kind')}</TableCell>
                      <TableCell align="right">{t('balances.amount')}</TableCell>
                      <TableCell>{t('balances.note')}</TableCell>
                      {data.canEdit && <TableCell />}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {data.adjustments.map((a) => (
                      <TableRow key={a.id}>
                        <TableCell>{formatLocaleDate(a.effectiveDate, locale)}</TableCell>
                        <TableCell>{t(`balances.type.${a.balance}`)}</TableCell>
                        <TableCell>{t(`balances.kind.${a.kind}`)}</TableCell>
                        <TableCell align="right">
                          {a.balance !== 'vacation' ? formatSignedMinutes(a.amount) : t('balances.days', { value: formatDays(a.amount, locale) })}
                        </TableCell>
                        <TableCell>{a.note ?? ''}</TableCell>
                        {data.canEdit && (
                          <TableCell align="right">
                            <IconButton size="small" aria-label={t('balances.deleteAdjustment')} onClick={() => void deleteAdjustment(a.id)}>
                              <DeleteIcon fontSize="small" />
                            </IconButton>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                    {data.adjustments.length === 0 && (
                      <TableEmptyRow colSpan={data.canEdit ? 6 : 5} icon={<AccountBalanceWalletIcon fontSize="inherit" />} title={t('balances.noAdjustments')} />
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            </Fragment>
          )}
        </>
      )}

      {targetUserId && (
        <AdjustmentDialog
          open={adjustOpen}
          orgId={orgId}
          userId={targetUserId}
          year={year}
          authHeaders={authHeaders}
          onClose={() => setAdjustOpen(false)}
          onSaved={async () => {
            setAdjustOpen(false);
            setSuccess(t('balances.adjustmentSaved'));
            await reload();
            onChanged?.();
          }}
        />
      )}
      {targetUserId && data && (
        <EntitlementDialog
          open={entitlementOpen}
          orgId={orgId}
          userId={targetUserId}
          year={year}
          current={data.vacation.entitlementOverridden ? data.vacation.entitlement : null}
          authHeaders={authHeaders}
          onClose={() => setEntitlementOpen(false)}
          onSaved={async () => {
            setEntitlementOpen(false);
            setSuccess(t('balances.entitlementSaved'));
            await reload();
            onChanged?.();
          }}
        />
      )}
    </Box>
  );
}

function AdjustmentDialog({
  open,
  orgId,
  userId,
  year,
  authHeaders,
  onClose,
  onSaved,
}: {
  open: boolean;
  orgId: string;
  userId: string;
  year: number;
  authHeaders: () => Promise<Record<string, string>>;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const { t, locale } = useI18n();
  const today = new Date();
  const defaultDate = year === today.getFullYear() ? today.toISOString().slice(0, 10) : `${year}-01-01`;
  const [balance, setBalance] = useState<BalanceAccount>('overtime');
  const [kind, setKind] = useState<'opening' | 'correction' | 'payout'>('correction');
  const [date, setDate] = useState(defaultDate);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setDate(defaultDate);
      setAmount('');
      setNote('');
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const parsed = balance !== 'vacation' ? parseSignedHours(amount) : parseLocaleNumber(amount, locale) ?? null;
  const valid = parsed !== null && parsed !== 0 && /^\d{4}-\d{2}-\d{2}$/.test(date);

  async function save() {
    if (!valid) return;
    setSaving(true);
    try {
      const res = await fetch(`${API}/organizations/${orgId}/balances/adjustments`, {
        method: 'POST',
        headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, balance, kind, effectiveDate: date, amount: parsed, note: note.trim() || undefined }),
      });
      const body = await res.json();
      if (body.ok === false) setError(t(`balances.error.${body.error}`));
      else await onSaved();
    } catch {
      setError(t('balances.error.load'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>{t('balances.addAdjustment')}</DialogTitle>
      <DialogContent sx={{ display: 'grid', gap: 2, pt: '8px !important' }}>
        {error && <Alert severity="error">{error}</Alert>}
        <TextField select label={t('balances.account')} value={balance} onChange={(e) => setBalance(e.target.value as BalanceAccount)} size="small">
          <MenuItem value="overtime">{t('balances.type.overtime')}</MenuItem>
          <MenuItem value="vacation">{t('balances.type.vacation')}</MenuItem>
          <MenuItem value="legal_overtime">{t('balances.type.legal_overtime')}</MenuItem>
        </TextField>
        <TextField select label={t('balances.kind')} value={kind} onChange={(e) => setKind(e.target.value as 'opening' | 'correction' | 'payout')} size="small">
          <MenuItem value="opening">{t('balances.kind.opening')}</MenuItem>
          <MenuItem value="correction">{t('balances.kind.correction')}</MenuItem>
          <MenuItem value="payout">{t('balances.kind.payout')}</MenuItem>
        </TextField>
        <TextField type="date" label={t('balances.date')} value={date} onChange={(e) => setDate(e.target.value)} size="small" InputLabelProps={{ shrink: true }} />
        <TextField
          label={balance !== 'vacation' ? t('balances.amountHours') : t('balances.amountDays')}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          size="small"
          error={amount.trim() !== '' && (parsed === null || parsed === 0)}
          helperText={t(kind === 'payout' ? 'balances.amountHelpPayout' : 'balances.amountHelp')}
        />
        <TextField label={t('balances.note')} value={note} onChange={(e) => setNote(e.target.value)} size="small" multiline minRows={2} />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button variant="contained" disabled={!valid || saving} onClick={() => void save()}>
          {t('common.save')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function EntitlementDialog({
  open,
  orgId,
  userId,
  year,
  current,
  authHeaders,
  onClose,
  onSaved,
}: {
  open: boolean;
  orgId: string;
  userId: string;
  year: number;
  current: number | null;
  authHeaders: () => Promise<Record<string, string>>;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const { t, locale } = useI18n();
  const [days, setDays] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setDays(current === null ? '' : formatDays(current, locale));
      setNote('');
      setError(null);
    }
  }, [open, current, locale]);

  const parsed = days.trim() === '' ? null : parseLocaleNumber(days, locale) ?? NaN;
  const valid = parsed === null || (typeof parsed === 'number' && Number.isFinite(parsed) && parsed >= 0 && parsed <= 366);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`${API}/organizations/${orgId}/balances/entitlements`, {
        method: 'PUT',
        headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, year, days: parsed, note: note.trim() || undefined }),
      });
      const body = await res.json();
      if (body.ok === false) setError(t(`balances.error.${body.error}`));
      else await onSaved();
    } catch {
      setError(t('balances.error.load'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>{t('balances.entitlementTitle', { year })}</DialogTitle>
      <DialogContent sx={{ display: 'grid', gap: 2, pt: '8px !important' }}>
        {error && <Alert severity="error">{error}</Alert>}
        <TextField
          label={t('balances.entitlementDays')}
          value={days}
          onChange={(e) => setDays(e.target.value)}
          size="small"
          error={!valid}
          helperText={t('balances.entitlementHelp')}
        />
        <TextField label={t('balances.note')} value={note} onChange={(e) => setNote(e.target.value)} size="small" />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button variant="contained" disabled={!valid || saving} onClick={() => void save()}>
          {t('common.save')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
