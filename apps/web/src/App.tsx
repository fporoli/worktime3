import { useEffect, useMemo, useState } from 'react';
import { AppBar, Box, Button, Container, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, TextField, ToggleButton, ToggleButtonGroup, Toolbar, Typography, Paper, Table, TableBody, TableCell, TableHead, TableRow } from '@mui/material';
import { bucket, minutes, type Entry, type View } from './aggregate';
import Login, { clearSession, loadSession, saveSession, type Session } from './Login';
import { keycloak, refreshSsoToken, ssoLogout } from './auth';
import Management from './Management';
import Invitations from './Invitations';
import AdminSettings from './AdminSettings';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';

/** A project or subproject as returned by the API (raw db row). */
interface Option {
  id: string;
  name: string;
}

/** The entry being edited, held in the shape the form controls need. */
interface Draft {
  id: string;
  start: string;
  end: string;
  projectId: string;
  subprojectId: string;
  comment: string;
}

function defaultRole(session: Session): 'admin' | 'manager' | 'user' {
  const roles = session.memberships.map((m) => m.role);
  if (roles.includes('owner') || roles.includes('admin')) return 'admin';
  if (roles.includes('manager')) return 'manager';
  return 'user';
}


/** ISO instant -> the `YYYY-MM-DDTHH:mm` local-time shape a datetime-local input wants. */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function App() {
  const [session, setSession] = useState<Session | null>(() => loadSession());
  const [role, setRole] = useState<'admin' | 'manager' | 'user'>(() => (session ? defaultRole(session) : 'user'));
  const [view, setView] = useState<View>('weekly');
  const [entries, setEntries] = useState<Entry[]>([
    { id: '1', start_time: '2026-09-07T08:00:00Z', end_time: '2026-09-07T09:30:00Z', comment: 'Homepage hero' },
    { id: '2', start_time: '2026-09-06T08:00:00Z', end_time: '2026-09-06T09:00:00Z', comment: 'Bugfix' },
  ]);
  const [start, setStart] = useState('2026-09-08T08:00');
  const [end, setEnd] = useState('2026-09-08T09:00');
  const [comment, setComment] = useState('');
  const [projects, setProjects] = useState<Option[]>([]);
  const [subprojectsByProject, setSubprojectsByProject] = useState<Record<string, Option[]>>({});
  const [projectId, setProjectId] = useState('');
  const [subprojectId, setSubprojectId] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);

  const rows = useMemo(() => bucket(entries, view), [entries, view]);
  const total = rows.reduce((s, r) => s + r.minutes, 0);
  const orgId = session?.memberships[0]?.organizationId ?? null;
  const subprojects = subprojectsByProject[projectId] ?? [];
  const draftSubprojects = draft ? (subprojectsByProject[draft.projectId] ?? []) : [];

  // Auth header for API calls; renews an expiring Keycloak token first.
  async function authHeaders(): Promise<Record<string, string>> {
    if (!session) return {};
    let token = session.token;
    if (session.sso) {
      await refreshSsoToken();
      token = keycloak.token ?? token;
      if (token !== session.token) {
        const updated = { ...session, token };
        setSession(updated);
        saveSession(updated);
      }
    }
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  /** Fetch a project's subprojects once and keep them; both the add form and the edit dialog read this. */
  async function ensureSubprojects(pid: string) {
    if (!pid || subprojectsByProject[pid]) return;
    try {
      const res = await fetch(`${API}/projects/${pid}/subprojects`, { headers: await authHeaders() });
      const data = await res.json();
      setSubprojectsByProject((prev) => ({ ...prev, [pid]: Array.isArray(data) ? data : [] }));
    } catch { /* offline demo */ }
  }

  async function reloadEntries() {
    if (!orgId || !session) return;
    try {
      const res = await fetch(`${API}/organizations/${orgId}/work-time?userId=${session.userId}`, {
        headers: await authHeaders(),
      });
      const data = await res.json();
      if (Array.isArray(data.entries)) setEntries(data.entries);
    } catch { /* offline demo: keep whatever is on screen */ }
  }

  async function reloadProjects() {
    if (!orgId) return;
    try {
      const res = await fetch(`${API}/organizations/${orgId}/projects`, { headers: await authHeaders() });
      const data = await res.json();
      if (Array.isArray(data)) setProjects(data);
    } catch { /* offline demo */ }
  }

  // Projects to pick from when logging time, plus the caller's own entries.
  useEffect(() => {
    if (!orgId) return;
    reloadProjects();
    reloadEntries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);


  // Subprojects depend on the chosen project, in the add form and in the dialog alike.
  useEffect(() => {
    ensureSubprojects(projectId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => {
    if (draft) ensureSubprojects(draft.projectId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft?.projectId]);

  if (!session) {
    return <Login onLoggedIn={(s) => { setSession(s); setRole(defaultRole(s)); }} />;
  }

  async function addEntry() {
    const e: Entry = {
      id: String(Date.now()),
      start_time: new Date(start).toISOString(),
      end_time: new Date(end).toISOString(),
      comment,
      project_id: projectId || null,
      subproject_id: subprojectId || null,
      project_name: projects.find((p) => p.id === projectId)?.name ?? null,
      subproject_name: subprojects.find((s) => s.id === subprojectId)?.name ?? null,
    };
    setEntries((p) => [...p, e]);
    if (!orgId) return;
    try {
      await fetch(`${API}/organizations/${orgId}/work-time`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({
          startTime: e.start_time,
          endTime: e.end_time,
          projectId: projectId || undefined,
          subprojectId: subprojectId || undefined,
          comment,
        }),
      });
      await reloadEntries();
    } catch { /* offline demo */ }
  }

  async function saveDraft() {
    if (!draft) return;
    const patch = {
      startTime: new Date(draft.start).toISOString(),
      endTime: new Date(draft.end).toISOString(),
      projectId: draft.projectId || null,
      subprojectId: draft.subprojectId || null,
      comment: draft.comment,
    };
    setEntries((prev) =>
      prev.map((e) =>
        e.id === draft.id
          ? {
              ...e,
              start_time: patch.startTime,
              end_time: patch.endTime,
              project_id: patch.projectId,
              subproject_id: patch.subprojectId,
              comment: draft.comment,
              project_name: projects.find((p) => p.id === draft.projectId)?.name ?? null,
              subproject_name: draftSubprojects.find((s) => s.id === draft.subprojectId)?.name ?? null,
            }
          : e,
      ),
    );
    setDraft(null);
    try {
      await fetch(`${API}/work-time/${draft.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify(patch),
      });
      await reloadEntries();
    } catch { /* offline demo */ }
  }

  async function logout() {
    if (session?.sso) {
      try {
        await ssoLogout();
      } catch { /* fall through to local clear */ }
    }
    clearSession();
    setSession(null);
  }

  const addRangeInvalid = !(new Date(end) > new Date(start));
  const draftRangeInvalid = !!draft && !(new Date(draft.end) > new Date(draft.start));

  return (
    <Box>
      <AppBar position="static">
        <Toolbar>
          <Typography variant="h6" sx={{ flexGrow: 1 }}>Worktime</Typography>
          <Typography variant="body2" sx={{ mr: 2 }}>{session.displayName} ({session.email})</Typography>
          <Button color="inherit" size="small" onClick={logout}>Logout</Button>
          <ToggleButtonGroup value={role} exclusive onChange={(_, v) => v && setRole(v)} size="small" sx={{ bgcolor: 'white', ml: 1 }}>
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
            <TextField label="End" type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} size="small" error={addRangeInvalid} helperText={addRangeInvalid ? 'End must be after start' : ' '} />
            <TextField
              select
              label="Project"
              value={projectId}
              onChange={(e) => { setProjectId(e.target.value); setSubprojectId(''); }}
              size="small"
              sx={{ minWidth: 180 }}
            >
              <MenuItem value=""><em>None</em></MenuItem>
              {projects.map((p) => (<MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>))}
            </TextField>
            <TextField
              select
              label="Subproject"
              value={subprojectId}
              onChange={(e) => setSubprojectId(e.target.value)}
              size="small"
              sx={{ minWidth: 180 }}
              disabled={!projectId || subprojects.length === 0}
            >
              <MenuItem value=""><em>None</em></MenuItem>
              {subprojects.map((s) => (<MenuItem key={s.id} value={s.id}>{s.name}</MenuItem>))}
            </TextField>
            <TextField label="Comment" value={comment} onChange={(e) => setComment(e.target.value)} size="small" />
            <Button variant="contained" onClick={addEntry} disabled={addRangeInvalid}>Add</Button>
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
          <Typography variant="subtitle1" sx={{ mt: 3 }}>Entries</Typography>
          <Table size="small" sx={{ mt: 1 }}>
            <TableHead>
              <TableRow>
                <TableCell>Date</TableCell>
                <TableCell>Time</TableCell>
                <TableCell align="right">Minutes</TableCell>
                <TableCell>Project</TableCell>
                <TableCell>Subproject</TableCell>
                <TableCell>Comment</TableCell>
                <TableCell align="right" />
              </TableRow>
            </TableHead>
            <TableBody>
              {entries.map((e) => (
                <TableRow key={e.id} hover>
                  <TableCell>{new Date(e.start_time).toLocaleDateString()}</TableCell>
                  <TableCell>{timeOf(e.start_time)} – {timeOf(e.end_time)}</TableCell>
                  <TableCell align="right">{Math.round(minutes(e))}</TableCell>
                  <TableCell>{e.project_name ?? '—'}</TableCell>
                  <TableCell>{e.subproject_name ?? '—'}</TableCell>
                  <TableCell>{e.comment}</TableCell>
                  <TableCell align="right">
                    <Button
                      size="small"
                      onClick={() => setDraft({
                        id: e.id,
                        start: toLocalInput(e.start_time),
                        end: toLocalInput(e.end_time),
                        projectId: e.project_id ?? '',
                        subprojectId: e.subproject_id ?? '',
                        comment: e.comment ?? '',
                      })}
                    >
                      Edit
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {entries.length === 0 && (
                <TableRow><TableCell colSpan={7}>No entries yet.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </Paper>
        {(role === 'manager' || role === 'admin') && (
          <Management
            session={session}
            role={role}
            authHeaders={authHeaders}
            onDataChanged={() => {
              reloadProjects();
              setSubprojectsByProject({});
              if (projectId) ensureSubprojects(projectId);
            }}
          />
        )}
        {(role === 'manager' || role === 'admin') && (
          <Invitations session={session} authHeaders={authHeaders} />
        )}
        {role === 'admin' && (
          <AdminSettings session={session} authHeaders={authHeaders} />
        )}
      </Container>

      <Dialog open={!!draft} onClose={() => setDraft(null)} fullWidth maxWidth="sm">
        <DialogTitle>Edit entry</DialogTitle>
        {draft && (
          <DialogContent sx={{ display: 'grid', gap: 2, pt: 1 }}>
            <TextField label="Start" type="datetime-local" value={draft.start} onChange={(e) => setDraft({ ...draft, start: e.target.value })} size="small" sx={{ mt: 1 }} />
            <TextField label="End" type="datetime-local" value={draft.end} onChange={(e) => setDraft({ ...draft, end: e.target.value })} size="small" error={draftRangeInvalid} helperText={draftRangeInvalid ? 'End must be after start' : ' '} />
            <TextField
              select
              label="Project"
              value={draft.projectId}
              onChange={(e) => setDraft({ ...draft, projectId: e.target.value, subprojectId: '' })}
              size="small"
            >
              <MenuItem value=""><em>None</em></MenuItem>
              {projects.map((p) => (<MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>))}
            </TextField>
            <TextField
              select
              label="Subproject"
              value={draft.subprojectId}
              onChange={(e) => setDraft({ ...draft, subprojectId: e.target.value })}
              size="small"
              disabled={!draft.projectId || draftSubprojects.length === 0}
            >
              <MenuItem value=""><em>None</em></MenuItem>
              {draftSubprojects.map((s) => (<MenuItem key={s.id} value={s.id}>{s.name}</MenuItem>))}
            </TextField>
            <TextField label="Comment" value={draft.comment} onChange={(e) => setDraft({ ...draft, comment: e.target.value })} size="small" />
          </DialogContent>
        )}
        <DialogActions>
          <Button onClick={() => setDraft(null)}>Cancel</Button>
          <Button variant="contained" onClick={saveDraft} disabled={draftRangeInvalid}>Save</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
