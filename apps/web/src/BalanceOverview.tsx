import { useEffect, useState, type ReactNode } from 'react';
import { Box, Paper, Tooltip, Typography } from '@mui/material';
import { useI18n } from './i18n';
import { formatDurationMinutes, formatLocaleDate, formatSignedMinutes } from './localeFormat';
import { formatDays } from './BalancesPanel';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';

interface Overview {
  today: { date: string; worked: number; target: number } | null;
  overtime: { bookedMinutes: number; pendingMinutes: number; pendingSince: string | null };
  legal: { closing: number; accrued: number; yearLimitMinutes: number };
  vacation: { carryOver: number; entitlement: number; adjustments: number; taken: number; planned: number; remaining: number };
  year: number;
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function Line({ label, value, strong, negative, hint }: { label: string; value: string; strong?: boolean; negative?: boolean; hint?: string }) {
  const text = (
    <Typography variant="body2" sx={{ fontWeight: strong ? 600 : undefined, color: negative ? 'error.main' : undefined, whiteSpace: 'nowrap' }}>
      {value}
    </Typography>
  );
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, py: 0.25, ...(strong ? { borderTop: 1, borderColor: 'divider', mt: 0.5, pt: 0.75 } : {}) }}>
      <Typography variant="body2" sx={{ fontWeight: strong ? 600 : undefined }}>{label}</Typography>
      {hint ? <Tooltip title={hint}>{text}</Tooltip> : text}
    </Box>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Paper sx={{ p: 2 }}>
      <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>{title}</Typography>
      {children}
    </Paper>
  );
}

/**
 * The caller's own numbers at a glance: today's work time against the target, the overtime
 * balance (closed months plus months not approved yet) and this year's vacation account.
 * `layout="column"` stacks the three cards (sidebar), `"row"` puts them side by side.
 */
export default function BalanceOverview({
  orgId,
  authHeaders,
  refreshKey,
  layout = 'row',
}: {
  orgId: string;
  authHeaders: () => Promise<Record<string, string>>;
  refreshKey?: unknown;
  layout?: 'row' | 'column';
}) {
  const { t, locale } = useI18n();
  const [data, setData] = useState<Overview | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const headers = await authHeaders();
        // The organization's "today" may differ from the browser's by a day: ask around it.
        const local = new Date();
        const guess = `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(local.getDate()).padStart(2, '0')}`;
        const [dayRes, yearRes] = await Promise.all([
          fetch(`${API}/organizations/${orgId}/day-targets?from=${addDays(guess, -1)}&to=${addDays(guess, 1)}`, { headers }),
          fetch(`${API}/organizations/${orgId}/balances/year?year=${guess.slice(0, 4)}`, { headers }),
        ]);
        const days = await dayRes.json();
        const year = await yearRes.json();
        if (cancelled || !year?.overtime || !year?.vacation) return;
        const today = Array.isArray(days?.days) ? days.days.find((d: { date: string }) => d.date === days.today) : null;
        setData({
          today: today ? { date: today.date, worked: today.attended, target: today.target } : null,
          overtime: year.overtime,
          legal: year.legalOvertime ?? { closing: 0, accrued: 0, yearLimitMinutes: 0 },
          vacation: year.vacation,
          year: year.year,
        });
      } catch {
        /* offline: show nothing */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, refreshKey]);

  if (!data) return null;
  const { today, overtime, vacation, legal } = data;
  const total = overtime.bookedMinutes + overtime.pendingMinutes;
  // Überzeit is a share of the balance; the rest is regular overtime (Überstunden).
  const regular = total - legal.closing;
  const allowance = vacation.carryOver + vacation.entitlement + vacation.adjustments;
  const remainingNow = allowance - vacation.taken;
  const yearEnd = formatLocaleDate(`${data.year}-12-31`, locale);

  return (
    <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: layout === 'row' ? { xs: '1fr', md: 'repeat(3, 1fr)' } : '1fr', alignItems: 'start' }}>
      <Card title={t('overview.today')}>
        <Line label={t('overview.worked')} value={formatDurationMinutes(today?.worked ?? 0)} />
        <Line label={t('overview.target')} value={formatDurationMinutes(today?.target ?? 0)} />
        <Line
          label={t('overview.difference')}
          value={formatSignedMinutes((today?.worked ?? 0) - (today?.target ?? 0))}
          strong
          negative={(today?.worked ?? 0) < (today?.target ?? 0)}
        />
      </Card>

      <Card title={t('overview.balance')}>
        <Line label={t('balances.type.overtime')} value={formatSignedMinutes(regular)} negative={regular < 0} />
        <Line
          label={t('balances.type.legal_overtime')}
          value={formatSignedMinutes(legal.closing)}
          negative={legal.accrued > legal.yearLimitMinutes}
          hint={t('overview.legalHelp', {
            year: String(data.year),
            accrued: formatDurationMinutes(legal.accrued),
            limit: formatDurationMinutes(legal.yearLimitMinutes),
          })}
        />
        <Line
          label={t('overview.total')}
          value={formatSignedMinutes(total)}
          strong
          negative={total < 0}
          hint={
            overtime.pendingSince
              ? t('overview.totalHelp', {
                  booked: formatSignedMinutes(overtime.bookedMinutes),
                  pending: formatSignedMinutes(overtime.pendingMinutes),
                  date: formatLocaleDate(overtime.pendingSince, locale),
                })
              : undefined
          }
        />
      </Card>

      <Card title={t('overview.vacation')}>
        <Line
          label={t('overview.entitlement', { year: String(data.year) })}
          value={formatDays(allowance, locale)}
          hint={t('overview.entitlementHelp', {
            carry: formatDays(vacation.carryOver, locale),
            entitlement: formatDays(vacation.entitlement, locale),
            adjustments: formatDays(vacation.adjustments, locale),
          })}
        />
        <Line label={t('overview.taken')} value={formatDays(vacation.taken, locale)} />
        <Line label={t('overview.remaining')} value={formatDays(remainingNow, locale)} strong negative={remainingNow < 0} />
        <Line label={t('overview.planned', { date: yearEnd })} value={formatDays(vacation.planned, locale)} />
        <Line label={t('overview.remainingEnd', { date: yearEnd })} value={formatDays(vacation.remaining, locale)} strong negative={vacation.remaining < 0} />
      </Card>
    </Box>
  );
}
