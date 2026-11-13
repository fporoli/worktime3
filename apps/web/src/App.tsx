import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AppBar,
  Box,
  ButtonBase,
  Chip,
  Container,
  Divider,
  Drawer,
  FormControl,
  IconButton,
  LinearProgress,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  ListSubheader,
  MenuItem,
  Select,
  Toolbar,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { useI18n, type Locale } from './i18n';
import { useBranding } from './theme';
import Login, { clearSession, loadSession, saveSession, type Session } from './Login';
import { keycloak, refreshSsoToken, ssoLogout } from './auth';
import UserMenu from './UserMenu';
import { DesignModeNotice, DesignModeProvider, useDesignAccess } from './designMode';
import NotificationBell from './NotificationBell';
import { useNotifications, type Notification } from './useNotifications';
import { formatDurationMinutes } from './localeFormat';
import { grantedScopes, holdsAny, holdsBeyondOwn, isBasicDataReviewer, seesOthersBasicData } from '@worktime3/shared/permissions';
import {
  AccountBalanceWalletIcon,
  AutoAwesomeIcon,
  BeachAccessIcon,
  CalendarMonthIcon,
  CheckCircleIcon,
  DashboardIcon,
  FolderCopyIcon,
  GroupIcon,
  HistoryIcon,
  MailIcon,
  MenuIcon,
  PaymentsIcon,
  PeopleIcon,
  PersonIcon,
  PushPinIcon,
  ReceiptLongIcon,
  ScheduleIcon,
  SettingsIcon,
  TimerIcon,
  TuneIcon,
  WorkspacesIcon,
} from './icons';

const Home = lazy(() => import('./Home'));
const MyData = lazy(() => import('./MyData'));
const ProjectTime = lazy(() => import('./ProjectTime'));
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
const ProjectTimesheet = lazy(() => import('./ProjectTimesheet'));
const BalanceReport = lazy(() => import('./BalanceReport'));
const AuditLog = lazy(() => import('./AuditLog'));
const Users = lazy(() => import('./Users'));

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';
const DRAWER_WIDTH = 232;

type Section =
  | 'home'
  | 'myData'
  | 'time'
  | 'projectTimesheet'
  | 'timesheet'
  | 'workTime'
  | 'absences'
  | 'expenses'
  | 'expenseReports'
  | 'management'
  | 'managementProjects'
  | 'hours'
  | 'balances'
  | 'invitations'
  | 'approvals'
  | 'users'
  | 'audit'
  | 'admin'
  | 'orgSettings'
  | 'expenseProcessing';

const SECTION_TO_HASH: Record<Section, string> = {
  home: '#/home',
  myData: '#/my-data',
  time: '#/time',
  projectTimesheet: '#/project-timesheet',
  timesheet: '#/timesheet',
  workTime: '#/work-time',
  absences: '#/absences',
  expenses: '#/expenses',
  expenseReports: '#/expense-reports',
  hours: '#/team-hours',
  balances: '#/balances',
  approvals: '#/approvals',
  users: '#/users',
  invitations: '#/invitations',
  management: '#/teams',
  managementProjects: '#/projects',
  orgSettings: '#/org-settings',
  audit: '#/audit',
  expenseProcessing: '#/expense-processing',
  admin: '#/admin',
};

const HASH_TO_SECTION = Object.fromEntries(
  Object.entries(SECTION_TO_HASH).map(([sec, hash]) => [hash, sec as Section]),
) as Record<string, Section>;

function sectionFromHash(): Section {
  if (typeof window === 'undefined') return 'home';
  const clean = window.location.hash.split('?')[0];
  return HASH_TO_SECTION[clean] ?? 'home';
}

const ASSISTANT_TAB_WIDTH = 40;
const ASSISTANT_PANEL_WIDTH = 380;
const ASSISTANT_TAB_HEIGHT = 40;
const ASSISTANT_PANEL_HEIGHT_MOBILE = '50vh';

interface RoleFlags {
  isAdmin: boolean;
  isManager: boolean;
  isHr: boolean;
  isBillingAdmin: boolean;
  canManage: boolean;
  canSeeUsers: boolean;
  canProcessExpenses: boolean;
  displayRole: 'admin' | 'manager' | 'user';
}

function resolveRoleFlags(session: Session | null, orgId: string | null): RoleFlags {
  const membership = session?.memberships.find((m) => m.organizationId === orgId);
  const roles = membership?.roles ?? (membership?.role ? [membership.role] : []);
  const isAdmin = roles.includes('owner') || roles.includes('admin') || membership?.role === 'owner' || membership?.role === 'admin';
  const isManager = roles.includes('manager') || membership?.role === 'manager';
  const isHr = roles.includes('hr');
  const isBillingAdmin = roles.includes('billing_admin');
  const canManage = isAdmin || isManager;
  return {
    isAdmin,
    isManager,
    isHr,
    isBillingAdmin,
    canManage,
    canSeeUsers: canManage || isHr,
    canProcessExpenses: isAdmin || isBillingAdmin,
    displayRole: isAdmin ? 'admin' : isManager ? 'manager' : 'user',
  };
}

/** The permission object (packages/shared/src/permissions.ts) behind each page; `home` is always allowed. */
const SECTION_NAV_OBJECT: Record<Exclude<Section, 'home'>, string> = {
  myData: 'nav.myData',
  time: 'nav.time',
  projectTimesheet: 'nav.projectTimesheet',
  timesheet: 'nav.timesheet',
  workTime: 'nav.workTime',
  absences: 'nav.absences',
  expenses: 'nav.expenses',
  expenseReports: 'nav.expenseReports',
  management: 'nav.management',
  managementProjects: 'nav.management',
  hours: 'nav.teamHours',
  balances: 'nav.balances',
  invitations: 'nav.invitations',
  approvals: 'nav.approvals',
  users: 'nav.users',
  audit: 'nav.audit',
  admin: 'nav.admin',
  orgSettings: 'nav.orgSettings',
  expenseProcessing: 'nav.expenseProcessing',
};

/**
 * Whether the caller may open a page. Uses their permissions in the current organization
 * (GET organizations/:orgId/me/permissions); until those have loaded, or when the API is
 * offline, falls back to the role checks the app used before permissions existed.
 */
function isSectionAllowed(sec: Section, flags: RoleFlags, permissions: Set<string> | null): boolean {
  if (sec === 'home') return true;
  if (permissions) return holdsAny(permissions, SECTION_NAV_OBJECT[sec]);
  return isSectionAllowedByRole(sec, flags);
}

function isSectionAllowedByRole(sec: Section, flags: RoleFlags): boolean {
  switch (sec) {
    case 'home':
    case 'myData':
    case 'time':
    case 'projectTimesheet':
    case 'timesheet':
    case 'workTime':
    case 'absences':
    case 'expenses':
    case 'expenseReports':
      return true;
    case 'users':
      return flags.canSeeUsers;
    case 'expenseProcessing':
      return flags.canProcessExpenses;
    case 'admin':
    case 'audit':
    case 'orgSettings':
      return flags.isAdmin;
    case 'management':
    case 'managementProjects':
    case 'hours':
    case 'balances':
    case 'invitations':
    case 'approvals':
      return flags.canManage;
  }
}

export default function App() {
  const { t, locale, setLocale } = useI18n();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [appBarNode, setAppBarNode] = useState<HTMLElement | null>(null);
  const [appBarHeight, setAppBarHeight] = useState(64);

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
  const [section, setSectionState] = useState<Section>(() => sectionFromHash());
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantPinned, setAssistantPinned] = useState(false);
  const assistantCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [projectsVersion, setProjectsVersion] = useState(0);
  const [workTimeVersion, setWorkTimeVersion] = useState(0);
  const [activeCheckIn, setActiveCheckIn] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [approvalsCount, setApprovalsCount] = useState(0);
  const [hrPendingCount, setHrPendingCount] = useState(0);

  const orgId = currentOrgId;
  const flags = useMemo(() => resolveRoleFlags(session, orgId), [session, orgId]);
  // The caller's permission ids in the current org; null until loaded (or offline). Re-fetched per org.
  const [loadedPermissions, setPermissions] = useState<{ orgId: string; ids: Set<string> } | null>(null);
  const permissions = loadedPermissions && loadedPermissions.orgId === orgId ? loadedPermissions.ids : null;
  const allowed = useCallback((sec: Section) => isSectionAllowed(sec, flags, permissions), [flags, permissions]);
  // Edits (and reviews change requests for) other people's personal details: HR/admin by default.
  const isReviewer = permissions ? isBasicDataReviewer(permissions) : flags.isAdmin || flags.isHr;

  const navigate = useCallback((next: Section) => {
    setSectionState(next);
    const targetHash = SECTION_TO_HASH[next];
    if (typeof window !== 'undefined' && window.location.hash !== targetHash) {
      window.history.pushState(null, '', targetHash);
    }
  }, []);

  useEffect(() => {
    const onHash = () => {
      const parsed = sectionFromHash();
      setSectionState(allowed(parsed) ? parsed : 'home');
    };
    window.addEventListener('hashchange', onHash);
    window.addEventListener('popstate', onHash);
    return () => {
      window.removeEventListener('hashchange', onHash);
      window.removeEventListener('popstate', onHash);
    };
  }, [allowed]);

  useEffect(() => {
    if (!allowed(section)) {
      navigate('home');
    }
  }, [section, allowed, navigate]);

  const authHeaders = useCallback(async (): Promise<Record<string, string>> => {
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
  }, [session]);

  useEffect(() => {
    setPermissions(null);
    if (!session || !orgId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API}/organizations/${orgId}/me/permissions`, { headers: await authHeaders() });
        const data = await res.json();
        if (!cancelled && data?.ok && !data.offline && Array.isArray(data.permissions)) {
          setPermissions({ orgId, ids: new Set<string>(data.permissions) });
        }
      } catch { /* offline: keep the role-based fallback */ }
    })();
    return () => {
      cancelled = true;
    };
    // authHeaders changes when the SSO token refreshes; that must not drop and refetch permissions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.userId, orgId]);

  // The organization's look and feel (theme colors, app bar logo); the default theme when signed out.
  const { branding, setBranding } = useBranding();
  useEffect(() => {
    setBranding({});
    if (!session || !orgId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API}/organizations/${orgId}/branding`, { headers: await authHeaders() });
        const data = await res.json();
        if (!cancelled && data?.ok && data.branding) setBranding(data.branding);
      } catch { /* offline: default look */ }
    })();
    return () => {
      cancelled = true;
    };
    // Same as permissions: a token refresh must not refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.userId, orgId]);

  const designAccess = useDesignAccess(orgId, authHeaders);
  const { items: notifications, unreadCount, live: liveNotification, clearLive, markRead, markAllRead } = useNotifications(session, authHeaders);

  const refreshBadges = useCallback(async () => {
    if (!session || !orgId) {
      setApprovalsCount(0);
      setHrPendingCount(0);
      return;
    }
    try {
      const headers = await authHeaders();
      const tasks: Promise<void>[] = [];
      if (flags.canManage) {
        tasks.push(
          fetch(`${API}/workflows/assigned-to-me`, { headers })
            .then((r) => r.json())
            .then((d) => setApprovalsCount(Array.isArray(d) ? d.length : 0))
            .catch(() => {}),
        );
      } else {
        setApprovalsCount(0);
      }
      if (isReviewer) {
        tasks.push(
          fetch(`${API}/organizations/${orgId}/basicdata/pending`, { headers })
            .then((r) => r.json())
            .then((d) => setHrPendingCount(Array.isArray(d) ? d.length : 0))
            .catch(() => {}),
        );
      } else {
        setHrPendingCount(0);
      }
      await Promise.all(tasks);
    } catch { /* offline fallback */ }
  }, [session, orgId, flags.canManage, isReviewer, authHeaders]);

  const refreshWorkStatus = useCallback(async () => {
    if (!session) {
      setActiveCheckIn(null);
      return;
    }
    try {
      const res = await fetch(`${API}/work-time/status`, { headers: await authHeaders() });
      const data = await res.json();
      setActiveCheckIn(data && data.check_in && !data.check_out ? data.check_in : null);
    } catch { /* offline fallback */ }
  }, [session, authHeaders]);

  useEffect(() => {
    void refreshBadges();
  }, [refreshBadges, liveNotification]);

  useEffect(() => {
    void refreshWorkStatus();
  }, [refreshWorkStatus, workTimeVersion, orgId]);

  useEffect(() => {
    if (!activeCheckIn) return;
    const timer = setInterval(() => setNowMs(Date.now()), 15000);
    return () => clearInterval(timer);
  }, [activeCheckIn]);

  // Ctrl+/ or Cmd+/ toggles the assistant panel cleanly.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === '/') {
        e.preventDefault();
        setAssistantPinned((pinned) => {
          const next = !pinned;
          setAssistantOpen(next);
          return next;
        });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

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

  useEffect(() => {
    if (session?.locale && session.locale !== locale) setLocale(session.locale as Locale);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.locale]);

  useEffect(() => () => {
    if (assistantCloseTimer.current) clearTimeout(assistantCloseTimer.current);
  }, []);

  function navigateToNotification(n: Notification) {
    if (n.type === 'workflow.assigned') {
      navigate('approvals');
      return;
    }
    if (n.source_table === 'expense_reports') navigate('expenseReports');
    else if (n.source_table === 'timesheet_periods') navigate('timesheet');
    else if (n.source_table === 'absences') navigate('absences');
    else if (n.source_table === 'basicdata' || n.source_table === 'users') navigate('myData');
  }

  function switchOrg(newOrgId: string) {
    setCurrentOrgId(newOrgId);
    const nextFlags = resolveRoleFlags(session, newOrgId);
    // The new org's permissions load afterwards (and re-check the page); until then, use its roles.
    if (!isSectionAllowed(section, nextFlags, null)) navigate('home');
    if (isMobile) setMobileNavOpen(false);
  }

  function switchUserSession(nextSession: Session, organizationId: string) {
    if (session && !adminSession) setAdminSession(session);
    setSession(nextSession);
    saveSession(nextSession);
    setCurrentOrgId(organizationId);
    navigate('home');
  }

  function returnToAdmin() {
    if (!adminSession) return;
    setSession(adminSession);
    saveSession(adminSession);
    setCurrentOrgId(adminSession.memberships[0]?.organizationId ?? null);
    setAdminSession(null);
    navigate('home');
  }

  function openAssistantPanel() {
    if (assistantCloseTimer.current) {
      clearTimeout(assistantCloseTimer.current);
      assistantCloseTimer.current = null;
    }
    setAssistantOpen(true);
  }

  function scheduleCloseAssistantPanel() {
    if (assistantPinned) return;
    assistantCloseTimer.current = setTimeout(() => setAssistantOpen(false), 250);
  }

  function toggleAssistantPin() {
    if (assistantOpen && assistantPinned) {
      setAssistantPinned(false);
      setAssistantOpen(false);
    } else {
      setAssistantPinned(true);
      openAssistantPanel();
    }
  }

  async function logout() {
    if (session?.sso) {
      try {
        await ssoLogout();
      } catch { /* fall through */ }
    }
    clearSession();
    setSession(null);
  }

  if (!session) {
    return (
      <Login
        onLoggedIn={(s) => {
          setSession(s);
          setAdminSession(null);
          saveSession(s);
          const firstOrg = s.memberships[0]?.organizationId ?? null;
          setCurrentOrgId(firstOrg);
          navigate('home');
        }}
      />
    );
  }

  const useProjectTimeRanges = session.settings?.useProjectTimeMinutesRanges === true;

  const NAV_GROUPS: Array<{
    id: string;
    /** Empty: no heading, the group starts after a line instead (My data, at the end). */
    header: string;
    items: Array<{
      id: string;
      section: Section;
      label: string;
      icon: ReactNode;
      visible: boolean;
      indent?: boolean;
      dividerBefore?: boolean;
      badge?: number;
    }>;
  }> = [
    {
      id: 'myWork',
      header: t('nav.myWork'),
      items: [
        { id: 'home', section: 'home', label: t('nav.home'), icon: <DashboardIcon fontSize="small" />, visible: allowed('home') },
        { id: 'workTime', section: 'workTime', label: t('nav.workTime'), icon: <TimerIcon fontSize="small" />, visible: allowed('workTime') },
        { id: 'absences', section: 'absences', label: t('nav.absences'), icon: <BeachAccessIcon fontSize="small" />, visible: allowed('absences') },
        { id: 'timesheet', section: 'timesheet', label: t('nav.monthlyTimesheet'), icon: <CalendarMonthIcon fontSize="small" />, visible: allowed('timesheet') },
      ],
    },
    {
      id: 'projectTracking',
      header: t('nav.projectTracking'),
      items: [
        { id: 'time', section: 'time', label: t('nav.timeTracking'), icon: <ScheduleIcon fontSize="small" />, visible: allowed('time') },
        { id: 'projectTimesheet', section: 'projectTimesheet', label: t('nav.projectTimesheet'), icon: <WorkspacesIcon fontSize="small" />, visible: allowed('projectTimesheet') },
      ],
    },
    {
      id: 'expenses',
      header: t('nav.expensesGroup'),
      items: [
        { id: 'expenses', section: 'expenses', label: t('nav.expenses'), icon: <ReceiptLongIcon fontSize="small" />, visible: allowed('expenses') },
        { id: 'expenseReports', section: 'expenseReports', label: t('nav.expenseReports'), icon: <FolderCopyIcon fontSize="small" />, visible: allowed('expenseReports') },
      ],
    },
    {
      id: 'organization',
      header: t('nav.organization'),
      items: [
        { id: 'hours', section: 'hours', label: t('nav.teamHours'), icon: <GroupIcon fontSize="small" />, visible: allowed('hours') },
        { id: 'balances', section: 'balances', label: t('nav.balances'), icon: <AccountBalanceWalletIcon fontSize="small" />, visible: allowed('balances') },
        {
          id: 'approvals',
          section: 'approvals',
          label: t('nav.approvals'),
          icon: <CheckCircleIcon fontSize="small" />,
          visible: allowed('approvals'),
          badge: approvalsCount,
        },
        { id: 'users', section: 'users', label: t('nav.users'), icon: <PeopleIcon fontSize="small" />, visible: allowed('users') },
        { id: 'invitations', section: 'invitations', label: t('nav.invitations'), icon: <MailIcon fontSize="small" />, visible: allowed('invitations'), indent: true },
        { id: 'management', section: 'management', label: t('nav.management'), icon: <WorkspacesIcon fontSize="small" />, visible: allowed('management') },
      ],
    },
    {
      id: 'administration',
      header: t('nav.administration'),
      items: [
        { id: 'orgSettings', section: 'orgSettings', label: t('nav.organizationSettings'), icon: <SettingsIcon fontSize="small" />, visible: allowed('orgSettings') },
        { id: 'audit', section: 'audit', label: t('nav.auditLog'), icon: <HistoryIcon fontSize="small" />, visible: allowed('audit') },
        { id: 'expenseProcessing', section: 'expenseProcessing', label: t('nav.expenseProcessing'), icon: <PaymentsIcon fontSize="small" />, visible: allowed('expenseProcessing') },
        { id: 'admin', section: 'admin', label: t('nav.adminSettings'), icon: <TuneIcon fontSize="small" />, visible: allowed('admin') },
      ],
    },
    {
      id: 'myData',
      header: '',
      items: [
        {
          id: 'myData',
          section: 'myData',
          label: t('nav.myData'),
          icon: <PersonIcon fontSize="small" />,
          visible: allowed('myData'),
          badge: isReviewer ? hrPendingCount : 0,
          dividerBefore: true,
        },
      ],
    },
  ];

  const navList = (
    <List dense>
      {NAV_GROUPS.map((group) => {
        const visibleItems = group.items.filter((n) => n.visible);
        if (visibleItems.length === 0) return null;
        return (
          <li key={group.id}>
            <ul style={{ padding: 0 }}>
              {group.header && (
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
                    mt: 1.5,
                    mb: 0.5,
                  }}
                >
                  {group.header}
                </ListSubheader>
              )}
              {visibleItems.map((n) => (
                <li key={n.id} style={{ listStyle: 'none' }}>
                  {n.dividerBefore && <Divider sx={{ mx: 1, my: 0.5, mt: group.header ? 0.5 : 1.5 }} />}
                  <ListItemButton
                    // The Team Management page's Projects tab has its own route but the same nav item.
                    selected={section === n.section || (n.section === 'management' && section === 'managementProjects')}
                    onClick={() => {
                      navigate(n.section);
                      if (isMobile) setMobileNavOpen(false);
                    }}
                    sx={n.indent ? { pl: n.icon ? 3 : 5 } : undefined}
                  >
                    {n.icon && (
                      <ListItemIcon sx={{ minWidth: 32, color: 'inherit' }}>
                        {n.icon}
                      </ListItemIcon>
                    )}
                    <ListItemText
                      primary={n.label}
                      slotProps={n.indent ? { primary: { fontSize: '0.86rem' } } : { primary: { fontSize: '0.9rem' } }}
                    />
                    {!!n.badge && n.badge > 0 && (
                      <Chip
                        size="small"
                        label={n.badge}
                        color="warning"
                        sx={{ height: 20, fontSize: '0.72rem', ml: 0.5 }}
                      />
                    )}
                  </ListItemButton>
                </li>
              ))}
            </ul>
          </li>
        );
      })}
    </List>
  );

  // Reserve space for the assistant tab always, and for the full panel ONLY when pinned open —
  // unpinned hover overlays cleanly instead of reflowing the main workspace.
  const assistantReservedWidth =
    !isMobile && orgId ? (assistantPinned && assistantOpen ? ASSISTANT_TAB_WIDTH + ASSISTANT_PANEL_WIDTH : ASSISTANT_TAB_WIDTH) : 0;
  const assistantReservedHeight =
    isMobile && orgId ? (assistantOpen ? `calc(${ASSISTANT_TAB_HEIGHT}px + ${ASSISTANT_PANEL_HEIGHT_MOBILE})` : `${ASSISTANT_TAB_HEIGHT}px`) : '0px';
  const designMode = { ...designAccess, panelTop: appBarHeight, panelRight: assistantReservedWidth };
  const activeElapsed = activeCheckIn ? Math.max(0, Math.round((nowMs - new Date(activeCheckIn).getTime()) / 60000)) : 0;

  return (
    <DesignModeProvider value={designMode}>
      <Box sx={{ display: 'flex', minHeight: '100vh' }}>
        <AppBar ref={setAppBarNode} position="fixed" sx={{ zIndex: (th) => th.zIndex.drawer + 1 }}>
          <Toolbar sx={{ gap: 1.5, flexWrap: 'wrap', py: 1 }}>
            {isMobile && (
              <IconButton color="inherit" edge="start" onClick={() => setMobileNavOpen(true)} aria-label={t('app.openNavigation')}>
                <MenuIcon />
              </IconButton>
            )}
            <Box
              onClick={() => navigate('home')}
              sx={{ display: 'flex', alignItems: 'center', gap: 1.25, flexGrow: 1, cursor: 'pointer' }}
            >
              {branding.logo ? (
                <Box
                  component="img"
                  src={branding.logo}
                  alt={session.memberships.find((m) => m.organizationId === orgId)?.name ?? ''}
                  sx={{ height: 36, maxWidth: 140, objectFit: 'contain', display: 'block', borderRadius: '6px' }}
                />
              ) : (
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
              )}
              <Typography variant="h6" sx={{ fontWeight: 700 }}>{t('appbar.title')}</Typography>
            </Box>

            {activeCheckIn && (
              <Chip
                size="small"
                color="success"
                icon={<TimerIcon fontSize="small" />}
                label={t('app.checkedInBadge', { elapsed: formatDurationMinutes(activeElapsed) })}
                onClick={() => navigate('workTime')}
                sx={{
                  bgcolor: 'rgba(255,255,255,0.18)',
                  color: 'inherit',
                  '& .MuiChip-icon': { color: '#86efac' },
                  display: { xs: 'none', md: 'inline-flex' },
                }}
              />
            )}

            {session.memberships.length > 1 ? (
              <FormControl size="small" sx={{ minWidth: 160 }}>
                <Select
                  value={currentOrgId ?? ''}
                  onChange={(e) => switchOrg(e.target.value)}
                  inputProps={{ 'aria-label': t('app.orgSwitcher') }}
                  sx={{ bgcolor: 'background.paper', borderRadius: 1 }}
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
              canSwitchUser={flags.isAdmin && !adminSession}
              canDesign={designAccess.canDesign}
              designMode={designAccess.enabled}
              onDesignModeChange={designAccess.setEnabled}
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
          <Container maxWidth="xl" sx={{ py: 3, display: 'grid', gap: 2 }}>
            <DesignModeNotice />
            <Suspense fallback={<LinearProgress sx={{ my: 2 }} />}>
              {section === 'home' && orgId && (
                <Home
                  orgId={orgId}
                  userId={session.userId}
                  displayName={session.displayName}
                  canManage={flags.canManage}
                  isHrOrAdmin={isReviewer}
                  authHeaders={authHeaders}
                  onNavigate={(target) => navigate(target)}
                  onWorkTimeChanged={() => setWorkTimeVersion((v) => v + 1)}
                  onReviewResolved={() => void refreshBadges()}
                />
              )}
              {section === 'myData' && allowed('myData') && orgId && (
                <MyData
                  orgId={orgId}
                  userId={session.userId}
                  authHeaders={authHeaders}
                  onReviewResolved={() => void refreshBadges()}
                  showWorkSchedule={permissions ? holdsAny(permissions, 'section.workTime.schedule') : true}
                />
              )}
              {section === 'projectTimesheet' && allowed('projectTimesheet') && orgId && (
                <ProjectTimesheet orgId={orgId} userId={session.userId} authHeaders={authHeaders} />
              )}
              {section === 'time' && allowed('time') && orgId && (
                <ProjectTime
                  orgId={orgId}
                  userId={session.userId}
                  useProjectTimeRanges={useProjectTimeRanges}
                  authHeaders={authHeaders}
                  projectsVersion={projectsVersion}
                />
              )}
              {section === 'timesheet' && allowed('timesheet') && orgId && (
                <Timesheet orgId={orgId} userId={session.userId} authHeaders={authHeaders} />
              )}
              {section === 'workTime' && allowed('workTime') && orgId && (
                <WorkTime
                  orgId={orgId}
                  userId={session.userId}
                  authHeaders={authHeaders}
                  onWorkTimeChanged={() => setWorkTimeVersion((v) => v + 1)}
                />
              )}
              {section === 'absences' && allowed('absences') && orgId && (
                <Absences orgId={orgId} userId={session.userId} authHeaders={authHeaders} />
              )}
              {section === 'expenses' && allowed('expenses') && orgId && (
                <Expenses orgId={orgId} userId={session.userId} authHeaders={authHeaders} />
              )}
              {section === 'expenseReports' && allowed('expenseReports') && orgId && (
                <ExpenseReports orgId={orgId} userId={session.userId} authHeaders={authHeaders} />
              )}
              {(section === 'management' || section === 'managementProjects') && allowed(section) && orgId && (
                <Management
                  session={session}
                  orgId={orgId}
                  // 'admin' = edits every team and project; 'manager' = only the ones they lead/own.
                  role={
                    permissions
                      ? grantedScopes(permissions, 'nav.management', 'edit').has('all') ? 'admin' : 'manager'
                      : flags.displayRole
                  }
                  authHeaders={authHeaders}
                  tab={section === 'managementProjects' ? 'projects' : 'teams'}
                  onTabChange={(tab) => navigate(tab === 'projects' ? 'managementProjects' : 'management')}
                  onDataChanged={() => setProjectsVersion((v) => v + 1)}
                />
              )}
              {section === 'hours' && allowed('hours') && orgId && (
                <TeamHours orgId={orgId} authHeaders={authHeaders} />
              )}
              {section === 'balances' && allowed('balances') && orgId && (
                <BalanceReport orgId={orgId} authHeaders={authHeaders} />
              )}
              {section === 'invitations' && allowed('invitations') && orgId && (
                <Invitations orgId={orgId} authHeaders={authHeaders} />
              )}
              {section === 'approvals' && allowed('approvals') && orgId && (
                <Approvals
                  orgId={orgId}
                  role={flags.displayRole}
                  authHeaders={authHeaders}
                  onChanged={() => void refreshBadges()}
                />
              )}
              {section === 'users' && allowed('users') && orgId && (
                <Users
                  orgId={orgId}
                  isAdmin={flags.isAdmin}
                  isHr={flags.isHr}
                  canAccessBasicData={permissions ? seesOthersBasicData(permissions) : flags.isAdmin || flags.isHr}
                  canSeeWorkSchedules={permissions ? holdsBeyondOwn(permissions, 'section.workTime.schedule', 'see') : flags.isAdmin || flags.isHr || flags.canManage}
                  canManage={flags.canManage}
                  authHeaders={authHeaders}
                />
              )}
              {section === 'audit' && allowed('audit') && orgId && (
                <AuditLog orgId={orgId} authHeaders={authHeaders} />
              )}
              {section === 'admin' && allowed('admin') && orgId && (
                <AdminSettings
                  orgId={orgId}
                  authHeaders={authHeaders}
                  canManageRoles={permissions ? holdsAny(permissions, 'section.admin.roles') : flags.isAdmin}
                />
              )}
              {section === 'orgSettings' && allowed('orgSettings') && orgId && (
                <OrganizationSettings orgId={orgId} authHeaders={authHeaders} />
              )}
              {section === 'expenseProcessing' && allowed('expenseProcessing') && orgId && (
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
              zIndex: (th) => th.zIndex.drawer + 2,
              boxShadow: '0 -1px 3px rgba(16,24,40,0.08), 0 -4px 12px rgba(16,24,40,0.10)',
            }}
          >
            <ButtonBase
              onClick={toggleAssistantPin}
              aria-label={assistantPinned ? t('app.assistantUnpin') : t('app.assistantPin')}
              title={assistantPinned ? t('app.assistantUnpin') : t('app.assistantPinTap')}
              sx={{
                height: ASSISTANT_TAB_HEIGHT,
                width: '100%',
                flexShrink: 0,
                backgroundImage: (th) =>
                  `linear-gradient(135deg, ${th.palette.primary.main} 0%, ${th.palette.primary.dark} 100%)`,
                filter: assistantPinned ? 'brightness(0.88)' : 'none',
                color: 'primary.contrastText',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 1,
                '&:hover': { filter: 'brightness(0.88)' },
              }}
            >
              <AutoAwesomeIcon fontSize="small" />
              <Typography variant="button" sx={{ letterSpacing: 1 }}>{t('assistant.title')}</Typography>
            </ButtonBase>
            <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
              <Suspense fallback={<LinearProgress sx={{ m: 2 }} />}>
                <Assistant orgId={orgId} authHeaders={authHeaders} onClose={() => { setAssistantPinned(false); setAssistantOpen(false); }} />
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
              zIndex: (th) => th.zIndex.drawer + 2,
              boxShadow: assistantOpen ? '-4px 0 20px rgba(16,24,40,0.14)' : '0 1px 3px rgba(16,24,40,0.08)',
            }}
          >
            <ButtonBase
              onClick={toggleAssistantPin}
              aria-label={assistantPinned ? t('app.assistantUnpin') : t('app.assistantPin')}
              title={`${assistantPinned ? t('app.assistantUnpin') : t('app.assistantPinClick')} (Ctrl+/)`}
              sx={{
                width: ASSISTANT_TAB_WIDTH,
                height: '100%',
                flexShrink: 0,
                backgroundImage: (th) =>
                  `linear-gradient(135deg, ${th.palette.primary.main} 0%, ${th.palette.primary.dark} 100%)`,
                filter: assistantPinned ? 'brightness(0.88)' : 'none',
                color: 'primary.contrastText',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 1,
                '&:hover': { filter: 'brightness(0.88)' },
              }}
            >
              <PushPinIcon
                fontSize="small"
                sx={{
                  transform: assistantPinned ? 'rotate(0deg)' : 'rotate(45deg)',
                  transition: 'transform 0.15s ease',
                }}
              />
              <Typography
                variant="button"
                sx={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', letterSpacing: 1, whiteSpace: 'nowrap' }}
              >
                {t('assistant.title')}
              </Typography>
            </ButtonBase>
            <Box sx={{ width: ASSISTANT_PANEL_WIDTH, flexShrink: 0, height: '100%' }}>
              <Suspense fallback={<LinearProgress sx={{ m: 2 }} />}>
                <Assistant orgId={orgId} authHeaders={authHeaders} onClose={() => { setAssistantPinned(false); setAssistantOpen(false); }} />
              </Suspense>
            </Box>
          </Box>
        ))}
      </Box>
    </DesignModeProvider>
  );
}
