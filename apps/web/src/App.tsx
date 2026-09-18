import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  AppBar,
  Box,
  Button,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  Drawer,
  FormControl,
  IconButton,
  LinearProgress,
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
import { useI18n, type Locale } from './i18n';
import Login, { clearSession, loadSession, saveSession, type Session } from './Login';
import { keycloak, refreshSsoToken, ssoLogout } from './auth';
import UserMenu from './UserMenu';
import NotificationBell from './NotificationBell';
import { useNotifications, type Notification } from './useNotifications';

const Management = lazy(() => import('./Management'));
const Invitations = lazy(() => import('./Invitations'));
const AdminSettings = lazy(() => import('./AdminSettings'));
const OrganizationSettings = lazy(() => import('./OrganizationSettings'));
const Timesheet = lazy(() => import('./Timesheet'));
const WorkTime = lazy(() => import('./WorkTime'));
const Absences = lazy(() => import('./Absences'));
const Approvals = lazy(() => import('./Approvals'));
const Expenses = lazy(() => import('./Expenses'));
const ExpenseReports = lazy(() => import('./ExpenseReports'));
const ExpenseProcessing = lazy(() => import('./ExpenseProcessing'));
const Assistant = lazy(() => import('./Assistant'));
const TeamHours = lazy(() => import('./TeamHours'));
const AuditLog = lazy(() => import('./AuditLog'));
const Users = lazy(() => import('./Users'));

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';
const DRAWER_WIDTH = 220;

type Section = 'time' | 'timesheet' | 'workTime' | 'absences' | 'expenses' | 'expenseReports' | 'management' | 'managementProjects' | 'hours' | 'invitations' | 'approvals' | 'users' | 'audit' | 'admin' | 'orgSettings' | 'expenseProcessing';

const ASSISTANT_TAB_WIDTH = 40;
const ASSISTANT_PANEL_WIDTH = 380;
const ASSISTANT_TAB_HEIGHT = 40;
const ASSISTANT_PANEL_HEIGHT_MOBILE = '50vh';

const PROJECT_TIME_ERROR_MESSAGES: Record<string, string> = {
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
  date: string;
  startTime: string;
  durationMinutes: number;
  projectId: string;
  subprojectId: string;
  comment: string;
}

/** When "use project time minutes ranges" is off, every entry is recorded as starting at this local time. */
const DEFAULT_PROJECT_TIME_START = '08:00';

/** An existing entry that overlaps one the user is about to save. */
interface OverlapEntry {
  id: string;
  start_time: string;
  end_time: string;
  comment: string | null;
}

/** A save blocked on the user acknowledging it overlaps an existing entry; resolved by resubmitting with the flag. */
interface OverlapConfirm {
  kind: 'add' | 'draft';
  overlaps: OverlapEntry[];
}

/** The caller's role is scoped to whichever organization is currently active — not aggregated across all of them. */
function defaultRole(session: Session, orgId: string | null): 'admin' | 'manager' | 'user' {
  const membership = session.memberships.find((m) => m.organizationId === orgId);
  if (membership?.role === 'owner' || membership?.role === 'admin') return 'admin';
  if (membership?.role === 'manager') return 'manager';
  return 'user';
}

/** ISO instant -> local `{ date: 'YYYY-MM-DD', time: 'HH:mm' }`, the shape the date/time inputs want. */
function splitLocal(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** Whole minutes between two ISO instants. */
function minutesBetween(startIso: string, endIso: string): number {
  return Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000);
}

/** Combine a local `YYYY-MM-DD` date and `HH:mm` time into an ISO instant. */
function toIso(date: string, time: string): string {
  return new Date(`${date}T${time}`).toISOString();
}

/** `startIso` shifted forward by the given number of minutes, as an ISO instant. */
function addMinutesIso(startIso: string, minutes: number): string {
  return new Date(new Date(startIso).getTime() + minutes * 60000).toISOString();
}

export default function App() {
  const { t, locale, setLocale } = useI18n();
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
  const [adminSession, setAdminSession] = useState<Session | null>(null);
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
  const [entryDate, setEntryDate] = useState(() => todayDate());
  const [entryStartTime, setEntryStartTime] = useState(DEFAULT_PROJECT_TIME_START);
  const [entryDurationMinutes, setEntryDurationMinutes] = useState(60);
  const [comment, setComment] = useState('');
  const [projects, setProjects] = useState<Option[]>([]);
  const [subprojectsByProject, setSubprojectsByProject] = useState<Record<string, Option[]>>({});
  const [projectId, setProjectId] = useState('');
  const [subprojectId, setSubprojectId] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [projectTimeError, setProjectTimeError] = useState<string | null>(null);
  const [overlapConfirm, setOverlapConfirm] = useState<OverlapConfirm | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{ title: string; message: string; onConfirm: () => void | Promise<void> } | null>(null);
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
  const useProjectTimeRanges = session?.settings?.useProjectTimeMinutesRanges === true;
  // `role` collapses a membership to a single display role, which hides a billing_admin-only
  // membership — check the full roles list directly for the finance-processing nav entry.
  const isBillingAdmin = session?.memberships.find((m) => m.organizationId === orgId)?.roles.includes('billing_admin') ?? false;

  const NAV_GROUPS: Array<{ header: string; items: Array<{ id: string; section: Section; label: string; visible: boolean; indent?: boolean; dividerBefore?: boolean }> }> = [
    {
      header: t('nav.myWork'),
      items: [
        { id: 'time', section: 'time', label: t('nav.timeTracking'), visible: true },
        { id: 'timesheet', section: 'timesheet', label: t('nav.monthlyTimesheet'), visible: true },
        { id: 'workTime', section: 'workTime', label: t('nav.workTime'), visible: true },
        { id: 'absences', section: 'absences', label: t('nav.absences'), visible: true },
        { id: 'expenses', section: 'expenses', label: t('nav.expenses'), visible: true, dividerBefore: true },
        { id: 'expenseReports', section: 'expenseReports', label: t('nav.expenseReports'), visible: true },
      ],
    },
    {
      header: t('nav.organization'),
      items: [
        { id: 'hours', section: 'hours', label: t('nav.teamHours'), visible: canManage },
        { id: 'approvals', section: 'approvals', label: t('nav.approvals'), visible: canManage },
        { id: 'users', section: 'users', label: t('nav.users'), visible: canManage },
        { id: 'invitations', section: 'invitations', label: t('nav.invitations'), visible: canManage, indent: true },
        { id: 'management', section: 'management', label: t('nav.management'), visible: canManage },
        { id: 'management-teams', section: 'management', label: t('nav.teams'), visible: canManage, indent: true },
        { id: 'management-projects', section: 'managementProjects', label: t('nav.managementProjects'), visible: canManage, indent: true },
      ],
    },
    {
      header: t('nav.administration'),
      items: [
        { id: 'orgSettings', section: 'orgSettings', label: t('nav.organizationSettings'), visible: role === 'admin' },
        { id: 'audit', section: 'audit', label: t('nav.auditLog'), visible: role === 'admin' },
        { id: 'expenseProcessing', section: 'expenseProcessing', label: t('nav.expenseProcessing'), visible: role === 'admin' || isBillingAdmin },
        { id: 'admin', section: 'admin', label: t('nav.adminSettings'), visible: role === 'admin' },
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

  const { items: notifications, unreadCount, live: liveNotification, clearLive, markRead, markAllRead } = useNotifications(session, authHeaders);

  /** No router — notifications navigate by flipping `section`, same as the nav drawer. */
  function navigateToNotification(n: Notification) {
    if (n.type === 'workflow.assigned') {
      setSection('approvals');
      return;
    }
    if (n.source_table === 'expense_reports') setSection('expenseReports');
    else if (n.source_table === 'timesheet_periods') setSection('timesheet');
  }

  /** Switch the active organization: role is derived automatically; back out of a section it can no longer see. */
  function switchOrg(newOrgId: string) {
    setCurrentOrgId(newOrgId);
    if (session) {
      const nextRole = defaultRole(session, newOrgId);
      const nextCanManage = nextRole === 'manager' || nextRole === 'admin';
      const nextIsBillingAdmin = session.memberships.find((m) => m.organizationId === newOrgId)?.roles.includes('billing_admin') ?? false;
      const stillVisible =
        section === 'time' || section === 'timesheet' || section === 'workTime' || section === 'absences' || section === 'expenses' || section === 'expenseReports'
          ? true
          : section === 'expenseProcessing'
            ? nextRole === 'admin' || nextIsBillingAdmin
            : section === 'admin' || section === 'audit' || section === 'orgSettings'
              ? nextRole === 'admin'
              : nextCanManage; // covers management, managementProjects, hours, invitations, approvals, users
      if (!stillVisible) setSection('time');
    }
    if (isMobile) setMobileNavOpen(false);
  }

  function switchUserSession(nextSession: Session, organizationId: string) {
    if (session && !adminSession) setAdminSession(session);
    setSession(nextSession);
    saveSession(nextSession);
    setCurrentOrgId(organizationId);
    setSection('time');
  }

  function returnToAdmin() {
    if (!adminSession) return;
    setSession(adminSession);
    saveSession(adminSession);
    setCurrentOrgId(adminSession.memberships[0]?.organizationId ?? null);
    setAdminSession(null);
    setSection('time');
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

  /**
   * Always re-fetches (no "already cached" skip) — a project's subproject list can change
   * elsewhere (Management) at any time, and an empty result is a valid, truthy `[]` that a
   * cache-presence check can't tell apart from "not fetched yet". Both the add form and the
   * edit dialog read this, re-run whenever their project selection changes.
   */
  async function loadSubprojects(pid: string) {
    if (!pid) return;
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
        `${API}/organizations/${orgId}/project-time?userId=${session.userId}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
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
    loadSubprojects(projectId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => {
    if (draft) loadSubprojects(draft.projectId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft?.projectId]);

  // The login/register response doesn't carry the user's saved language/settings preferences — fetch them once per session.
  useEffect(() => {
    if (!session || (session.locale && session.settings)) return;
    (async () => {
      try {
        const res = await fetch(`${API}/users/me`, { headers: await authHeaders() });
        const data = await res.json();
        if (data.ok) {
          setSession((prev) => {
            if (!prev) return prev;
            const updated = { ...prev, locale: data.locale ?? prev.locale, settings: data.settings ?? prev.settings ?? {} };
            saveSession(updated);
            return updated;
          });
        }
      } catch { /* offline demo */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.userId]);

  // Once the account's saved language preference is known, it takes over from whatever the UI guessed (browser
  // language, or a leftover locale from a previous account on this device).
  useEffect(() => {
    if (session?.locale && session.locale !== locale) setLocale(session.locale as Locale);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.locale]);

  if (!session) {
    return (
      <Login
        onLoggedIn={(s) => {
          setSession(s);
          setAdminSession(null);
          saveSession(s);
          const firstOrg = s.memberships[0]?.organizationId ?? null;
          setCurrentOrgId(firstOrg);
          setSection('time');
        }}
      />
    );
  }

  async function addEntry(acknowledgeOverlap = false) {
    setProjectTimeError(null);
    const startTime = toIso(entryDate, useProjectTimeRanges ? entryStartTime : DEFAULT_PROJECT_TIME_START);
    const endTime = addMinutesIso(startTime, entryDurationMinutes);
    const e: Entry = {
      id: String(Date.now()),
      start_time: startTime,
      end_time: endTime,
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
      const res = await fetch(`${API}/organizations/${orgId}/project-time`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({
          startTime: e.start_time,
          endTime: e.end_time,
          projectId: projectId || undefined,
          subprojectId: subprojectId || undefined,
          comment,
          acknowledgeOverlap: acknowledgeOverlap || undefined,
        }),
      });
      const data = await res.json();
      if (data.ok === false) {
        if (data.error === 'overlapping-entry-confirm') {
          setOverlapConfirm({ kind: 'add', overlaps: data.overlaps ?? [] });
          return;
        }
        setProjectTimeError(PROJECT_TIME_ERROR_MESSAGES[data.error] ?? `Could not add the entry (${data.error ?? 'unknown error'}).`);
        return;
      }
      setOverlapConfirm(null);
      setEntries((p) => [...p, e]);
      await reloadEntries();
    } catch {
      setEntries((p) => [...p, e]); // offline demo: API unreachable, keep the optimistic local entry
    }
  }

  async function saveDraft(acknowledgeOverlap = false) {
    if (!draft) return;
    setProjectTimeError(null);
    const draftStartTime = toIso(draft.date, useProjectTimeRanges ? draft.startTime : DEFAULT_PROJECT_TIME_START);
    const patch = {
      startTime: draftStartTime,
      endTime: addMinutesIso(draftStartTime, draft.durationMinutes),
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
      const res = await fetch(`${API}/project-time/${draft.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ ...patch, acknowledgeOverlap: acknowledgeOverlap || undefined }),
      });
      const data = await res.json();
      if (data.ok === false) {
        if (data.error === 'overlapping-entry-confirm') {
          setOverlapConfirm({ kind: 'draft', overlaps: data.overlaps ?? [] });
          return;
        }
        setProjectTimeError(PROJECT_TIME_ERROR_MESSAGES[data.error] ?? `Could not save the change (${data.error ?? 'unknown error'}).`);
        return;
      }
      setOverlapConfirm(null);
      applyLocally();
      setDraft(null);
      await reloadEntries();
    } catch {
      applyLocally(); // offline demo: API unreachable, keep the optimistic local edit
      setDraft(null);
    }
  }

  /** Dismiss the edit dialog, and any overlap warning it triggered. */
  function closeDraft() {
    setDraft(null);
    setOverlapConfirm((prev) => (prev?.kind === 'draft' ? null : prev));
  }

  async function removeEntry(id: string) {
    setProjectTimeError(null);
    try {
      const res = await fetch(`${API}/project-time/${id}`, {
        method: 'DELETE',
        headers: await authHeaders(),
      });
      const data = await res.json();
      if (data.ok === false) {
        setProjectTimeError(PROJECT_TIME_ERROR_MESSAGES[data.error] ?? `Could not remove the entry (${data.error ?? 'unknown error'}).`);
        return;
      }
      setEntries((prev) => prev.filter((e) => e.id !== id));
      await reloadEntries();
    } catch {
      setEntries((prev) => prev.filter((e) => e.id !== id)); // offline demo: API unreachable, keep the optimistic local removal
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

  const addDurationInvalid = !(entryDurationMinutes > 0);
  const draftDurationInvalid = !!draft && !(draft.durationMinutes > 0);

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
                  bgcolor: 'transparent',
                  color: 'text.secondary',
                  fontSize: '0.7rem',
                  fontWeight: 700,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  lineHeight: '28px',
                  mx: 1.5,
                  mt: 2,
                  mb: 0.5,
                }}
              >
                {group.header}
              </ListSubheader>
              {visibleItems.map((n) => (
                <li key={n.id} style={{ listStyle: 'none' }}>
                  {n.dividerBefore && <Divider sx={{ mx: 1, my: 0.5 }} />}
                  <ListItemButton
                    selected={section === n.section}
                    onClick={() => {
                      setSection(n.section);
                      if (isMobile) setMobileNavOpen(false);
                    }}
                    sx={n.indent ? { pl: 4 } : undefined}
                  >
                    <ListItemText
                      primary={n.label}
                      slotProps={n.indent ? { primary: { fontSize: '0.9rem' } } : undefined}
                    />
                  </ListItemButton>
                </li>
              ))}
            </ul>
          </li>
        );
      })}
    </List>
  );

  // Reserve room for the fixed-position assistant flyout so the main content actually resizes around
  // it, rather than being overlaid: a real flex sibling (desktop, to its right) or a real block spacer
  // (mobile, below the page content) matching its current width/height, since a `position: fixed`
  // element never participates in layout on its own.
  const assistantReservedWidth = !isMobile && orgId ? (assistantOpen ? ASSISTANT_TAB_WIDTH + ASSISTANT_PANEL_WIDTH : ASSISTANT_TAB_WIDTH) : 0;
  const assistantReservedHeight =
    isMobile && orgId ? (assistantOpen ? `calc(${ASSISTANT_TAB_HEIGHT}px + ${ASSISTANT_PANEL_HEIGHT_MOBILE})` : `${ASSISTANT_TAB_HEIGHT}px`) : '0px';

  return (
    <Box sx={{ display: 'flex' }}>
      <AppBar ref={setAppBarNode} position="fixed" sx={{ zIndex: (t) => t.zIndex.drawer + 1 }}>
        <Toolbar sx={{ gap: 1.5, flexWrap: 'wrap', py: 1 }}>
          {isMobile && (
            <IconButton color="inherit" edge="start" onClick={() => setMobileNavOpen(true)} aria-label="Open navigation">
              ☰
            </IconButton>
          )}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, flexGrow: 1 }}>
            <Box
              sx={{
                width: 28,
                height: 28,
                borderRadius: '8px',
                display: { xs: 'none', sm: 'flex' },
                alignItems: 'center',
                justifyContent: 'center',
                bgcolor: 'rgba(255,255,255,0.18)',
                fontWeight: 700,
                fontSize: '0.9rem',
              }}
            >
              W
            </Box>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>{t('appbar.title')}</Typography>
          </Box>

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

          <NotificationBell
            items={notifications}
            unreadCount={unreadCount}
            live={liveNotification}
            clearLive={clearLive}
            markRead={markRead}
            markAllRead={markAllRead}
            onItemClick={navigateToNotification}
          />

          <UserMenu
            session={session}
            authHeaders={authHeaders}
            currentOrgId={currentOrgId}
            canSwitchUser={role === 'admin' && !adminSession}
            adminSession={adminSession}
            onSwitchSession={switchUserSession}
            onReturnToAdmin={returnToAdmin}
            onLogout={logout}
            onLocaleChange={(newLocale) => {
              const updated = { ...session, locale: newLocale };
              setSession(updated);
              saveSession(updated);
            }}
            onSettingsChange={(newSettings) => {
              const updated = { ...session, settings: newSettings };
              setSession(updated);
              saveSession(updated);
            }}
          />
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

      <Box component="main" sx={{ flexGrow: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <Box sx={{ height: appBarHeight, flexShrink: 0 }} />
        <Container
          maxWidth={false}
          sx={{
            py: 3,
            display: 'grid',
            gap: 2,
            overflowX: 'auto',
          }}
        >
          {section === 'time' && (
            <>
              {projectTimeError && <Alert severity="error" onClose={() => setProjectTimeError(null)}>{projectTimeError}</Alert>}
              <Paper sx={{ p: 2 }}>
                <Typography variant="h6">{t('time.logProjectTime')}</Typography>
                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 1 }}>
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
                    helperText={addDurationInvalid ? t('time.durationMustBePositive') : ' '}
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
                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 1, alignItems: 'flex-start' }}>
                  <TextField
                    label={t('time.comment')}
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    size="small"
                    multiline
                    minRows={2}
                    sx={{ flex: 1, minWidth: 260, '& textarea': { resize: 'vertical' } }}
                  />
                  <Button variant="contained" onClick={() => addEntry()} disabled={addDurationInvalid}>{t('time.add')}</Button>
                </Box>
              </Paper>
              <Paper sx={{ p: 2 }}>
                <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
                  <Typography variant="h6">{t('time.overview')} — {periodLabel(periodType, periodAnchor, locale)} ({Math.round(total)} min)</Typography>
                  <ToggleButtonGroup value={periodType} exclusive onChange={(_, v) => v && setPeriodType(v)} size="small">
                    <ToggleButton value="day">{t('time.day')}</ToggleButton>
                    <ToggleButton value="week">{t('time.week')}</ToggleButton>
                    <ToggleButton value="month">{t('time.month')}</ToggleButton>
                  </ToggleButtonGroup>
                </Box>
                <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mt: 1.5, flexWrap: 'wrap' }}>
                  <Button size="small" onClick={() => setPeriodAnchor((a) => shiftPeriod(periodType, a, -1))}>{t('time.prev')}</Button>
                  <TextField
                    type={periodType === 'month' ? 'month' : 'date'}
                    size="small"
                    value={periodType === 'month' ? periodAnchor.slice(0, 7) : periodAnchor}
                    onChange={(e) => {
                      if (!e.target.value) return;
                      setPeriodAnchor(periodType === 'month' ? `${e.target.value}-01` : e.target.value);
                    }}
                  />
                  <Button size="small" onClick={() => setPeriodAnchor((a) => shiftPeriod(periodType, a, 1))}>{t('time.next')}</Button>
                  {periodAnchor !== todayDate() && (
                    <Button size="small" onClick={() => setPeriodAnchor(todayDate())}>{t('time.today')}</Button>
                  )}
                </Box>
                <Table size="small" sx={{ mt: 1 }}>
                  <TableHead><TableRow><TableCell>{t('time.period')}</TableCell><TableCell>{t('time.minutes')}</TableCell></TableRow></TableHead>
                  <TableBody>
                    {rows.map((r) => (<TableRow key={r.label}><TableCell>{r.label}</TableCell><TableCell>{Math.round(r.minutes)}</TableCell></TableRow>))}
                  </TableBody>
                </Table>
                <Typography variant="subtitle1" sx={{ mt: 3 }}>{t('time.entries')}</Typography>
                <Table size="small" sx={{ mt: 1 }}>
                  <TableHead>
                    <TableRow>
                      <TableCell>{t('time.date')}</TableCell>
                      <TableCell>{t('time.time')}</TableCell>
                      <TableCell align="right">{t('time.minutes')}</TableCell>
                      <TableCell>{t('time.project')}</TableCell>
                      <TableCell>{t('time.subproject')}</TableCell>
                      <TableCell>{t('time.comment')}</TableCell>
                      <TableCell align="right" />
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {entries.map((e) => (
                      <TableRow key={e.id} hover>
                        <TableCell>{new Date(e.start_time).toLocaleDateString(locale)}</TableCell>
                        <TableCell>{timeOf(e.start_time)} – {timeOf(e.end_time)}</TableCell>
                        <TableCell align="right">{Math.round(minutes(e))}</TableCell>
                        <TableCell>{e.project_name ?? '—'}</TableCell>
                        <TableCell>{e.subproject_name ?? '—'}</TableCell>
                        <TableCell>{e.comment}</TableCell>
                        <TableCell align="right">
                          <Button
                            size="small"
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
                            {t('time.edit')}
                          </Button>
                          <Button
                            size="small"
                            color="error"
                            onClick={() =>
                              setConfirmDialog({
                                title: t('time.removeEntry'),
                                message: t('time.removeEntryConfirm'),
                                onConfirm: () => removeEntry(e.id),
                              })
                            }
                          >
                            {t('time.remove')}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {entries.length === 0 && (
                      <TableRow><TableCell colSpan={7}>{t('time.noEntries')}</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </Paper>
            </>
          )}

          <Suspense fallback={<LinearProgress sx={{ my: 2 }} />}>
            {section === 'timesheet' && orgId && (
              <Timesheet orgId={orgId} userId={session.userId} authHeaders={authHeaders} />
            )}
            {section === 'workTime' && orgId && (
              <WorkTime orgId={orgId} userId={session.userId} authHeaders={authHeaders} />
            )}
            {section === 'absences' && orgId && (
              <Absences orgId={orgId} userId={session.userId} authHeaders={authHeaders} />
            )}
            {section === 'expenses' && orgId && (
              <Expenses orgId={orgId} userId={session.userId} authHeaders={authHeaders} />
            )}
            {section === 'expenseReports' && orgId && (
              <ExpenseReports orgId={orgId} userId={session.userId} authHeaders={authHeaders} />
            )}

            {(section === 'management' || section === 'managementProjects') && canManage && orgId && (
              <Management
                session={session}
                orgId={orgId}
                role={role}
                authHeaders={authHeaders}
                tab={section === 'managementProjects' ? 'projects' : 'teams'}
                onTabChange={(tab) => setSection(tab === 'projects' ? 'managementProjects' : 'management')}
                onDataChanged={() => {
                  reloadProjects();
                  setSubprojectsByProject({});
                  if (projectId) loadSubprojects(projectId);
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
              <Users orgId={orgId} role={role} authHeaders={authHeaders} />
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
            {section === 'expenseProcessing' && (role === 'admin' || isBillingAdmin) && orgId && (
              <ExpenseProcessing orgId={orgId} authHeaders={authHeaders} />
            )}
          </Suspense>
        </Container>
        {isMobile && orgId && (
          <Box sx={{ height: assistantReservedHeight, flexShrink: 0, transition: 'height 0.2s ease' }} />
        )}
      </Box>

      {!isMobile && orgId && (
        <Box sx={{ width: assistantReservedWidth, flexShrink: 0, transition: 'width 0.2s ease' }} />
      )}

      {orgId && (isMobile ? (
        // Mobile: a bottom-docked bar instead of a right-edge flyout, so it never eats the width
        // tables/columns need on a narrow screen. Tap to pin; there's no hover to auto-open here.
        <Box
          sx={{
            position: 'fixed',
            left: 0,
            right: 0,
            bottom: 0,
            height: assistantOpen ? `calc(${ASSISTANT_TAB_HEIGHT}px + ${ASSISTANT_PANEL_HEIGHT_MOBILE})` : ASSISTANT_TAB_HEIGHT,
            maxHeight: '85vh',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            transition: 'height 0.2s ease',
            zIndex: (t) => t.zIndex.drawer + 2,
            boxShadow: '0 -1px 3px rgba(16,24,40,0.08), 0 -4px 12px rgba(16,24,40,0.10)',
          }}
        >
          <Box
            onClick={toggleAssistantPin}
            role="button"
            aria-label={assistantPinned ? 'Unpin assistant' : 'Pin assistant open'}
            title={assistantPinned ? 'Unpin assistant' : 'Tap to keep the assistant open'}
            sx={{
              height: ASSISTANT_TAB_HEIGHT,
              flexShrink: 0,
              backgroundImage: (t) =>
                `linear-gradient(135deg, ${t.palette.primary.main} 0%, ${t.palette.primary.dark} 100%)`,
              filter: assistantPinned ? 'brightness(0.85)' : 'none',
              color: 'primary.contrastText',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 1,
              cursor: 'pointer',
              '&:hover': { filter: 'brightness(0.85)' },
            }}
          >
            <Typography
              aria-hidden
              sx={{
                fontSize: '1.1rem',
                lineHeight: 1,
                transform: assistantPinned ? 'rotate(45deg)' : 'rotate(0deg)',
                transition: 'transform 0.15s ease',
              }}
            >
              📌
            </Typography>
            <Typography variant="button" sx={{ letterSpacing: 1 }}>Assistant</Typography>
          </Box>
          <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
            <Suspense fallback={<LinearProgress sx={{ m: 2 }} />}>
              <Assistant orgId={orgId} authHeaders={authHeaders} />
            </Suspense>
          </Box>
        </Box>
      ) : (
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
            boxShadow: '0 1px 3px rgba(16,24,40,0.08), 0 4px 12px rgba(16,24,40,0.10)',
          }}
        >
          <Box
            onClick={toggleAssistantPin}
            role="button"
            aria-label={assistantPinned ? 'Unpin assistant' : 'Pin assistant open'}
            title={assistantPinned ? 'Unpin assistant' : 'Click to keep the assistant open'}
            sx={{
              width: ASSISTANT_TAB_WIDTH,
              flexShrink: 0,
              backgroundImage: (t) =>
                `linear-gradient(135deg, ${t.palette.primary.main} 0%, ${t.palette.primary.dark} 100%)`,
              filter: assistantPinned ? 'brightness(0.85)' : 'none',
              color: 'primary.contrastText',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 0.75,
              cursor: 'pointer',
              '&:hover': { filter: 'brightness(0.85)' },
            }}
          >
            <Typography
              aria-hidden
              sx={{
                fontSize: '1.1rem',
                lineHeight: 1,
                transform: assistantPinned ? 'rotate(45deg)' : 'rotate(0deg)',
                transition: 'transform 0.15s ease',
              }}
            >
              📌
            </Typography>
            <Typography
              variant="button"
              sx={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', letterSpacing: 1, whiteSpace: 'nowrap' }}
            >
              Assistant
            </Typography>
          </Box>
          <Box sx={{ width: ASSISTANT_PANEL_WIDTH, flexShrink: 0, height: '100%' }}>
            <Suspense fallback={<LinearProgress sx={{ m: 2 }} />}>
              <Assistant orgId={orgId} authHeaders={authHeaders} />
            </Suspense>
          </Box>
        </Box>
      ))}

      <Dialog open={!!draft} onClose={closeDraft} fullWidth maxWidth="sm">
        <DialogTitle>Edit entry</DialogTitle>
        {draft && (
          <DialogContent sx={{ display: 'grid', gap: 2, pt: 1 }}>
            {projectTimeError && <Alert severity="error" onClose={() => setProjectTimeError(null)}>{projectTimeError}</Alert>}
            <TextField label="Date" type="date" value={draft.date} onChange={(e) => e.target.value && setDraft({ ...draft, date: e.target.value })} size="small" sx={{ mt: 1 }} />
            {useProjectTimeRanges && (
              <TextField
                label="Start time"
                type="time"
                value={draft.startTime}
                onChange={(e) => e.target.value && setDraft({ ...draft, startTime: e.target.value })}
                size="small"
                slotProps={{ htmlInput: { step: 300 } }}
              />
            )}
            <TextField
              label="Duration (minutes)"
              type="number"
              value={draft.durationMinutes}
              onChange={(e) => setDraft({ ...draft, durationMinutes: Number(e.target.value) })}
              size="small"
              slotProps={{ htmlInput: { step: 5, min: 5 } }}
              error={draftDurationInvalid}
              helperText={draftDurationInvalid ? 'Duration must be greater than zero.' : ' '}
            />
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
            <TextField
              label="Comment"
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
          <Button onClick={closeDraft}>Cancel</Button>
          <Button variant="contained" onClick={() => saveDraft()} disabled={draftDurationInvalid}>Save</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!overlapConfirm} onClose={() => setOverlapConfirm(null)} fullWidth maxWidth="xs">
        <DialogTitle>Overlapping entry</DialogTitle>
        <DialogContent sx={{ display: 'grid', gap: 1, pt: 1 }}>
          <Typography variant="body2">
            This is an additional booking — it overlaps {overlapConfirm && overlapConfirm.overlaps.length > 1 ? 'these existing entries' : 'an existing entry'} on that day:
          </Typography>
          {overlapConfirm?.overlaps.map((o) => (
            <Typography key={o.id} variant="body2" color="text.secondary">
              {timeOf(o.start_time)} – {timeOf(o.end_time)}{o.comment ? ` (${o.comment})` : ''}
            </Typography>
          ))}
          <Typography variant="body2">Add it anyway?</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOverlapConfirm(null)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={() => {
              if (overlapConfirm?.kind === 'add') addEntry(true);
              else if (overlapConfirm?.kind === 'draft') saveDraft(true);
            }}
          >
            Add anyway
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!confirmDialog} onClose={() => setConfirmDialog(null)}>
        <DialogTitle>{confirmDialog?.title ?? 'Confirm'}</DialogTitle>
        <DialogContent>
          <DialogContentText>{confirmDialog?.message}</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDialog(null)}>Cancel</Button>
          <Button
            color="error"
            variant="contained"
            onClick={async () => {
              const action = confirmDialog?.onConfirm;
              setConfirmDialog(null);
              if (action) await action();
            }}
          >
            {t('time.remove')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
