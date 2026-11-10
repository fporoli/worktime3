import { Fragment, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
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
  Typography,
  useTheme,
} from '@mui/material';
import { BarChart } from '@mui/x-charts/BarChart';
import { bucket, minutes, periodLabel, periodRange, shiftPeriod, todayDate, type Entry, type PeriodType, type View } from './aggregate';
import { useI18n } from './i18n';
import { formatDurationMinutes } from './localeFormat';
import { PageHeader, TableEmptyRow } from './components';
import { ChevronLeftIcon, ChevronRightIcon, GroupIcon } from './icons';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';

interface TeamOption {
  id: string;
  name: string;
}

interface TeamMemberEntry extends Entry {
  user_id: string;
}

interface MemberInfo {
  user_id: string;
  email: string;
  display_name: string;
}

interface TeamHoursProps {
  orgId: string;
  authHeaders: () => Promise<Record<string, string>>;
}

export default function TeamHours({ orgId, authHeaders }: TeamHoursProps) {
  const { t, locale } = useI18n();
  const theme = useTheme();
  const [teams, setTeams] = useState<TeamOption[]>([]);
  const [teamId, setTeamId] = useState('');
  const [view, setView] = useState<View>('weekly');
  const [anchor, setAnchor] = useState<string>(todayDate());
  const [members, setMembers] = useState<MemberInfo[]>([]);
  const [entries, setEntries] = useState<TeamMemberEntry[]>([]);
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const periodType: PeriodType = view === 'daily' ? 'day' : view === 'weekly' ? 'week' : 'month';
  const { from, to } = periodRange(periodType, anchor);

  async function reloadTeams() {
    try {
      const res = await fetch(`${API}/organizations/${orgId}/teams`, { headers: await authHeaders() });
      const data = await res.json();
      if (Array.isArray(data)) {
        setTeams(data);
        setTeamId((prev) => (prev && data.some((tm: TeamOption) => tm.id === prev) ? prev : data[0]?.id ?? ''));
      }
    } catch { /* offline fallback */ } finally {
      setLoading(false);
    }
  }

  async function reloadProjectTime(id: string, fromIso: string, toIso: string) {
    if (!id) {
      setMembers([]);
      setEntries([]);
      setLoading(false);
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const url = new URL(`${API}/teams/${id}/project-time`);
      url.searchParams.set('from', fromIso);
      url.searchParams.set('to', toIso);
      const res = await fetch(url.toString(), { headers: await authHeaders() });
      const data = await res.json();
      setMembers(Array.isArray(data.members) ? data.members : []);
      setEntries(Array.isArray(data.entries) ? data.entries : []);
    } catch {
      setError(t('teamHours.loadFailed'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setTeamId('');
    void reloadTeams();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  useEffect(() => {
    setExpandedUserId(null);
    void reloadProjectTime(teamId, from, to);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId, from, to]);

  const entriesByUser = useMemo(() => {
    const map = new Map<string, TeamMemberEntry[]>();
    for (const e of entries) {
      const list = map.get(e.user_id) ?? [];
      list.push(e);
      map.set(e.user_id, list);
    }
    return map;
  }, [entries]);

  const memberChartData = useMemo(
    () =>
      members.map((m) => {
        const mins = (entriesByUser.get(m.user_id) ?? []).reduce((sum, e) => sum + minutes(e), 0);
        return { name: m.display_name, hours: Math.round((mins / 60) * 100) / 100 };
      }),
    [members, entriesByUser],
  );

  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <PageHeader title={t('teamHours.title')} subtitle={t('teamHours.subtitle')} />

      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
      {loading && <LinearProgress />}

      <Paper sx={{ p: 2 }}>
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', mb: 2, flexWrap: 'wrap' }}>
          <TextField select label={t('teamHours.team')} value={teamId} onChange={(e) => setTeamId(e.target.value)} size="small" sx={{ minWidth: 200 }}>
            {teams.map((team) => (<MenuItem key={team.id} value={team.id}>{team.name}</MenuItem>))}
          </TextField>
          <ToggleButtonGroup value={view} exclusive onChange={(_, v) => v && setView(v)} size="small">
            <ToggleButton value="daily">{t('time.day')}</ToggleButton>
            <ToggleButton value="weekly">{t('time.week')}</ToggleButton>
            <ToggleButton value="monthly">{t('time.month')}</ToggleButton>
          </ToggleButtonGroup>
        </Box>

        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mb: 2, flexWrap: 'wrap' }}>
          <Typography variant="subtitle2" sx={{ mr: 1, minWidth: 160 }}>
            {periodLabel(periodType, anchor, locale)}
          </Typography>
          <Button size="small" startIcon={<ChevronLeftIcon fontSize="small" />} onClick={() => setAnchor((a) => shiftPeriod(periodType, a, -1))}>
            {t('time.prev').replace('‹ ', '')}
          </Button>
          <TextField
            type={periodType === 'month' ? 'month' : 'date'}
            size="small"
            value={periodType === 'month' ? anchor.slice(0, 7) : anchor}
            onChange={(e) => {
              if (!e.target.value) return;
              setAnchor(periodType === 'month' ? `${e.target.value}-01` : e.target.value);
            }}
          />
          <Button size="small" endIcon={<ChevronRightIcon fontSize="small" />} onClick={() => setAnchor((a) => shiftPeriod(periodType, a, 1))}>
            {t('time.next').replace(' ›', '')}
          </Button>
          {anchor !== todayDate() && (
            <Button size="small" onClick={() => setAnchor(todayDate())}>{t('time.today')}</Button>
          )}
        </Box>

        {teams.length === 0 && !loading && (
          <Typography variant="body2" color="text.secondary">{t('teamHours.noTeams')}</Typography>
        )}

        {teams.length > 0 && memberChartData.length > 0 && memberChartData.some((d) => d.hours > 0) && (
          <Box sx={{ mb: 2.5 }}>
            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>{t('teamHours.chartTitle')}</Typography>
            <BarChart
              height={200}
              dataset={memberChartData}
              xAxis={[{ scaleType: 'band', dataKey: 'name' }]}
              series={[{ dataKey: 'hours', color: theme.palette.primary.main, valueFormatter: (v) => (v == null ? '' : `${v}h`) }]}
              margin={{ top: 12, right: 16, bottom: 28, left: 40 }}
            />
          </Box>
        )}

        {teams.length > 0 && (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t('teamHours.member')}</TableCell>
                  <TableCell align="right">{t('teamHours.totalBooked')}</TableCell>
                  <TableCell align="right">{t('time.entries')}</TableCell>
                  <TableCell align="right" />
                </TableRow>
              </TableHead>
              <TableBody>
                {members.map((m) => {
                  const memberEntries = entriesByUser.get(m.user_id) ?? [];
                  const total = memberEntries.reduce((sum, e) => sum + minutes(e), 0);
                  const isExpanded = expandedUserId === m.user_id;
                  return (
                    <Fragment key={m.user_id}>
                      <TableRow hover selected={isExpanded}>
                        <TableCell>
                          <Typography variant="body2" sx={{ fontWeight: 600 }}>{m.display_name}</Typography>
                          <Typography variant="caption" color="text.secondary">{m.email}</Typography>
                        </TableCell>
                        <TableCell align="right">
                          <Chip label={formatDurationMinutes(total)} size="small" color={total > 0 ? 'primary' : 'default'} variant="outlined" />
                        </TableCell>
                        <TableCell align="right">{memberEntries.length}</TableCell>
                        <TableCell align="right">
                          <Button
                            size="small"
                            variant={isExpanded ? 'contained' : 'outlined'}
                            disabled={memberEntries.length === 0}
                            onClick={() => setExpandedUserId(isExpanded ? null : m.user_id)}
                          >
                            {isExpanded ? t('teamHours.hide') : t('audit.col.details')}
                          </Button>
                        </TableCell>
                      </TableRow>
                      {isExpanded && (
                        <TableRow>
                          <TableCell colSpan={4} sx={{ bgcolor: 'action.hover', py: 2 }}>
                            <Typography variant="subtitle2" sx={{ mb: 1 }}>{t(`teamHours.breakdown.${view}`)}</Typography>
                            <TableContainer sx={{ mb: 2, bgcolor: 'background.paper' }}>
                              <Table size="small">
                                <TableHead>
                                  <TableRow>
                                    <TableCell>{t('time.period')}</TableCell>
                                    <TableCell align="right">{t('approvals.duration')}</TableCell>
                                    <TableCell align="right">{t('common.minutes')}</TableCell>
                                  </TableRow>
                                </TableHead>
                                <TableBody>
                                  {bucket(memberEntries, view).map((r) => (
                                    <TableRow key={r.label}>
                                      <TableCell>{r.label}</TableCell>
                                      <TableCell align="right">{formatDurationMinutes(r.minutes)}</TableCell>
                                      <TableCell align="right">{Math.round(r.minutes)}</TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            </TableContainer>
                            <Typography variant="subtitle2" sx={{ mb: 1 }}>{t('time.entries')}</Typography>
                            <TableContainer sx={{ bgcolor: 'background.paper' }}>
                              <Table size="small">
                                <TableHead>
                                  <TableRow>
                                    <TableCell>{t('common.date')}</TableCell>
                                    <TableCell align="right">{t('approvals.duration')}</TableCell>
                                    <TableCell>{t('common.project')}</TableCell>
                                    <TableCell>{t('common.subproject')}</TableCell>
                                    <TableCell>{t('common.comment')}</TableCell>
                                  </TableRow>
                                </TableHead>
                                <TableBody>
                                  {memberEntries.map((e) => (
                                    <TableRow key={e.id}>
                                      <TableCell>{new Date(e.start_time).toLocaleDateString(locale)}</TableCell>
                                      <TableCell align="right">{formatDurationMinutes(minutes(e))}</TableCell>
                                      <TableCell>{e.project_name ?? '—'}</TableCell>
                                      <TableCell>{e.subproject_name ?? '—'}</TableCell>
                                      <TableCell>{e.comment || '—'}</TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            </TableContainer>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                })}
                {members.length === 0 && !loading && (
                  <TableEmptyRow colSpan={4} icon={<GroupIcon fontSize="inherit" />} title={t('teamHours.noMembers')} />
                )}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Paper>
    </Box>
  );
}
