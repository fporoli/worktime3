import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  AppBar,
  Box,
  Button,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Drawer,
  FormControl,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  ListSubheader,
  MenuItem,
  Select,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Toolbar,
  Typography,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { bucket, minutes, periodLabel, periodRange, shiftPeriod, todayDate, type Entry, type PeriodType } from './aggregate';
import Login, { clearSession, loadSession, saveSession, type Session } from './Login';
import { keycloak, refreshSsoToken, ssoLogout } from './auth';
import Management from './Management';
import Invitations from './Invitations';
import AdminSettings from './AdminSettings';
import OrganizationSettings from './OrganizationSettings';
import Timesheet from './Timesheet';
import Approvals from './Approvals';
import Assistant from './Assistant';
import TeamHours from './TeamHours';
import AuditLog from './AuditLog';
import Users from './Users';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';
const DRAWER_WIDTH = 220;

type Section = 'time' | 'timesheet' | 'management' | 'hours' | 'invitations' | 'approvals' | 'users' | 'audit' | 'admin' | 'orgSettings';

const ASSISTANT_TAB_WIDTH = 40;
const ASSISTANT_PANEL_WIDTH = 380;

const WORK_TIME_ERROR_MESSAGES: Record<string, string> = {
  'period-locked': 'This month has already been submitted or approved and is locked. Ask your manager to reopen it, or use a different month.',
  'forbidden': 'You do not have permission to do that.',
  'not-found': 'That entry no longer exists.',
  'unknown-user': 'Could not identify your account — try logging in again.',
};

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

/** The caller's role is scoped to whichever organization is currently active — not aggregated across all of them. */
function defaultRole(session: Session, orgId: string | null): 'admin' | 'manager' | 'user' {
  const membership = session.memberships.find((m) => m.organizationId === orgId);
  if (membership?.role === 'owner' || membership?.role === 'admin') return 'admin';
  if (membership?.role === 'manager') return 'manager';
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

/** Today at the given local hour, in the `YYYY-MM-DDTHH:mm` shape a datetime-local input wants. */
function todayAt(hour: number): string {
  const d = new Date();
  d.setHours(hour, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function App() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [appBarNode, setAppBarNode] = useState<HTMLElement | null>(null);
  const [appBarHeight, setAppBarHeight] = useState(64);

  // The AppBar can wrap to a second row on narrow screens, so its height isn't a fixed constant —
  // measure it live and use that to offset content, instead of a plain <Toolbar /> spacer. A state
  // (not a plain ref) is used so this re-attaches once the AppBar actually mounts post-login.
  useEffect(() => {
    if (!appBarNode) return;
    const observer = new ResizeObserver((entries) => {
      const height = entries[0]?.contentRect.height;
      if (height) setAppBarHeight(height);
    });
    observer.observe(appBarNode);
    return () => observer.disconnect();
  }, [appBarNode]);

  const [session, setSession] = useState<Session | null>(() => loadSession());
  const [currentOrgId, setCurrentOrgId] = useState<string | null>(
    () => session?.memberships[0]?.organizationId ?? null,
  );
  const [section, setSection] = useState<Section>('time');
  const [periodType, setPeriodType] = useState<PeriodType>('week');
  const [periodAnchor, setPeriodAnchor] = useState(() => todayDate());
  const [entries, setEntries] = useState<Entry[]>([
    { id: '1', start_time: '2026-09-07T08:00:00Z', end_time: '2026-09-07T09:30:00Z', comment: 'Homepage hero' },
    { id: '2', start_time: '2026-09-06T08:00:00Z', end_time: '2026-09-06T09:00:00Z', comment: 'Bugfix' },
  ]);
  const [start, setStart] = useState(() => todayAt(9));
  const [end, setEnd] = useState(() => todayAt(10));
  const [comment, setComment] = useState('');
  const [projects, setProjects] = useState<Option[]>([]);
  const [subprojectsByProject, setSubprojectsByProject] = useState<Record<string, Option[]>>({});
  const [projectId, setProjectId] = useState('');
  const [subprojectId, setSubprojectId] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [workTimeError, setWorkTimeError] = useState<string | null>(null);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantPinned, setAssistantPinned] = useState(false);
  const assistantCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const role = useMemo(() => (session ? defaultRole(session, currentOrgId) : 'user'), [session, currentOrgId]);
  // Entries are already fetched scoped to the selected period, so a daily breakdown reads naturally
  // whether that period is a single day, a week, or a month.
  const rows = useMemo(() => bucket(entries, 'daily'), [entries]);
  const total = rows.reduce((s, r) => s + r.minutes, 0);
  const orgId = currentOrgId;
  const subprojects = subprojectsByProject[projectId] ?? [];
  const draftSubprojects = draft ? (subprojectsByProject[draft.projectId] ?? []) : [];
  const canManage = role === 'manager' || role === 'admin';

  const NAV_GROUPS: Array<{ header: string; items: Array<{ key: Section; label: string; visible: boolean }> }> = [
    {
      header: 'My Work',
      items: [
        { key: 'time', label: 'Time Tracking', visible: true },
        { key: 'timesheet', label: 'Monthly Timesheet', visible: true },
      ],
    },
    {
      header: 'Organization',
      items: [
        { key: 'management', label: 'Management', visible: canManage },
        { key: 'hours', label: 'Team Hours', visible: canManage },
        { key: 'invitations', label: 'Invitations', visible: canManage },
        { key: 'approvals', label: 'Approvals', visible: canManage },
        { key: 'users', label: 'Users', visible: canManage },
      ],
    },
    {
      header: 'Administration',
      items: [
        { key: 'orgSettings', label: 'Organization Settings', visible: role === 'admin' },
        { key: 'audit', label: 'Audit Log', visible: role === 'admin' },
        { key: 'admin', label: 'Admin Settings', visible: role === 'admin' },
      ],
    },
  ];
  const NAV_ITEMS = NAV_GROUPS.flatMap((g) => g.items);

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

  /** Switch the active organization: role is derived automatically; back out of a section it can no longer see. */
  function switchOrg(newOrgId: string) {
    setCurrentOrgId(newOrgId);
    if (session) {
      const nextRole = defaultRole(session, newOrgId);
      const nextCanManage = nextRole === 'manager' || nextRole === 'admin';
      const stillVisible =
        section === 'time' || section === 'timesheet'
          ? true
          : section === 'admin' || section === 'audit' || section === 'orgSettings'
            ? nextRole === 'admin'
            : nextCanManage;
      if (!stillVisible) setSection('time');
    }
    if (isMobile) setMobileNavOpen(false);
  }

  /** Reveal the assistant flyout; cancels any pending auto-close from a previous hover-out. */
  function openAssistantPanel() {
    if (assistantCloseTimer.current) {
      clearTimeout(assistantCloseTimer.current);
      assistantCloseTimer.current = null;
    }
    setAssistantOpen(true);
  }

  /** Auto-close on hover-out, unless the user pinned the panel open by clicking its tab. */
  function scheduleCloseAssistantPanel() {
    if (assistantPinned) return;
    assistantCloseTimer.current = setTimeout(() => setAssistantOpen(false), 250);
  }

  /** Click the tab: pin the panel open (for typing without the mouse hovering it), or close it. */
  function toggleAssistantPin() {
    if (assistantOpen && assistantPinned) {
      setAssistantPinned(false);
      setAssistantOpen(false);
    } else {
      setAssistantPinned(true);
      openAssistantPanel();
    }
  }

  useEffect(() => () => {
    if (assistantCloseTimer.current) clearTimeout(assistantCloseTimer.current);
  }, []);

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
    const { from, to } = periodRange(periodType, periodAnchor);
    try {
      const res = await fetch(
        `${API}/organizations/${orgId}/work-time?userId=${session.userId}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
        { headers: await authHeaders() },
      );
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  // Entries are scoped to the selected period, so refetch whenever the org or the period changes.
  useEffect(() => {
    reloadEntries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, periodType, periodAnchor]);


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
    return (
      <Login
        onLoggedIn={(s) => {
          setSession(s);
          const firstOrg = s.memberships[0]?.organizationId ?? null;
          setCurrentOrgId(firstOrg);
          setSection('time');
        }}
      />
    );
  }

  async function addEntry() {
    setWorkTimeError(null);
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
    if (!orgId) {
      setEntries((p) => [...p, e]);
      return;
    }
    try {
      const res = await fetch(`${API}/organizations/${orgId}/work-time`, {
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
      const data = await res.json();
      if (data.ok === false) {
        setWorkTimeError(WORK_TIME_ERROR_MESSAGES[data.error] ?? `Could not add the entry (${data.error ?? 'unknown error'}).`);
        return;
      }
      setEntries((p) => [...p, e]);
      await reloadEntries();
    } catch {
      setEntries((p) => [...p, e]); // offline demo: API unreachable, keep the optimistic local entry
    }
  }

  async function saveDraft() {
    if (!draft) return;
    setWorkTimeError(null);
    const patch = {
      startTime: new Date(draft.start).toISOString(),
      endTime: new Date(draft.end).toISOString(),
      projectId: draft.projectId || null,
      subprojectId: draft.subprojectId || null,
      comment: draft.comment,
    };
    function applyLocally() {
      setEntries((prev) =>
        prev.map((e) =>
          e.id === draft!.id
            ? {
                ...e,
                start_time: patch.startTime,
                end_time: patch.endTime,
                project_id: patch.projectId,
                subproject_id: patch.subprojectId,
                comment: draft!.comment,
                project_name: projects.find((p) => p.id === draft!.projectId)?.name ?? null,
                subproject_name: draftSubprojects.find((s) => s.id === draft!.subprojectId)?.name ?? null,
              }
            : e,
        ),
      );
    }
    try {
      const res = await fetch(`${API}/work-time/${draft.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (data.ok === false) {
        setWorkTimeError(WORK_TIME_ERROR_MESSAGES[data.error] ?? `Could not save the change (${data.error ?? 'unknown error'}).`);
        return;
      }
      applyLocally();
      setDraft(null);
      await reloadEntries();
    } catch {
      applyLocally(); // offline demo: API unreachable, keep the optimistic local edit
      setDraft(null);
    }
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

  const navList = (
    <List>
      {NAV_GROUPS.map((group) => {
        const visibleItems = group.items.filter((n) => n.visible);
        if (visibleItems.length === 0) return null;
        return (
          <li key={group.header}>
            <ul style={{ padding: 0 }}>
              <ListSubheader
                disableSticky
                sx={{
                  bgcolor: 'action.hover',
                  color: 'text.secondary',
                  fontSize: '0.7rem',
                  fontWeight: 700,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  lineHeight: '28px',
                  borderRadius: 1,
                  mx: 1,
                  mt: 1,
                  mb: 0.5,
                }}
              >
                {group.header}
              </ListSubheader>
              {visibleItems.map((n) => (
                <ListItemButton
                  key={n.key}
                  selected={section === n.key}
                  onClick={() => {
                    setSection(n.key);
                    if (isMobile) setMobileNavOpen(false);
                  }}
                >
                  <ListItemText primary={n.label} />
                </ListItemButton>
              ))}
            </ul>
          </li>
        );
      })}
    </List>
  );

  return (
    <Box sx={{ display: 'flex' }}>
      <AppBar ref={setAppBarNode} position="fixed" sx={{ zIndex: (t) => t.zIndex.drawer + 1 }}>
        <Toolbar sx={{ gap: 1.5, flexWrap: 'wrap', py: 1 }}>
          {isMobile && (
            <IconButton color="inherit" edge="start" onClick={() => setMobileNavOpen(true)} aria-label="Open navigation">
              ☰
            </IconButton>
          )}
          <Typography variant="h6" sx={{ flexGrow: 1 }}>Worktime</Typography>

          {session.memberships.length > 1 ? (
            <FormControl size="small" sx={{ minWidth: 160 }}>
              <Select
                value={currentOrgId ?? ''}
                onChange={(e) => switchOrg(e.target.value)}
                sx={{ bgcolor: 'white', borderRadius: 1 }}
              >
                {session.memberships.map((m) => (
                  <MenuItem key={m.organizationId} value={m.organizationId}>{m.name}</MenuItem>
                ))}
              </Select>
            </FormControl>
          ) : (
            session.memberships[0] && (
              <Typography variant="body2" sx={{ opacity: 0.85, display: { xs: 'none', sm: 'block' } }}>
                {session.memberships[0].name}
              </Typography>
            )
          )}

          <Typography variant="body2" sx={{ display: { xs: 'none', sm: 'block' } }}>
            {session.displayName} ({session.email})
          </Typography>
          <Button color="inherit" size="small" onClick={logout}>Logout</Button>
        </Toolbar>
      </AppBar>

      <Drawer
        variant={isMobile ? 'temporary' : 'permanent'}
        open={isMobile ? mobileNavOpen : true}
        onClose={() => setMobileNavOpen(false)}
        ModalProps={{ keepMounted: true }}
        sx={{
          width: DRAWER_WIDTH,
          flexShrink: 0,
          '& .MuiDrawer-paper': {
            width: DRAWER_WIDTH,
            boxSizing: 'border-box',
            ...(isMobile ? { top: appBarHeight, height: `calc(100% - ${appBarHeight}px)` } : {}),
          },
        }}
      >
        {!isMobile && <Box sx={{ height: appBarHeight, flexShrink: 0 }} />}
        {navList}
      </Drawer>

      <Box component="main" sx={{ flexGrow: 1, minWidth: 0 }}>
        <Box sx={{ height: appBarHeight, flexShrink: 0 }} />
        <Container maxWidth={false} sx={{ py: 3, display: 'grid', gap: 2 }}>
          {section === 'time' && (
            <>
              {workTimeError && <Alert severity="error" onClose={() => setWorkTimeError(null)}>{workTimeError}</Alert>}
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
                <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
                  <Typography variant="h6">Overview — {periodLabel(periodType, periodAnchor)} ({Math.round(total)} min)</Typography>
                  <ToggleButtonGroup value={periodType} exclusive onChange={(_, v) => v && setPeriodType(v)} size="small">
                    <ToggleButton value="day">Day</ToggleButton>
                    <ToggleButton value="week">Week</ToggleButton>
                    <ToggleButton value="month">Month</ToggleButton>
                  </ToggleButtonGroup>
                </Box>
                <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mt: 1.5, flexWrap: 'wrap' }}>
                  <Button size="small" onClick={() => setPeriodAnchor((a) => shiftPeriod(periodType, a, -1))}>‹ Prev</Button>
                  <TextField
                    type={periodType === 'month' ? 'month' : 'date'}
                    size="small"
                    value={periodType === 'month' ? periodAnchor.slice(0, 7) : periodAnchor}
                    onChange={(e) => {
                      if (!e.target.value) return;
                      setPeriodAnchor(periodType === 'month' ? `${e.target.value}-01` : e.target.value);
                    }}
                  />
                  <Button size="small" onClick={() => setPeriodAnchor((a) => shiftPeriod(periodType, a, 1))}>Next ›</Button>
                  {periodAnchor !== todayDate() && (
                    <Button size="small" onClick={() => setPeriodAnchor(todayDate())}>Today</Button>
                  )}
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
            </>
          )}

          {section === 'timesheet' && orgId && (
            <Timesheet orgId={orgId} userId={session.userId} authHeaders={authHeaders} />
          )}

          {section === 'management' && canManage && orgId && (
            <Management
              session={session}
              orgId={orgId}
              role={role}
              authHeaders={authHeaders}
              onDataChanged={() => {
                reloadProjects();
                setSubprojectsByProject({});
                if (projectId) ensureSubprojects(projectId);
              }}
            />
          )}
          {section === 'hours' && canManage && orgId && (
            <TeamHours orgId={orgId} authHeaders={authHeaders} />
          )}
          {section === 'invitations' && canManage && orgId && (
            <Invitations orgId={orgId} authHeaders={authHeaders} />
          )}
          {section === 'approvals' && canManage && orgId && (
            <Approvals orgId={orgId} role={role} authHeaders={authHeaders} />
          )}
          {section === 'users' && canManage && orgId && (
            <Users orgId={orgId} authHeaders={authHeaders} />
          )}
          {section === 'audit' && role === 'admin' && orgId && (
            <AuditLog orgId={orgId} authHeaders={authHeaders} />
          )}
          {section === 'admin' && role === 'admin' && orgId && (
            <AdminSettings orgId={orgId} authHeaders={authHeaders} />
          )}
          {section === 'orgSettings' && role === 'admin' && orgId && (
            <OrganizationSettings orgId={orgId} authHeaders={authHeaders} />
          )}
        </Container>
      </Box>

      {orgId && (
        <Box
          onMouseEnter={openAssistantPanel}
          onMouseLeave={scheduleCloseAssistantPanel}
          sx={{
            position: 'fixed',
            top: appBarHeight,
            right: 0,
            bottom: 0,
            width: assistantOpen ? ASSISTANT_TAB_WIDTH + ASSISTANT_PANEL_WIDTH : ASSISTANT_TAB_WIDTH,
            maxWidth: '100vw',
            display: 'flex',
            overflow: 'hidden',
            transition: 'width 0.2s ease',
            zIndex: (t) => t.zIndex.drawer + 2,
            boxShadow: 3,
          }}
        >
          <Box
            onClick={toggleAssistantPin}
            role="button"
            aria-label={assistantOpen ? 'Close assistant' : 'Open assistant'}
            sx={{
              width: ASSISTANT_TAB_WIDTH,
              flexShrink: 0,
              bgcolor: 'primary.main',
              color: 'primary.contrastText',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              '&:hover': { bgcolor: 'primary.dark' },
            }}
          >
            <Typography
              variant="button"
              sx={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', letterSpacing: 1, whiteSpace: 'nowrap' }}
            >
              Assistant
            </Typography>
          </Box>
          <Box sx={{ width: ASSISTANT_PANEL_WIDTH, flexShrink: 0, height: '100%' }}>
            <Assistant orgId={orgId} authHeaders={authHeaders} />
          </Box>
        </Box>
      )}

      <Dialog open={!!draft} onClose={() => setDraft(null)} fullWidth maxWidth="sm">
        <DialogTitle>Edit entry</DialogTitle>
        {draft && (
          <DialogContent sx={{ display: 'grid', gap: 2, pt: 1 }}>
            {workTimeError && <Alert severity="error" onClose={() => setWorkTimeError(null)}>{workTimeError}</Alert>}
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
