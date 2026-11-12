import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  IconButton,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import { dayMinutesFor, weeklyMinutes, type WorkSchedule } from '@worktime3/shared/worktime';
import { useI18n } from './i18n';
import { formatLocaleDate } from './localeFormat';
import { DeleteIcon } from './icons';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';

/** Minutes as "h:mm", e.g. 504 -> "8:24". */
export function formatHm(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}

/** "8:24", "8.4", "8,4" or "8" as minutes; null when not a time of at most 24h. */
export function parseHm(text: string): number | null {
  const s = text.trim();
  if (s === '') return 0;
  const hm = /^(\d{1,2}):([0-5]\d)$/.exec(s);
  const minutes = hm ? Number(hm[1]) * 60 + Number(hm[2]) : /^\d{1,2}([.,]\d+)?$/.test(s) ? Math.round(Number(s.replace(',', '.')) * 60) : NaN;
  return Number.isFinite(minutes) && minutes >= 0 && minutes <= 24 * 60 ? minutes : null;
}

/** Short weekday names, Monday first, in the app's language. */
function weekdayNames(locale: string): string[] {
  // 2024-01-01 was a Monday.
  return Array.from({ length: 7 }, (_, i) => new Date(Date.UTC(2024, 0, 1 + i)).toLocaleDateString(locale, { weekday: 'short', timeZone: 'UTC' }));
}

function firstOfNextMonth(): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 1));
  return d.toISOString().slice(0, 10);
}

interface ScheduleRow extends WorkSchedule {
  id: string;
}

interface ScheduleData {
  schedules: ScheduleRow[];
  /** The organization's canton (its public holidays apply). */
  holidayRegion: string | null;
  fullTimeWeeklyMinutes: number;
  canEdit: boolean;
}

interface WorkSchedulePanelProps {
  orgId: string;
  userId: string;
  authHeaders: () => Promise<Record<string, string>>;
}

/**
 * A person's work schedule: target hours per weekday with their history (the organization's
 * canton sets the public holidays). Editors (section.workTime.schedule edit) add a schedule from a date.
 */
export default function WorkSchedulePanel({ orgId, userId, authHeaders }: WorkSchedulePanelProps) {
  const { t, locale } = useI18n();
  const [data, setData] = useState<ScheduleData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  // New-schedule form.
  const [validFrom, setValidFrom] = useState(firstOfNextMonth);
  const [percent, setPercent] = useState('100');
  const [workingDays, setWorkingDays] = useState<number[]>([0, 1, 2, 3, 4]);
  const [dayText, setDayText] = useState<string[]>(Array(7).fill('0:00'));
  const [busy, setBusy] = useState(false);

  const days = useMemo(() => weekdayNames(locale), [locale]);

  async function reload() {
    try {
      const res = await fetch(`${API}/organizations/${orgId}/users/${userId}/work-schedule`, { headers: await authHeaders() });
      const body = await res.json();
      if (body?.ok === false) {
        setForbidden(body.error === 'forbidden');
        setData(null);
        return;
      }
      setForbidden(false);
      // Start the new-schedule form from the latest schedule.
      const latest: ScheduleRow | undefined = (body.schedules ?? []).at(-1);
      if (latest) {
        setPercent(String(latest.workloadPercent));
        setWorkingDays(latest.dayMinutes.flatMap((m: number, i: number) => (m > 0 ? [i] : [])));
      }
      setData({
        schedules: body.schedules ?? [],
        holidayRegion: body.holidayRegion ?? null,
        fullTimeWeeklyMinutes: body.fullTimeWeeklyMinutes ?? 2400,
        canEdit: !!body.canEdit,
      });
    } catch {
      setError(t('common.cannotReachApi'));
    }
  }

  useEffect(() => {
    setData(null);
    setError(null);
    setSuccess(null);
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, userId]);

  // Recompute the per-day minutes whenever the workload or the working days change.
  const fullTime = data?.fullTimeWeeklyMinutes ?? 2400;
  useEffect(() => {
    const p = Number(percent.replace(',', '.'));
    if (!Number.isFinite(p) || p < 0 || p > 100) return;
    const mins = dayMinutesFor(fullTime, p, Array.from({ length: 7 }, (_, i) => workingDays.includes(i)));
    setDayText(mins.map(formatHm));
  }, [percent, workingDays, fullTime]);

  const parsedDays = dayText.map(parseHm);
  const percentValue = Number(percent.replace(',', '.'));
  const formValid = !!validFrom && Number.isFinite(percentValue) && percentValue >= 0 && percentValue <= 100 && parsedDays.every((m) => m !== null);

  function errorMessage(code: string | undefined): string {
    const known = ['forbidden', 'period-locked', 'invalid-date', 'invalid-workload', 'invalid-day-minutes', 'unknown-user'];
    return code && known.includes(code) ? t(`workSchedule.error.${code}`) : t('workSchedule.saveFailed');
  }

  async function send(path: string, method: string, body?: unknown): Promise<boolean> {
    setError(null);
    setSuccess(null);
    setBusy(true);
    try {
      const res = await fetch(`${API}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const result = await res.json();
      if (!result?.ok) {
        setError(errorMessage(result?.error));
        return false;
      }
      await reload();
      return true;
    } catch {
      setError(t('common.cannotReachApi'));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function saveSchedule() {
    if (!formValid) return;
    const ok = await send(`/organizations/${orgId}/users/${userId}/work-schedules`, 'POST', {
      validFrom,
      workloadPercent: percentValue,
      dayMinutes: parsedDays as number[],
    });
    if (ok) setSuccess(t('workSchedule.saved'));
  }

  if (forbidden) return null;

  const today = new Date().toISOString().slice(0, 10);
  const schedules = data?.schedules ?? [];
  const current = [...schedules].reverse().find((s) => s.validFrom <= today) ?? null;

  return (
    <Paper sx={{ p: 2, display: 'grid', gap: 1.5 }}>
      <Box>
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>{t('workSchedule.title')}</Typography>
        <Typography variant="body2" color="text.secondary">
          {current
            ? t('workSchedule.current', { percent: String(current.workloadPercent), weekly: formatHm(weeklyMinutes(current)) })
            : t('workSchedule.noneDefault', { weekly: formatHm(fullTime) })}
        </Typography>
      </Box>

      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
      {success && <Alert severity="success" onClose={() => setSuccess(null)}>{success}</Alert>}

      {schedules.length > 0 && (
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('workSchedule.validFrom')}</TableCell>
                <TableCell align="right">{t('workSchedule.workload')}</TableCell>
                {days.map((d) => <TableCell key={d} align="right">{d}</TableCell>)}
                <TableCell align="right">{t('workSchedule.weekly')}</TableCell>
                {data?.canEdit && <TableCell />}
              </TableRow>
            </TableHead>
            <TableBody>
              {[...schedules].reverse().map((s) => (
                <TableRow key={s.id} selected={s.id === current?.id}>
                  <TableCell>{formatLocaleDate(s.validFrom, locale)}</TableCell>
                  <TableCell align="right">{s.workloadPercent}%</TableCell>
                  {s.dayMinutes.map((m, i) => (
                    <TableCell key={i} align="right" sx={{ color: m === 0 ? 'text.disabled' : undefined }}>{formatHm(m)}</TableCell>
                  ))}
                  <TableCell align="right" sx={{ fontWeight: 600 }}>{formatHm(weeklyMinutes(s))}</TableCell>
                  {data?.canEdit && (
                    <TableCell align="right" sx={{ width: 48 }}>
                      <Tooltip title={t('workSchedule.delete')}>
                        <span>
                          <IconButton
                            size="small"
                            aria-label={t('workSchedule.delete')}
                            disabled={busy}
                            onClick={() => void send(`/organizations/${orgId}/work-schedules/${s.id}`, 'DELETE')}
                          >
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <Typography variant="body2" color="text.secondary">
        {t('workSchedule.holidayRegion')}: {data?.holidayRegion ?? t('workSchedule.regionNone')}
      </Typography>

      {data?.canEdit && (
        <Box
          component="form"
          onSubmit={(e) => {
            e.preventDefault();
            void saveSchedule();
          }}
          sx={{ display: 'grid', gap: 1.5, p: 1.5, border: 1, borderColor: 'divider', borderRadius: 1.5 }}
        >
          <Typography variant="subtitle2">{t('workSchedule.newTitle')}</Typography>
          <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
            <TextField
              type="date"
              size="small"
              label={t('workSchedule.validFrom')}
              value={validFrom}
              onChange={(e) => setValidFrom(e.target.value)}
              slotProps={{ inputLabel: { shrink: true } }}
            />
            <TextField
              size="small"
              label={t('workSchedule.workload')}
              value={percent}
              onChange={(e) => setPercent(e.target.value)}
              error={!(Number.isFinite(percentValue) && percentValue >= 0 && percentValue <= 100)}
              slotProps={{ input: { endAdornment: <Typography variant="body2" color="text.secondary">%</Typography> } }}
              sx={{ width: 120 }}
            />
            <ToggleButtonGroup
              size="small"
              value={workingDays}
              onChange={(_, v: number[]) => setWorkingDays([...v].sort())}
              aria-label={t('workSchedule.workingDays')}
            >
              {days.map((d, i) => <ToggleButton key={d} value={i} sx={{ px: 1.25 }}>{d}</ToggleButton>)}
            </ToggleButtonGroup>
          </Box>
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(78px, 1fr))', gap: 1 }}>
            {days.map((d, i) => (
              <TextField
                key={d}
                size="small"
                label={d}
                value={dayText[i]}
                onChange={(e) => setDayText((prev) => prev.map((v, j) => (j === i ? e.target.value : v)))}
                error={parsedDays[i] === null}
              />
            ))}
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
            <Chip
              size="small"
              label={t('workSchedule.weeklyTotal', { weekly: formatHm(parsedDays.reduce<number>((a, b) => a + (b ?? 0), 0)), fullTime: formatHm(fullTime) })}
            />
            <Typography variant="caption" color="text.secondary" sx={{ flexGrow: 1 }}>{t('workSchedule.hint')}</Typography>
            <Button type="submit" variant="contained" size="small" disabled={!formValid || busy}>{t('common.save')}</Button>
          </Box>
          {validFrom && validFrom < today && (
            <Typography variant="caption" color="warning.main">{t('workSchedule.retroactive')}</Typography>
          )}
        </Box>
      )}
    </Paper>
  );
}
