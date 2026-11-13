import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  LinearProgress,
  Paper,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
  alpha,
  useTheme,
} from '@mui/material';
import { holidayName, type Holiday } from '@worktime3/shared/worktime';
import { useI18n } from './i18n';
import { formatDurationMinutes, formatLocaleDate, formatLocaleDateTime, formatLocaleNumber, formatSignedMinutes } from './localeFormat';
import { TableEmptyRow } from './components';
import { ChevronLeftIcon, ChevronRightIcon, ExpandLessIcon, ExpandMoreIcon } from './icons';
import {
  absenceDaysInMonth,
  absenceOn,
  daysOfMonth,
  isWeekend,
  monthOf,
  shiftMonth,
  totalsByCurrency,
  type TeamAbsence,
} from './teamOverview';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';

export type TeamKind = 'workTime' | 'absences' | 'timesheet' | 'time' | 'projectTimesheet' | 'expenses' | 'expenseReports';

/** Pages whose own view can show another person (PersonPicker): a row opens that person there. */
const OPENS_PERSON: TeamKind[] = ['workTime', 'timesheet', 'time', 'projectTimesheet'];

interface Person {
  id: string;
  name: string | null;
  email: string;
}

interface AttendanceRow {
  userId: string;
  target: number;
  attended: number;
  difference: number;
  absence: number;
  workDays: number;
  checkedIn: boolean;
  status: string;
  submittedAt: string | null;
}

interface ProjectRow {
  user_id: string;
  project_id: string | null;
  project_name: string | null;
  minutes: number;
  entries: number;
  status: string;
  submitted_at: string | null;
}

interface ExpenseRow {
  id: string;
  user_id: string;
  expense_date: string;
  category: string;
  sub_category: string | null;
  value: number;
  currency: string;
  comment: string | null;
  project_name: string | null;
  report_status: string | null;
}

interface ReportRow {
  id: string;
  user_id: string;
  status: string;
  date_submitted: string | null;
  items: number;
  total: number;
  currency: string | null;
  currencies: number;
}

interface Overview {
  people: Person[];
  rows: unknown[];
  absences?: TeamAbsence[];
  holidays?: Holiday[];
}

/**
 * Wraps a page for managers and HR: an "Individual" tab (the page itself) and a "Team" tab
 * with one row per person they may see. Without a team, only the page is rendered.
 * `renderOwn(personId)` renders the page, opened on that person when a team row was picked.
 */
export default function TeamView({
  orgId,
  kind,
  authHeaders,
  renderOwn,
}: {
  orgId: string;
  kind: TeamKind;
  authHeaders: () => Promise<Record<string, string>>;
  renderOwn: (personId?: string, month?: string) => ReactNode;
}) {
  const { t } = useI18n();
  const [hasTeam, setHasTeam] = useState(false);
  const [month, setMonth] = useState(monthOf());
  const [tab, setTab] = useState<'own' | 'team'>('own');
  const [personId, setPersonId] = useState<string | undefined>();

  useEffect(() => {
    let cancelled = false;
    setTab('own');
    setPersonId(undefined);
    (async () => {
      try {
        const res = await fetch(`${API}/organizations/${orgId}/team-overview?kind=${kind}&peopleOnly=1`, { headers: await authHeaders() });
        const data = await res.json();
        if (!cancelled) setHasTeam(Array.isArray(data.people) && data.people.length > 0);
      } catch {
        if (!cancelled) setHasTeam(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, kind]);

  if (!hasTeam) return <>{renderOwn()}</>;
  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ borderBottom: 1, borderColor: 'divider', minHeight: 40 }}>
        <Tab value="own" label={t('team.tab.individual')} sx={{ minHeight: 40 }} />
        <Tab value="team" label={t('team.tab.team')} sx={{ minHeight: 40 }} />
      </Tabs>
      {tab === 'own' ? (
        <Fragment key={personId ?? 'self'}>{renderOwn(personId, personId ? month : undefined)}</Fragment>
      ) : (
        <TeamOverview
          orgId={orgId}
          kind={kind}
          month={month}
          onMonth={setMonth}
          authHeaders={authHeaders}
          onOpenPerson={
            OPENS_PERSON.includes(kind)
              ? (id) => {
                  setPersonId(id);
                  setTab('own');
                }
              : undefined
          }
        />
      )}
    </Box>
  );
}

function TeamOverview({
  orgId,
  kind,
  month,
  onMonth: setMonth,
  authHeaders,
  onOpenPerson,
}: {
  orgId: string;
  kind: TeamKind;
  month: string;
  onMonth: (month: string) => void;
  authHeaders: () => Promise<Record<string, string>>;
  onOpenPerson?: (userId: string) => void;
}) {
  const { t, locale } = useI18n();
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [layout, setLayout] = useState<'table' | 'calendar'>(kind === 'absences' ? 'calendar' : 'table');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const res = await fetch(`${API}/organizations/${orgId}/team-overview?kind=${kind}&month=${month}`, { headers: await authHeaders() });
        const body = await res.json();
        if (cancelled) return;
        if (body.ok === false) setError(t('team.loadFailed'));
        setData({ people: body.people ?? [], rows: body.rows ?? [], absences: body.absences ?? [], holidays: body.holidays ?? [] });
      } catch {
        if (!cancelled) setError(t('team.loadFailed'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, kind, month]);

  const monthLabel = new Date(`${month}-01T12:00:00`).toLocaleDateString(locale, { month: 'long', year: 'numeric' });
  const people = data?.people ?? [];

  return (
    <Paper sx={{ p: 2, display: 'grid', gap: 2 }}>
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
        <Typography variant="subtitle1" sx={{ minWidth: 150, fontWeight: 600 }}>{monthLabel}</Typography>
        <Button size="small" startIcon={<ChevronLeftIcon fontSize="small" />} onClick={() => setMonth(shiftMonth(month, -1))}>
          {t('time.prev').replace('‹ ', '')}
        </Button>
        <TextField type="month" size="small" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
        <Button size="small" endIcon={<ChevronRightIcon fontSize="small" />} onClick={() => setMonth(shiftMonth(month, 1))}>
          {t('time.next').replace(' ›', '')}
        </Button>
        {month !== monthOf() && <Button size="small" onClick={() => setMonth(monthOf())}>{t('team.thisMonth')}</Button>}
        {kind === 'absences' && (
          <ToggleButtonGroup size="small" exclusive value={layout} onChange={(_, v) => v && setLayout(v)} sx={{ ml: 'auto' }}>
            <ToggleButton value="calendar">{t('team.calendar')}</ToggleButton>
            <ToggleButton value="table">{t('team.table')}</ToggleButton>
          </ToggleButtonGroup>
        )}
      </Box>
      <Typography variant="body2" color="text.secondary">
        {onOpenPerson ? t('team.hintOpen') : t('team.hintExpand')}
      </Typography>
      {loading && <LinearProgress />}
      {error && <Alert severity="error">{error}</Alert>}
      {data && kind === 'absences' && layout === 'calendar' && (
        <AbsenceCalendar month={month} people={people} absences={data.absences ?? []} holidays={data.holidays ?? []} />
      )}
      {data && !(kind === 'absences' && layout === 'calendar') && (
        <TeamTable
          kind={kind}
          month={month}
          data={data}
          expanded={expanded}
          onRow={(id) => (onOpenPerson ? onOpenPerson(id) : setExpanded((e) => (e === id ? null : id)))}
          expandable={!onOpenPerson}
        />
      )}
    </Paper>
  );
}

function StatusChip({ status, prefix }: { status: string; prefix: string }) {
  const { t } = useI18n();
  const color = status === 'approved' || status === 'finished' ? 'success' : status === 'rejected' ? 'error' : status === 'open' || status === 'in_preparation' ? 'default' : 'warning';
  return <Chip size="small" color={color} variant={color === 'default' ? 'outlined' : 'filled'} label={t(`${prefix}.${status}`)} />;
}

function useAbsenceTypeLabel() {
  const { t } = useI18n();
  return (type: string | null) => {
    if (!type) return '';
    const label = t(`absences.type.${type}`);
    return label === `absences.type.${type}` ? type : label;
  };
}

function TeamTable({
  kind,
  month,
  data,
  expanded,
  onRow,
  expandable,
}: {
  kind: TeamKind;
  month: string;
  data: Overview;
  expanded: string | null;
  onRow: (userId: string) => void;
  expandable: boolean;
}) {
  const { t, locale } = useI18n();
  const typeLabel = useAbsenceTypeLabel();
  const fullHolidays = useMemo(() => new Set((data.holidays ?? []).filter((h) => h.fraction >= 1).map((h) => h.date)), [data.holidays]);
  const money = (pairs: [string, number][]) => (pairs.length ? pairs.map(([c, v]) => `${c} ${formatLocaleNumber(Math.round(v * 100) / 100, locale)}`).join(' · ') : '—');
  const date = (iso: string | null) => (iso ? formatLocaleDate(iso.slice(0, 10), locale) : '—');

  const byUser = <T extends { user_id?: string; userId?: string }>(rows: T[], id: string) => rows.filter((r) => (r.user_id ?? r.userId) === id);
  const rows = data.rows as never[];

  let headers: string[];
  let cells: (id: string) => ReactNode[];
  let details: ((id: string) => ReactNode) | null = null;

  switch (kind) {
    case 'workTime':
    case 'timesheet': {
      const att = rows as AttendanceRow[];
      headers =
        kind === 'workTime'
          ? [t('team.col.now'), t('team.col.workDays'), t('timesheet.target'), t('team.col.attended'), t('timesheet.differenceToDate'), t('team.col.timesheet')]
          : [t('timesheet.status'), t('team.col.submittedAt'), t('timesheet.target'), t('team.col.attended'), t('timesheet.differenceToDate'), t('team.col.absence')];
      cells = (id) => {
        const r = att.find((a) => a.userId === id);
        if (!r) return headers.map(() => '—');
        const diff = <Box component="span" sx={{ color: r.difference < 0 ? 'error.main' : r.difference > 0 ? 'success.main' : undefined }}>{formatSignedMinutes(r.difference)}</Box>;
        return kind === 'workTime'
          ? [
              r.checkedIn ? <Chip size="small" color="success" label={t('team.checkedIn')} /> : <Typography variant="body2" color="text.secondary">—</Typography>,
              r.workDays,
              formatDurationMinutes(r.target),
              formatDurationMinutes(r.attended),
              diff,
              <StatusChip status={r.status} prefix="timesheet.status" />,
            ]
          : [
              <StatusChip status={r.status} prefix="timesheet.status" />,
              r.submittedAt ? formatLocaleDateTime(r.submittedAt, locale) : '—',
              formatDurationMinutes(r.target),
              formatDurationMinutes(r.attended),
              diff,
              r.absence ? formatDurationMinutes(r.absence) : '—',
            ];
      };
      break;
    }
    case 'time':
    case 'projectTimesheet': {
      const projects = rows as ProjectRow[];
      const name = (p: ProjectRow) => p.project_name ?? t('team.noProject');
      headers = kind === 'time' ? [t('team.col.hours'), t('team.col.entries'), t('team.col.projects')] : [t('team.col.hours'), t('team.col.projectStatus')];
      cells = (id) => {
        const mine = byUser(projects, id);
        const total = formatDurationMinutes(mine.reduce((s, p) => s + Number(p.minutes), 0));
        if (kind === 'time') {
          return [
            total,
            mine.reduce((s, p) => s + Number(p.entries), 0),
            <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
              {mine.filter((p) => p.minutes > 0).map((p) => (
                <Chip key={p.project_id ?? 'none'} size="small" variant="outlined" color={p.project_id ? 'default' : 'warning'} label={`${name(p)} ${formatDurationMinutes(Number(p.minutes))}`} />
              ))}
            </Box>,
          ];
        }
        return [
          total,
          <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
            {mine.filter((p) => p.project_id).map((p) => (
              <Tooltip key={p.project_id} title={t(`timesheet.status.${p.status}`)}>
                <Chip
                  size="small"
                  color={p.status === 'approved' ? 'success' : p.status === 'rejected' ? 'error' : p.status === 'submitted' ? 'warning' : 'default'}
                  variant={p.status === 'open' ? 'outlined' : 'filled'}
                  label={`${name(p)}: ${t(`timesheet.status.${p.status}`)}`}
                />
              </Tooltip>
            ))}
          </Box>,
        ];
      };
      break;
    }
    case 'absences': {
      const list = data.absences ?? [];
      headers = [t('team.col.daysApproved'), t('team.col.pending'), t('team.col.types')];
      cells = (id) => {
        const mine = list.filter((a) => a.user_id === id);
        const approved = mine.filter((a) => a.status === 'approved');
        const pending = mine.filter((a) => a.status === 'pending');
        return [
          formatLocaleNumber(approved.reduce((s, a) => s + absenceDaysInMonth(a, month, fullHolidays), 0), locale),
          pending.length ? <Chip size="small" color="warning" label={pending.length} /> : '—',
          [...new Set(mine.filter((a) => a.status !== 'rejected').map((a) => typeLabel(a.absence_type)))].join(', ') || '—',
        ];
      };
      details = (id) => (
        <DetailTable
          headers={[t('team.col.period'), t('team.col.type'), t('timesheet.status'), t('team.col.note')]}
          rows={list.filter((a) => a.user_id === id).map((a) => [
            a.date_start === a.date_end ? date(a.date_start) : `${date(a.date_start)} – ${date(a.date_end)}${a.half_day ? ` (½)` : ''}`,
            typeLabel(a.absence_type),
            <StatusChip status={a.status} prefix="absences.status" />,
            a.note ?? '',
          ])}
        />
      );
      break;
    }
    case 'expenses': {
      const list = rows as ExpenseRow[];
      headers = [t('team.col.entries'), t('team.col.total'), t('team.col.notInReport')];
      cells = (id) => {
        const mine = byUser(list, id);
        const loose = mine.filter((e) => !e.report_status).length;
        return [mine.length, money(totalsByCurrency(mine)), loose ? <Chip size="small" color="warning" variant="outlined" label={loose} /> : '—'];
      };
      details = (id) => (
        <DetailTable
          headers={[t('team.col.date'), t('team.col.category'), t('team.col.project'), t('team.col.total'), t('team.col.report'), t('team.col.note')]}
          rows={byUser(list, id).map((e) => [
            date(e.expense_date),
            [e.category, e.sub_category].filter(Boolean).join(' / '),
            e.project_name ?? '—',
            money([[e.currency, Number(e.value)]]),
            e.report_status ? <StatusChip status={e.report_status} prefix="expenseReports.status" /> : '—',
            e.comment ?? '',
          ])}
        />
      );
      break;
    }
    default: {
      const list = rows as ReportRow[];
      headers = [t('team.col.reports'), t('team.col.total'), t('timesheet.status')];
      cells = (id) => {
        const mine = byUser(list, id);
        const statuses = [...new Set(mine.map((r) => r.status))];
        return [
          mine.length,
          money(totalsByCurrency(mine.filter((r) => r.currencies <= 1).map((r) => ({ value: r.total, currency: r.currency })))),
          <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>{statuses.map((s) => <StatusChip key={s} status={s} prefix="expenseReports.status" />)}</Box>,
        ];
      };
      details = (id) => (
        <DetailTable
          headers={[t('team.col.submittedAt'), t('timesheet.status'), t('team.col.entries'), t('team.col.total')]}
          rows={byUser(list, id).map((r) => [
            r.date_submitted ? formatLocaleDateTime(r.date_submitted, locale) : '—',
            <StatusChip status={r.status} prefix="expenseReports.status" />,
            r.items,
            r.currencies > 1 ? t('team.mixedCurrencies') : money(r.currency ? [[r.currency, Number(r.total)]] : []),
          ])}
        />
      );
    }
  }

  return (
    <TableContainer>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>{t('people.person')}</TableCell>
            {headers.map((h) => <TableCell key={h}>{h}</TableCell>)}
            {expandable && <TableCell padding="checkbox" />}
          </TableRow>
        </TableHead>
        <TableBody>
          {data.people.length === 0 && <TableEmptyRow colSpan={headers.length + 2} title={t('team.empty')} />}
          {data.people.map((p) => {
            const open = expandable && expanded === p.id;
            return (
              <Fragment key={p.id}>
                <TableRow hover selected={open} onClick={() => onRow(p.id)} sx={{ cursor: 'pointer' }}>
                  <TableCell>
                    <Typography variant="body2" sx={{ fontWeight: 500 }}>{p.name ?? p.email}</Typography>
                    <Typography variant="caption" color="text.secondary">{p.email}</Typography>
                  </TableCell>
                  {cells(p.id).map((c, i) => <TableCell key={i}>{c}</TableCell>)}
                  {expandable && <TableCell padding="checkbox">{open ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}</TableCell>}
                </TableRow>
                {open && details && (
                  <TableRow>
                    <TableCell colSpan={headers.length + 2} sx={{ bgcolor: 'action.hover', py: 1.5 }}>{details(p.id)}</TableCell>
                  </TableRow>
                )}
              </Fragment>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

function DetailTable({ headers, rows }: { headers: string[]; rows: ReactNode[][] }) {
  const { t } = useI18n();
  return (
    <Table size="small">
      <TableHead>
        <TableRow>{headers.map((h) => <TableCell key={h}>{h}</TableCell>)}</TableRow>
      </TableHead>
      <TableBody>
        {rows.length === 0 && <TableEmptyRow colSpan={headers.length} title={t('team.noRecords')} />}
        {rows.map((r, i) => (
          <TableRow key={i}>{r.map((c, j) => <TableCell key={j}>{c}</TableCell>)}</TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** Month grid: one row per person, one column per day; weekends, holidays and absences marked. */
function AbsenceCalendar({ month, people, absences, holidays }: { month: string; people: Person[]; absences: TeamAbsence[]; holidays: Holiday[] }) {
  const { t, locale } = useI18n();
  const theme = useTheme();
  const typeLabel = useAbsenceTypeLabel();
  const days = daysOfMonth(month);
  const holidayOf = new Map(holidays.map((h) => [h.date, h]));
  const palette = [theme.palette.primary.main, theme.palette.secondary.main, theme.palette.info.main, theme.palette.success.main, theme.palette.warning.main];
  const types = [...new Set(absences.filter((a) => a.status !== 'rejected').map((a) => a.absence_type ?? 'other'))].sort();
  const colorOf = (type: string | null) => {
    const key = type ?? 'other';
    if (key === 'sickness') return theme.palette.error.main;
    if (key === 'accident') return theme.palette.error.dark;
    const others = types.filter((k) => k !== 'sickness' && k !== 'accident');
    return palette[Math.max(0, others.indexOf(key)) % palette.length];
  };
  const weekdayShort = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(locale, { weekday: 'narrow' });
  const offBg = alpha(theme.palette.text.primary, theme.palette.mode === 'dark' ? 0.12 : 0.06);
  const holidayBg = alpha(theme.palette.warning.main, 0.22);
  const cell = { p: 0, width: 26, minWidth: 26, height: 30, textAlign: 'center' as const, borderLeft: `1px solid ${theme.palette.divider}` };
  const monthHolidays = days.map((d) => holidayOf.get(d)).filter((h): h is Holiday => !!h);

  return (
    <Box sx={{ display: 'grid', gap: 1.5 }}>
      <TableContainer sx={{ border: 1, borderColor: 'divider', borderRadius: 1 }}>
        <Table size="small" sx={{ tableLayout: 'fixed', width: 'max-content' }}>
          <TableHead>
            <TableRow>
              <TableCell sx={{ position: 'sticky', left: 0, zIndex: 3, bgcolor: 'background.paper', minWidth: 170 }}>{t('people.person')}</TableCell>
              {days.map((d) => {
                const h = holidayOf.get(d);
                return (
                  <Tooltip key={d} title={h ? holidayName(h, locale) : ''}>
                    <TableCell sx={{ ...cell, bgcolor: h ? holidayBg : isWeekend(d) ? offBg : undefined, lineHeight: 1.1, py: 0.5 }}>
                      <Typography variant="caption" display="block" color="text.secondary">{weekdayShort(d)}</Typography>
                      <Typography variant="caption" display="block" sx={{ fontWeight: 600 }}>{Number(d.slice(8))}</Typography>
                    </TableCell>
                  </Tooltip>
                );
              })}
            </TableRow>
          </TableHead>
          <TableBody>
            {people.length === 0 && <TableEmptyRow colSpan={days.length + 1} title={t('team.empty')} />}
            {people.map((p) => (
              <TableRow key={p.id} hover>
                <TableCell sx={{ position: 'sticky', left: 0, zIndex: 1, bgcolor: 'background.paper', whiteSpace: 'nowrap' }}>
                  <Typography variant="body2">{p.name ?? p.email}</Typography>
                </TableCell>
                {days.map((d) => {
                  const h = holidayOf.get(d);
                  const a = absenceOn(absences, p.id, d);
                  const off = isWeekend(d);
                  const color = a ? colorOf(a.absence_type) : null;
                  const title = a
                    ? `${typeLabel(a.absence_type)} · ${t(`absences.status.${a.status}`)}${a.half_day ? ' · ½' : ''}${a.note ? ` · ${a.note}` : ''}`
                    : h
                      ? holidayName(h, locale)
                      : '';
                  return (
                    <Tooltip key={d} title={title}>
                      <TableCell sx={{ ...cell, bgcolor: h ? holidayBg : off ? offBg : undefined }}>
                        {a && color && !off && !(h && h.fraction >= 1) && (
                          <Box
                            sx={{
                              mx: 'auto',
                              width: a.half_day ? 11 : 20,
                              height: 18,
                              borderRadius: 0.75,
                              bgcolor: a.status === 'approved' ? color : 'transparent',
                              border: `2px ${a.status === 'approved' ? 'solid' : 'dashed'} ${color}`,
                            }}
                          />
                        )}
                      </TableCell>
                    </Tooltip>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
        {types.map((type) => (
          <Legend key={type} swatch={{ bgcolor: colorOf(type), border: `2px solid ${colorOf(type)}` }} label={typeLabel(type)} />
        ))}
        <Legend swatch={{ border: `2px dashed ${theme.palette.text.secondary}` }} label={t('absences.status.pending')} />
        <Legend swatch={{ bgcolor: holidayBg }} label={t('team.holiday')} />
        <Legend swatch={{ bgcolor: offBg }} label={t('team.weekend')} />
      </Box>
      {monthHolidays.length > 0 && (
        <Typography variant="body2" color="text.secondary">
          {t('team.holidays')}: {monthHolidays.map((h) => `${formatLocaleDate(h.date, locale)} ${holidayName(h, locale)}${h.fraction < 1 ? ' (½)' : ''}`).join(' · ')}
        </Typography>
      )}
    </Box>
  );
}

function Legend({ swatch, label }: { swatch: Record<string, unknown>; label: string }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
      <Box sx={{ width: 16, height: 14, borderRadius: 0.5, ...swatch }} />
      <Typography variant="caption">{label}</Typography>
    </Box>
  );
}
