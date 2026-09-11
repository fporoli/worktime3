import { Fragment, useEffect, useState } from 'react';
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
  TableHead,
  TableRow,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { bucket, minutes, type Entry, type View } from './aggregate';

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

function formatHours(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return `${h}h ${m}m`;
}

interface TeamHoursProps {
  orgId: string;
  authHeaders: () => Promise<Record<string, string>>;
}

export default function TeamHours({ orgId, authHeaders }: TeamHoursProps) {
  const [teams, setTeams] = useState<TeamOption[]>([]);
  const [teamId, setTeamId] = useState('');
  const [view, setView] = useState<View>('weekly');
  const [members, setMembers] = useState<MemberInfo[]>([]);
  const [entries, setEntries] = useState<TeamMemberEntry[]>([]);
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function reloadTeams() {
    try {
      const res = await fetch(`${API}/organizations/${orgId}/teams`, { headers: await authHeaders() });
      const data = await res.json();
      if (Array.isArray(data)) {
        setTeams(data);
        setTeamId((prev) => prev || data[0]?.id || '');
      }
    } catch { /* offline fallback */ }
  }

  async function reloadWorkTime(id: string) {
    if (!id) return;
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`${API}/teams/${id}/work-time`, { headers: await authHeaders() });
      const data = await res.json();
      setMembers(Array.isArray(data.members) ? data.members : []);
      setEntries(Array.isArray(data.entries) ? data.entries : []);
    } catch {
      setError('Failed to load team hours. Is the API running?');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reloadTeams();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  useEffect(() => {
    setExpandedUserId(null);
    reloadWorkTime(teamId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId]);

  const entriesByUser = new Map<string, TeamMemberEntry[]>();
  for (const e of entries) {
    const list = entriesByUser.get(e.user_id) ?? [];
    list.push(e);
    entriesByUser.set(e.user_id, list);
  }

  return (
    <Paper sx={{ p: 2 }}>
      <Typography variant="h6">Team Hours</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Booked hours for each member of a team.
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
      {loading && <LinearProgress sx={{ mb: 2 }} />}

      <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', mb: 2, flexWrap: 'wrap' }}>
        <TextField select label="Team" value={teamId} onChange={(e) => setTeamId(e.target.value)} size="small" sx={{ minWidth: 200 }}>
          {teams.map((t) => (<MenuItem key={t.id} value={t.id}>{t.name}</MenuItem>))}
        </TextField>
        <ToggleButtonGroup value={view} exclusive onChange={(_, v) => v && setView(v)} size="small">
          <ToggleButton value="daily">Daily</ToggleButton>
          <ToggleButton value="weekly">Weekly</ToggleButton>
          <ToggleButton value="monthly">Monthly</ToggleButton>
        </ToggleButtonGroup>
      </Box>

      {teams.length === 0 && <Typography variant="body2" color="text.secondary">No teams yet — create one in the Teams tab first.</Typography>}

      {teams.length > 0 && (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Member</TableCell>
              <TableCell align="right">Total booked</TableCell>
              <TableCell align="right">Entries</TableCell>
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
                      <Chip label={formatHours(total)} size="small" color={total > 0 ? 'primary' : 'default'} variant="outlined" />
                    </TableCell>
                    <TableCell align="right">{memberEntries.length}</TableCell>
                    <TableCell align="right">
                      <Button
                        size="small"
                        variant={isExpanded ? 'contained' : 'outlined'}
                        disabled={memberEntries.length === 0}
                        onClick={() => setExpandedUserId(isExpanded ? null : m.user_id)}
                      >
                        {isExpanded ? 'Hide' : 'Details'}
                      </Button>
                    </TableCell>
                  </TableRow>
                  {isExpanded && (
                    <TableRow>
                      <TableCell colSpan={4} sx={{ bgcolor: 'action.hover', py: 2 }}>
                        <Typography variant="subtitle2" sx={{ mb: 1 }}>{view} breakdown</Typography>
                        <Table size="small" sx={{ mb: 2, bgcolor: 'background.paper' }}>
                          <TableHead><TableRow><TableCell>Period</TableCell><TableCell align="right">Minutes</TableCell></TableRow></TableHead>
                          <TableBody>
                            {bucket(memberEntries, view).map((r) => (
                              <TableRow key={r.label}><TableCell>{r.label}</TableCell><TableCell align="right">{Math.round(r.minutes)}</TableCell></TableRow>
                            ))}
                          </TableBody>
                        </Table>
                        <Typography variant="subtitle2" sx={{ mb: 1 }}>Entries</Typography>
                        <Table size="small" sx={{ bgcolor: 'background.paper' }}>
                          <TableHead>
                            <TableRow>
                              <TableCell>Date</TableCell>
                              <TableCell align="right">Minutes</TableCell>
                              <TableCell>Project</TableCell>
                              <TableCell>Subproject</TableCell>
                              <TableCell>Comment</TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {memberEntries.map((e) => (
                              <TableRow key={e.id}>
                                <TableCell>{new Date(e.start_time).toLocaleDateString()}</TableCell>
                                <TableCell align="right">{Math.round(minutes(e))}</TableCell>
                                <TableCell>{e.project_name ?? '—'}</TableCell>
                                <TableCell>{e.subproject_name ?? '—'}</TableCell>
                                <TableCell>{e.comment}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              );
            })}
            {members.length === 0 && (
              <TableRow><TableCell colSpan={4}>This team has no members yet.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      )}
    </Paper>
  );
}
