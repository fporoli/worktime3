import { useEffect, useMemo, useState } from 'react';
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
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import { BarChart } from '@mui/x-charts/BarChart';
import { bucket, minutes, periodLabel, periodRange, shiftPeriod, todayDate, type Entry, type PeriodType } from './aggregate';
import { useI18n } from './i18n';
import { formatDurationMinutes, formatLocaleDate } from './localeFormat';
import { ConfirmDialog, PageHeader, PersonPicker, TableEmptyRow } from './components';
import { ChevronLeftIcon, ChevronRightIcon, ContentCopyIcon, DeleteIcon, EditIcon, ScheduleIcon } from './icons';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';
const DEFAULT_PROJECT_TIME_START = '08:00';
const PROJECT_TIME_ERRORS = new Set(['period-locked', 'forbidden', 'not-found', 'unknown-user']);
const DURATION_PRESETS = [15, 30, 60, 120, 240, 480];

interface Option {
  id: string;
  name: string;
}

interface Draft {
  id: string;
  date: string;
  startTime: string;
  durationMinutes: number;
  projectId: string;
  subprojectId: string;
  comment: string;
}

interface OverlapEntry {
  id: string;
  start_time: string;
  end_time: string;
  comment: string | null;
}

interface OverlapConfirm {
  kind: 'add' | 'draft';
  overlaps: OverlapEntry[];
}

/** A submitted or approved project month: that project's time in that month can't change. */
interface ProjectLock {
  project_id: string;
  period_start: string;
  status: 'submitted' | 'approved';
}

function splitLocal(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

function timeOf(iso: string, locale: string): string {
  return new Date(iso).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
}

function minutesBetween(startIso: string, endIso: string): number {
  return Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000);
}

function toIso(date: string, time: string): string {
  return new Date(`${date}T${time}`).toISOString();
}

function addMinutesIso(startIso: string, mins: number): string {
  return new Date(new Date(startIso).getTime() + mins * 60000).toISOString();
}

export interface ProjectTimeProps {
  orgId: string;
  userId: string;
  useProjectTimeRanges: boolean;
  authHeaders: () => Promise<Record<string, string>>;
  projectsVersion?: number;
  /** Opens the page on this person (from the team overview). */
  initialPersonId?: string;
}

export default function ProjectTime({ orgId, userId, useProjectTimeRanges, authHeaders, projectsVersion = 0, initialPersonId }: ProjectTimeProps) {
  const { t, locale } = useI18n();
  const theme = useTheme();
  const [periodType, setPeriodType] = useState<PeriodType>('week');
  const [periodAnchor, setPeriodAnchor] = useState(() => todayDate());
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [entryDate, setEntryDate] = useState(() => todayDate());
  const [entryStartTime, setEntryStartTime] = useState(DEFAULT_PROJECT_TIME_START);
  const [entryDurationMinutes, setEntryDurationMinutes] = useState(60);
  const [comment, setComment] = useState('');
  const [projects, setProjects] = useState<Option[]>([]);
  const [subprojectsByProject, setSubprojectsByProject] = useState<Record<string, Option[]>>({});
  const [projectId, setProjectId] = useState('');
  const [subprojectId, setSubprojectId] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [overlapConfirm, setOverlapConfirm] = useState<OverlapConfirm | null>(null);
  // "More project time than working time" warning; confirming resends with both acknowledgements.
  const [attendanceConfirm, setAttendanceConfirm] = useState<{ kind: 'add' | 'draft'; message: string; overlapAck: boolean } | null>(null);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [locks, setLocks] = useState<ProjectLock[]>([]);
  // Whose project time is shown: one's own, or (manager/HR) someone whose hours one may correct.
  const [personId, setPersonId] = useState(initialPersonId ?? userId);
  const isSelf = personId === userId;
  // Back to the opened person (or oneself) when the org or user changes; also runs on mount.
  useEffect(() => setPersonId(initialPersonId ?? userId), [orgId, userId, initialPersonId]);

  const rows = useMemo(() => bucket(entries, 'daily'), [entries]);
  const total = rows.reduce((s, r) => s + r.minutes, 0);
  const subprojects = subprojectsByProject[projectId] ?? [];
  const draftSubprojects = draft ? (subprojectsByProject[draft.projectId] ?? []) : [];

  const lockOf = (pid: string | null | undefined, date: string) =>
    pid ? locks.find((l) => l.project_id === pid && l.period_start === `${date.slice(0, 7)}-01`) ?? null : null;
  const activeLock = lockOf(projectId, entryDate);
  const isEntryDateLocked = activeLock !== null;

  async function loadSubprojects(pid: string) {
    if (!pid) return;
    try {
      const res = await fetch(`${API}/projects/${pid}/subprojects`, { headers: await authHeaders() });
      const data = await res.json();
      setSubprojectsByProject((prev) => ({ ...prev, [pid]: Array.isArray(data) ? data : [] }));
    } catch { /* offline fallback */ }
  }

  async function reloadEntries() {
    setLoading(true);
    const { from, to } = periodRange(periodType, periodAnchor);
    try {
      const res = await fetch(
        `${API}/organizations/${orgId}/project-time?userId=${personId}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
        { headers: await authHeaders() },
      );
      const data = await res.json();
      if (Array.isArray(data.entries)) setEntries(data.entries);
    } catch {
      /* offline fallback */
    } finally {
      setLoading(false);
    }
  }

  async function reloadProjects() {
    try {
      const res = await fetch(`${API}/organizations/${orgId}/projects`, { headers: await authHeaders() });
      const data = await res.json();
      if (Array.isArray(data)) setProjects(data);
    } catch { /* offline fallback */ }
  }

  async function reloadPeriods() {
    try {
      const res = await fetch(`${API}/organizations/${orgId}/project-timesheets/locks?userId=${personId}`, { headers: await authHeaders() });
      const data = await res.json();
      if (Array.isArray(data)) setLocks(data);
    } catch { /* offline fallback */ }
  }

  useEffect(() => {
    setSubprojectsByProject({});
    void reloadProjects();
    void reloadPeriods();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, personId, projectsVersion]);

  useEffect(() => {
    void reloadEntries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, personId, periodType, periodAnchor]);

  useEffect(() => {
    void loadSubprojects(projectId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => {
    if (draft) void loadSubprojects(draft.projectId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft?.projectId]);

  async function addEntry(acknowledgeOverlap = false, acknowledgeAttendance = false) {
    setError(null);
    setSuccess(null);
    const startTime = toIso(entryDate, useProjectTimeRanges ? entryStartTime : DEFAULT_PROJECT_TIME_START);
    const endTime = addMinutesIso(startTime, entryDurationMinutes);
    try {
      const res = await fetch(`${API}/organizations/${orgId}/project-time`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({
          startTime,
          endTime,
          projectId: projectId || undefined,
          subprojectId: subprojectId || undefined,
          comment,
          acknowledgeOverlap: acknowledgeOverlap || undefined,
          acknowledgeAttendance: acknowledgeAttendance || undefined,
          userId: isSelf ? undefined : personId,
        }),
      });
      const data = await res.json();
      if (data.ok === false) {
        if (data.error === 'overlapping-entry-confirm') {
          setOverlapConfirm({ kind: 'add', overlaps: data.overlaps ?? [] });
          return;
        }
        if (data.error === 'project-exceeds-attendance-confirm') {
          setOverlapConfirm(null);
          setAttendanceConfirm({ kind: 'add', message: saveError(data, 'time.addFailed'), overlapAck: acknowledgeOverlap });
          return;
        }
        setError(saveError(data, 'time.addFailed'));
        return;
      }
      setOverlapConfirm(null);
      setAttendanceConfirm(null);
      setComment('');
      setSuccess(t('time.added'));
      await reloadEntries();
    } catch {
      setError(t('common.cannotReachApi'));
    }
  }

  /** The message for a refused save; the attendance check names the day and both totals. */
  function saveError(data: { error?: string; date?: string; projectMinutes?: number; attendanceMinutes?: number }, fallbackKey: string): string {
    if (data.error === 'project-exceeds-attendance-confirm') {
      return t('time.error.project-exceeds-attendance', {
        date: data.date ? formatLocaleDate(data.date, locale) : '',
        project: formatDurationMinutes(data.projectMinutes ?? 0),
        attendance: formatDurationMinutes(data.attendanceMinutes ?? 0),
      });
    }
    return PROJECT_TIME_ERRORS.has(data.error ?? '') ? t(`time.error.${data.error}`) : t(fallbackKey, { error: data.error ?? t('common.unknownError') });
  }

  async function saveDraft(acknowledgeOverlap = false, acknowledgeAttendance = false) {
    if (!draft) return;
    setError(null);
    setSuccess(null);
    const draftStartTime = toIso(draft.date, useProjectTimeRanges ? draft.startTime : DEFAULT_PROJECT_TIME_START);
    const patch = {
      startTime: draftStartTime,
      endTime: addMinutesIso(draftStartTime, draft.durationMinutes),
      projectId: draft.projectId || null,
      subprojectId: draft.subprojectId || null,
      comment: draft.comment,
    };
    try {
      const res = await fetch(`${API}/project-time/${draft.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ ...patch, acknowledgeOverlap: acknowledgeOverlap || undefined, acknowledgeAttendance: acknowledgeAttendance || undefined }),
      });
      const data = await res.json();
      if (data.ok === false) {
        if (data.error === 'overlapping-entry-confirm') {
          setOverlapConfirm({ kind: 'draft', overlaps: data.overlaps ?? [] });
          return;
        }
        if (data.error === 'project-exceeds-attendance-confirm') {
          setOverlapConfirm(null);
          setAttendanceConfirm({ kind: 'draft', message: saveError(data, 'time.saveFailed'), overlapAck: acknowledgeOverlap });
          return;
        }
        setError(saveError(data, 'time.saveFailed'));
        return;
      }
      setOverlapConfirm(null);
      setAttendanceConfirm(null);
      setDraft(null);
      setSuccess(t('time.saved'));
      await reloadEntries();
    } catch {
      setError(t('common.cannotReachApi'));
    }
  }

  function closeDraft() {
    setDraft(null);
    setOverlapConfirm((prev) => (prev?.kind === 'draft' ? null : prev));
  }

  async function removeEntry(id: string) {
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`${API}/project-time/${id}`, { method: 'DELETE', headers: await authHeaders() });
      const data = await res.json();
      if (data.ok === false) {
        setError(PROJECT_TIME_ERRORS.has(data.error) ? t(`time.error.${data.error}`) : t('time.removeFailed', { error: data.error ?? t('common.unknownError') }));
        return;
      }
      setSuccess(t('time.removed'));
      await reloadEntries();
    } catch {
      setError(t('common.cannotReachApi'));
    }
  }

  function duplicateEntry(e: Entry) {
    const { time } = splitLocal(e.start_time);
    setEntryStartTime(time);
    setEntryDurationMinutes(Math.max(5, minutesBetween(e.start_time, e.end_time)));
    setProjectId(e.project_id ?? '');
    setSubprojectId(e.subproject_id ?? '');
    setComment(e.comment ?? '');
    if (e.project_id) void loadSubprojects(e.project_id);
  }

  const addDurationInvalid = !(entryDurationMinutes > 0);
  const draftDurationInvalid = !!draft && !(draft.durationMinutes > 0);
  const sortedEntries = useMemo(
    () => [...entries].sort((a, b) => (a.start_time < b.start_time ? 1 : -1)),
    [entries],
  );
  const chartData = useMemo(
    () =>
      rows.map((r) => ({
        day: r.label.slice(5),
        hours: Math.round((r.minutes / 60) * 100) / 100,
      })),
    [rows],
  );

  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <PageHeader
        title={t('nav.timeTracking')}
        end={<PersonPicker orgId={orgId} kind="time" selfId={userId} value={personId} onChange={setPersonId} authHeaders={authHeaders} highlight={!!initialPersonId} />}
      />

      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
      {success && <Alert severity="success" onClose={() => setSuccess(null)}>{success}</Alert>}
      {isEntryDateLocked && (
        <Alert severity="warning">
          {t('time.projectLockedBanner', {
            project: projects.find((p) => p.id === projectId)?.name ?? '',
            status: t(`timesheet.status.${activeLock?.status ?? 'submitted'}`),
          })}
        </Alert>
      )}

      <Paper
        component="form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!addDurationInvalid && !isEntryDateLocked) void addEntry();
        }}
        sx={{ p: 2 }}
      >
        <Typography variant="h6" sx={{ mb: 1 }}>{t('time.logProjectTime')}</Typography>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <TextField label={t('time.date')} type="date" value={entryDate} onChange={(e) => e.target.value && setEntryDate(e.target.value)} size="small" />
          {useProjectTimeRanges && (
            <TextField
              label={t('time.start')}
              type="time"
              value={entryStartTime}
              onChange={(e) => e.target.value && setEntryStartTime(e.target.value)}
              size="small"
              slotProps={{ htmlInput: { step: 300 } }}
            />
          )}
          <TextField
            label={t('time.durationMinutes')}
            type="number"
            value={entryDurationMinutes}
            onChange={(e) => setEntryDurationMinutes(Number(e.target.value))}
            size="small"
            slotProps={{ htmlInput: { step: 5, min: 5 } }}
            error={addDurationInvalid}
            helperText={addDurationInvalid ? t('time.durationMustBePositive') : formatDurationMinutes(entryDurationMinutes)}
            sx={{ maxWidth: 160 }}
          />
          <TextField
            select
            label={t('time.project')}
            value={projectId}
            onChange={(e) => { setProjectId(e.target.value); setSubprojectId(''); }}
            size="small"
            sx={{ minWidth: 180 }}
          >
            <MenuItem value=""><em>{t('time.none')}</em></MenuItem>
            {projects.map((p) => (<MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>))}
          </TextField>
          <TextField
            select
            label={t('time.subproject')}
            value={subprojectId}
            onChange={(e) => setSubprojectId(e.target.value)}
            size="small"
            sx={{ minWidth: 180 }}
            disabled={!projectId || subprojects.length === 0}
          >
            <MenuItem value=""><em>{t('time.none')}</em></MenuItem>
            {subprojects.map((s) => (<MenuItem key={s.id} value={s.id}>{s.name}</MenuItem>))}
          </TextField>
        </Box>

        <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', alignItems: 'center', mt: 1 }}>
          <Typography variant="caption" color="text.secondary">{t('time.presets')}:</Typography>
          {DURATION_PRESETS.map((mins) => (
            <Chip
              key={mins}
              size="small"
              label={mins < 60 ? `${mins}m` : `${mins / 60}h`}
              variant={entryDurationMinutes === mins ? 'filled' : 'outlined'}
              color={entryDurationMinutes === mins ? 'primary' : 'default'}
              onClick={() => setEntryDurationMinutes(mins)}
            />
          ))}
        </Box>

        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 1.5, alignItems: 'flex-start' }}>
          <TextField
            label={t('time.comment')}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            size="small"
            multiline
            minRows={2}
            sx={{ flex: 1, minWidth: 260, '& textarea': { resize: 'vertical' } }}
          />
          <Button type="submit" variant="contained" disabled={addDurationInvalid || isEntryDateLocked}>
            {t('time.add')}
          </Button>
        </Box>
      </Paper>

      <Paper sx={{ p: 2 }}>
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
            <Typography variant="h6">
              {t('time.overview')} — {periodLabel(periodType, periodAnchor, locale)}
            </Typography>
            <Chip
              color="primary"
              variant="outlined"
              size="small"
              label={t('time.hoursFormat', { formatted: formatDurationMinutes(total), minutes: Math.round(total) })}
            />
          </Box>
          <ToggleButtonGroup value={periodType} exclusive onChange={(_, v) => v && setPeriodType(v)} size="small">
            <ToggleButton value="day">{t('time.day')}</ToggleButton>
            <ToggleButton value="week">{t('time.week')}</ToggleButton>
            <ToggleButton value="month">{t('time.month')}</ToggleButton>
          </ToggleButtonGroup>
        </Box>

        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mt: 1.5, flexWrap: 'wrap' }}>
          <Button size="small" startIcon={<ChevronLeftIcon fontSize="small" />} onClick={() => setPeriodAnchor((a) => shiftPeriod(periodType, a, -1))}>
            {t('time.prev').replace('‹ ', '')}
          </Button>
          <TextField
            type={periodType === 'month' ? 'month' : 'date'}
            size="small"
            value={periodType === 'month' ? periodAnchor.slice(0, 7) : periodAnchor}
            onChange={(e) => {
              if (!e.target.value) return;
              setPeriodAnchor(periodType === 'month' ? `${e.target.value}-01` : e.target.value);
            }}
          />
          <Button size="small" endIcon={<ChevronRightIcon fontSize="small" />} onClick={() => setPeriodAnchor((a) => shiftPeriod(periodType, a, 1))}>
            {t('time.next').replace(' ›', '')}
          </Button>
          {periodAnchor !== todayDate() && (
            <Button size="small" onClick={() => setPeriodAnchor(todayDate())}>{t('time.today')}</Button>
          )}
        </Box>

        {loading && <LinearProgress sx={{ mt: 1.5 }} />}

        {chartData.length > 0 && (
          <Box sx={{ mt: 2 }}>
            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>{t('time.chartTitle')}</Typography>
            <BarChart
              height={190}
              dataset={chartData}
              xAxis={[{ scaleType: 'band', dataKey: 'day' }]}
              series={[{ dataKey: 'hours', color: theme.palette.primary.main, valueFormatter: (v) => (v == null ? '' : `${v}h`) }]}
              margin={{ top: 12, right: 16, bottom: 28, left: 40 }}
            />
          </Box>
        )}

        <TableContainer sx={{ mt: 2 }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('time.period')}</TableCell>
                <TableCell align="right">{t('approvals.duration')}</TableCell>
                <TableCell align="right">{t('time.minutes')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.label}>
                  <TableCell>{r.label}</TableCell>
                  <TableCell align="right">{formatDurationMinutes(r.minutes)}</TableCell>
                  <TableCell align="right">{Math.round(r.minutes)}</TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && (
                <TableEmptyRow colSpan={3} icon={<ScheduleIcon fontSize="inherit" />} title={t('time.noEntries')} />
              )}
            </TableBody>
          </Table>
        </TableContainer>

        <Typography variant="subtitle1" sx={{ mt: 3, mb: 1 }}>{t('time.entries')}</Typography>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('time.date')}</TableCell>
                <TableCell>{t('time.time')}</TableCell>
                <TableCell align="right">{t('approvals.duration')}</TableCell>
                <TableCell>{t('time.project')}</TableCell>
                <TableCell>{t('time.subproject')}</TableCell>
                <TableCell>{t('time.comment')}</TableCell>
                <TableCell align="right">{t('common.actions')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {sortedEntries.map((e) => {
                const entryLocked = lockOf(e.project_id, splitLocal(e.start_time).date) !== null;
                return (
                  <TableRow key={e.id} hover>
                    <TableCell>{new Date(e.start_time).toLocaleDateString(locale)}</TableCell>
                    <TableCell>{timeOf(e.start_time, locale)} – {timeOf(e.end_time, locale)}</TableCell>
                    <TableCell align="right">{formatDurationMinutes(minutes(e))}</TableCell>
                    <TableCell>{e.project_name ?? '—'}</TableCell>
                    <TableCell>{e.subproject_name ?? '—'}</TableCell>
                    <TableCell>{e.comment || '—'}</TableCell>
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                      <Tooltip title={t('time.duplicate')}>
                        <IconButton size="small" aria-label={t('time.duplicate')} onClick={() => duplicateEntry(e)}>
                          <ContentCopyIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title={t('time.edit')}>
                        <span>
                          <IconButton
                            size="small"
                            disabled={entryLocked}
                            aria-label={t('time.edit')}
                            onClick={() => {
                              const { date, time } = splitLocal(e.start_time);
                              setOverlapConfirm((prev) => (prev?.kind === 'draft' ? null : prev));
                              setDraft({
                                id: e.id,
                                date,
                                startTime: time,
                                durationMinutes: minutesBetween(e.start_time, e.end_time),
                                projectId: e.project_id ?? '',
                                subprojectId: e.subproject_id ?? '',
                                comment: e.comment ?? '',
                              });
                            }}
                          >
                            <EditIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                      <Tooltip title={t('time.remove')}>
                        <span>
                          <IconButton
                            size="small"
                            color="error"
                            disabled={entryLocked}
                            aria-label={t('time.remove')}
                            onClick={() => setConfirmRemoveId(e.id)}
                          >
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                );
              })}
              {sortedEntries.length === 0 && (
                <TableEmptyRow colSpan={7} icon={<ScheduleIcon fontSize="inherit" />} title={t('time.noEntries')} />
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      <Dialog open={!!draft} onClose={closeDraft} fullWidth maxWidth="sm">
        <Box
          component="form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!draftDurationInvalid) void saveDraft();
          }}
        >
          <DialogTitle>{t('time.editEntry')}</DialogTitle>
          {draft && (
            <DialogContent sx={{ display: 'grid', gap: 2, pt: 1 }}>
              {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
              <TextField label={t('time.date')} type="date" value={draft.date} onChange={(e) => e.target.value && setDraft({ ...draft, date: e.target.value })} size="small" sx={{ mt: 1 }} />
              {useProjectTimeRanges && (
                <TextField
                  label={t('time.start')}
                  type="time"
                  value={draft.startTime}
                  onChange={(e) => e.target.value && setDraft({ ...draft, startTime: e.target.value })}
                  size="small"
                  slotProps={{ htmlInput: { step: 300 } }}
                />
              )}
              <TextField
                label={t('time.durationMinutes')}
                type="number"
                value={draft.durationMinutes}
                onChange={(e) => setDraft({ ...draft, durationMinutes: Number(e.target.value) })}
                size="small"
                slotProps={{ htmlInput: { step: 5, min: 5 } }}
                error={draftDurationInvalid}
                helperText={draftDurationInvalid ? t('time.durationMustBePositive') : formatDurationMinutes(draft.durationMinutes)}
              />
              <TextField
                select
                label={t('time.project')}
                value={draft.projectId}
                onChange={(e) => setDraft({ ...draft, projectId: e.target.value, subprojectId: '' })}
                size="small"
              >
                <MenuItem value=""><em>{t('time.none')}</em></MenuItem>
                {projects.map((p) => (<MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>))}
              </TextField>
              <TextField
                select
                label={t('time.subproject')}
                value={draft.subprojectId}
                onChange={(e) => setDraft({ ...draft, subprojectId: e.target.value })}
                size="small"
                disabled={!draft.projectId || draftSubprojects.length === 0}
              >
                <MenuItem value=""><em>{t('time.none')}</em></MenuItem>
                {draftSubprojects.map((s) => (<MenuItem key={s.id} value={s.id}>{s.name}</MenuItem>))}
              </TextField>
              <TextField
                label={t('time.comment')}
                value={draft.comment}
                onChange={(e) => setDraft({ ...draft, comment: e.target.value })}
                size="small"
                multiline
                minRows={2}
                sx={{ '& textarea': { resize: 'vertical' } }}
              />
            </DialogContent>
          )}
          <DialogActions>
            <Button onClick={closeDraft}>{t('time.cancel')}</Button>
            <Button type="submit" variant="contained" disabled={draftDurationInvalid}>{t('time.save')}</Button>
          </DialogActions>
        </Box>
      </Dialog>

      <Dialog open={!!attendanceConfirm} onClose={() => setAttendanceConfirm(null)} fullWidth maxWidth="xs">
        <DialogTitle>{t('time.attendanceTitle')}</DialogTitle>
        <DialogContent sx={{ display: 'grid', gap: 1, pt: 1 }}>
          <Typography variant="body2">{attendanceConfirm?.message}</Typography>
          <Typography variant="body2">{t('time.attendanceConfirm')}</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAttendanceConfirm(null)}>{t('time.cancel')}</Button>
          <Button
            variant="contained"
            onClick={() => {
              if (attendanceConfirm?.kind === 'add') void addEntry(attendanceConfirm.overlapAck, true);
              else if (attendanceConfirm?.kind === 'draft') void saveDraft(attendanceConfirm.overlapAck, true);
            }}
          >
            {t('time.bookAnyway')}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!overlapConfirm} onClose={() => setOverlapConfirm(null)} fullWidth maxWidth="xs">
        <DialogTitle>{t('time.overlapTitle')}</DialogTitle>
        <DialogContent sx={{ display: 'grid', gap: 1, pt: 1 }}>
          <Typography variant="body2">
            {overlapConfirm && overlapConfirm.overlaps.length > 1 ? t('time.overlapIntroMany') : t('time.overlapIntroOne')}
          </Typography>
          {overlapConfirm?.overlaps.map((o) => (
            <Typography key={o.id} variant="body2" color="text.secondary">
              {timeOf(o.start_time, locale)} – {timeOf(o.end_time, locale)}{o.comment ? ` (${o.comment})` : ''}
            </Typography>
          ))}
          <Typography variant="body2">{t('time.overlapConfirm')}</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOverlapConfirm(null)}>{t('time.cancel')}</Button>
          <Button
            variant="contained"
            onClick={() => {
              if (overlapConfirm?.kind === 'add') void addEntry(true);
              else if (overlapConfirm?.kind === 'draft') void saveDraft(true);
            }}
          >
            {t('time.addAnyway')}
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={!!confirmRemoveId}
        title={t('time.removeEntry')}
        message={t('time.removeEntryConfirm')}
        confirmLabel={t('time.remove')}
        cancelLabel={t('common.cancel')}
        onClose={() => setConfirmRemoveId(null)}
        onConfirm={() => {
          if (confirmRemoveId) return removeEntry(confirmRemoveId);
        }}
      />
    </Box>
  );
}
