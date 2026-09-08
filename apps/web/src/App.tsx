import { useMemo, useState } from 'react';
import { AppBar, Box, Button, Container, TextField, ToggleButton, ToggleButtonGroup, Toolbar, Typography, Paper, Table, TableBody, TableCell, TableHead, TableRow } from '@mui/material';
import { bucket, type Entry, type View } from './aggregate';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';

export default function App() {
  const [role, setRole] = useState<'admin' | 'manager' | 'user'>('user');
  const [view, setView] = useState<View>('weekly');
  const [entries, setEntries] = useState<Entry[]>([
    { id: '1', start_time: '2026-09-07T08:00:00Z', end_time: '2026-09-07T09:30:00Z', comment: 'Homepage hero' },
    { id: '2', start_time: '2026-09-06T08:00:00Z', end_time: '2026-09-06T09:00:00Z', comment: 'Bugfix' },
  ]);
  const [start, setStart] = useState('2026-09-08T08:00');
  const [end, setEnd] = useState('2026-09-08T09:00');
  const [comment, setComment] = useState('');

  const rows = useMemo(() => bucket(entries, view), [entries, view]);
  const total = rows.reduce((s, r) => s + r.minutes, 0);

  async function addEntry() {
    const e: Entry = { id: String(Date.now()), start_time: new Date(start).toISOString(), end_time: new Date(end).toISOString(), comment };
    setEntries((p) => [...p, e]);
    try {
      await fetch(`${API}/organizations/acme/work-time`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: 'me', startTime: e.start_time, endTime: e.end_time, comment }),
      });
    } catch { /* offline demo */ }
  }

  return (
    <Box>
      <AppBar position="static">
        <Toolbar>
          <Typography variant="h6" sx={{ flexGrow: 1 }}>Worktime</Typography>
          <ToggleButtonGroup value={role} exclusive onChange={(_, v) => v && setRole(v)} size="small" sx={{ bgcolor: 'white' }}>
            <ToggleButton value="user">User</ToggleButton>
            <ToggleButton value="manager">Manager</ToggleButton>
            <ToggleButton value="admin">Admin</ToggleButton>
          </ToggleButtonGroup>
        </Toolbar>
      </AppBar>
      <Container sx={{ py: 3, display: 'grid', gap: 2 }}>
        <Paper sx={{ p: 2 }}>
          <Typography variant="h6">Log work time (all roles)</Typography>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 1 }}>
            <TextField label="Start" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} size="small" />
            <TextField label="End" type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} size="small" />
            <TextField label="Comment" value={comment} onChange={(e) => setComment(e.target.value)} size="small" />
            <Button variant="contained" onClick={addEntry}>Add</Button>
          </Box>
        </Paper>
        <Paper sx={{ p: 2 }}>
          <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
            <Typography variant="h6">Overview — {view} ({Math.round(total)} min)</Typography>
            <ToggleButtonGroup value={view} exclusive onChange={(_, v) => v && setView(v)} size="small">
              <ToggleButton value="daily">Daily</ToggleButton>
              <ToggleButton value="weekly">Weekly</ToggleButton>
              <ToggleButton value="monthly">Monthly</ToggleButton>
            </ToggleButtonGroup>
          </Box>
          <Table size="small" sx={{ mt: 1 }}>
            <TableHead><TableRow><TableCell>Period</TableCell><TableCell>Minutes</TableCell></TableRow></TableHead>
            <TableBody>
              {rows.map((r) => (<TableRow key={r.label}><TableCell>{r.label}</TableCell><TableCell>{Math.round(r.minutes)}</TableCell></TableRow>))}
            </TableBody>
          </Table>
        </Paper>
        {(role === 'manager' || role === 'admin') && (
          <Paper sx={{ p: 2 }}>
            <Typography variant="h6">Teams & subprojects (manager/admin)</Typography>
            <Typography variant="body2">Invite users, assign roles, create teams and subprojects you own.</Typography>
          </Paper>
        )}
        {role === 'admin' && (
          <Paper sx={{ p: 2 }}>
            <Typography variant="h6">Static data & audit (admin)</Typography>
            <Typography variant="body2">Manage enums, SSO/domains override, inspect audit logs.</Typography>
          </Paper>
        )}
      </Container>
    </Box>
  );
}
