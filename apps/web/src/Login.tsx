import { useEffect, useState } from 'react';
import { Alert, Box, Button, Container, Divider, IconButton, MenuItem, Paper, Tab, Tabs, TextField, Tooltip, Typography } from '@mui/material';
import { ensureSsoInit, keycloak, startSsoLogin } from './auth';
import { LOCALES, useI18n } from './i18n';
import { DarkModeIcon, LightModeIcon } from './icons';
import { useThemeMode } from './theme';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';
const SHOW_DEMO_ACCOUNTS = import.meta.env.VITE_SHOW_DEMO_ACCOUNTS !== 'false';

export interface Membership {
  organizationId: string;
  slug: string;
  name: string;
  role: string;
  /** Every role this membership holds — `role` collapses this to a single display role, which hides e.g. a `billing_admin`-only membership. */
  roles: string[];
  status: string;
}

export interface Session {
  userId: string;
  email: string;
  displayName: string;
  /** Local API token; sent as `Authorization: Bearer` on API calls. */
  token?: string;
  /** True when the token is a Keycloak access token from the SSO redirect. */
  sso?: boolean;
  memberships: Membership[];
  /** The user's preferred UI language (e.g. 'en', 'de'); fetched from the API after login, defaults to 'en'. */
  locale?: string;
  /** Free-form per-user preferences; fetched from the API after login. */
  settings?: {
    /**
     * When true, project time entries are strict start/end ranges that may not overlap.
     * When false/unset, only the daily duration matters and every entry is recorded
     * starting at 08:00, so overlap doesn't apply.
     */
    useProjectTimeMinutesRanges?: boolean;
  };
}

const SESSION_KEY = 'worktime.session';

export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const session: unknown = JSON.parse(raw);
    const memberships = (session as { memberships?: unknown } | null)?.memberships;
    // Sessions saved before memberships carried `roles` are stale; force a fresh login.
    if (!Array.isArray(memberships) || memberships.some((m) => !Array.isArray(m?.roles))) {
      clearSession();
      return null;
    }
    return session as Session;
  } catch {
    return null;
  }
}

export function saveSession(session: Session) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

/** A login-screen demo button, configured in global static data (`login` / `demo_accounts`). */
interface DemoAccount {
  name: string;
  user: string;
  password: string;
}
const DEMO_INVITE_TOKEN = 'dev-invite-0001';

/** API error codes with their own message; the text is `login.error.<code>` in the dictionaries. */
const KNOWN_ERRORS = new Set([
  'invalid-credentials',
  'account-inactive',
  'invalid-email',
  'display-name-required',
  'password-too-short',
  'email-taken',
  'token-required',
  'invalid-token',
  'invitation-not-pending',
  'invitation-expired',
]);

type Mode = 'login' | 'register' | 'reset' | 'invite';

async function post(path: string, body: unknown) {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error('request-failed');
  return res.json();
}

export default function Login({ onLoggedIn }: { onLoggedIn: (s: Session) => void }) {
  const { t, locale, setLocale } = useI18n();
  const { mode: themeMode, toggleMode } = useThemeMode();
  const [mode, setMode] = useState<Mode>(() => {
    try {
      return new URLSearchParams(window.location.search).get('invite') ? 'invite' : 'login';
    } catch {
      return 'login';
    }
  });
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [token, setToken] = useState(() => {
    try {
      return new URLSearchParams(window.location.search).get('invite') ?? DEMO_INVITE_TOKEN;
    } catch {
      return DEMO_INVITE_TOKEN;
    }
  });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ssoChecking, setSsoChecking] = useState(true);
  const [demoAccounts, setDemoAccounts] = useState<DemoAccount[]>([]);

  // Demo accounts come from the API (seeded databases only); none configured -> no section.
  useEffect(() => {
    if (!SHOW_DEMO_ACCOUNTS) return;
    let cancelled = false;
    fetch(`${API}/auth/demo-accounts`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && Array.isArray(data?.accounts)) setDemoAccounts(data.accounts);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // After a Keycloak redirect back to us, finish the login: sync the user, keep the SSO token.
  useEffect(() => {
    let cancelled = false;
    ensureSsoInit()
      .then(async (authenticated) => {
        if (cancelled) return;
        try {
          if (authenticated && keycloak.token) {
            const profile = keycloak.tokenParsed as Record<string, unknown> | undefined;
            const email = typeof profile?.email === 'string' ? profile.email : undefined;
            const displayName =
              typeof profile?.name === 'string'
                ? profile.name
                : typeof profile?.preferred_username === 'string'
                  ? profile.preferred_username
                  : email;
            const res = await fetch(`${API}/auth/sso/sync`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${keycloak.token}` },
              body: JSON.stringify({ email, displayName }),
            });
            const data = await res.json();
            if (!cancelled && data.ok) {
              const session = { ...(data as Session), token: keycloak.token, sso: true };
              saveSession(session);
              onLoggedIn(session);
              return;
            }
          }
        } catch {
          // SSO unavailable (Keycloak down?) — fall through to the local form.
        } finally {
          if (!cancelled) setSsoChecking(false);
        }
      })
      .catch(() => {
        if (!cancelled) setSsoChecking(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function run(fn: () => Promise<void>) {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error && KNOWN_ERRORS.has(e.message) ? t(`login.error.${e.message}`) : t('login.error.generic'));
    } finally {
      setBusy(false);
    }
  }

  function fail(code: string): never {
    throw new Error(code);
  }

  async function submitLogin(loginEmail: string, loginPassword: string) {
    await run(async () => {
      const data = await post('/auth/login', { email: loginEmail, password: loginPassword });
      if (!data.ok) fail(data.error ?? 'invalid-credentials');
      const session = data as Session;
      saveSession(session);
      onLoggedIn(session);
    });
  }

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: (th) =>
          th.palette.mode === 'dark'
            ? 'linear-gradient(180deg, #0f172a 0%, #0b1120 320px)'
            : 'linear-gradient(180deg, #eef2fb 0%, #f5f6fa 320px)',
        py: 6,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 3 }}>
        <Box
          sx={{
            width: 40,
            height: 40,
            borderRadius: '10px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'primary.contrastText',
            backgroundImage: 'linear-gradient(135deg, #1a56db 0%, #0f3fa8 100%)',
            fontWeight: 700,
            fontSize: '1.1rem',
          }}
        >
          W
        </Box>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>{t('appbar.title')}</Typography>
      </Box>
      <Container maxWidth="xs" disableGutters>
      <Paper elevation={2} sx={{ p: 4, borderRadius: 3 }}>
        <Tabs
          value={mode}
          onChange={(_, v) => {
            setMode(v);
            setError(null);
            setNotice(null);
          }}
          variant="fullWidth"
          sx={{ mb: 3 }}
        >
          <Tab value="login" label={t('login.tab.login')} />
          <Tab value="register" label={t('login.tab.register')} />
          <Tab value="invite" label={t('login.tab.invite')} />
          <Tab value="reset" label={t('login.tab.reset')} />
        </Tabs>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        {notice && <Alert severity="success" sx={{ mb: 2 }}>{notice}</Alert>}

        {mode === 'login' && (
          <Box
            component="form"
            onSubmit={(e) => {
              e.preventDefault();
              void submitLogin(email, password);
            }}
            sx={{ display: 'grid', gap: 2 }}
          >
            <Button variant="outlined" disabled={busy || ssoChecking} onClick={() => startSsoLogin()}>
              {ssoChecking ? t('login.ssoChecking') : t('login.ssoButton')}
            </Button>
            <Divider sx={{ '&::before, &::after': { borderColor: 'divider' } }}>
              <Typography variant="caption" color="text.secondary">{t('login.orLocal')}</Typography>
            </Divider>
            <TextField label={t('common.email')} value={email} onChange={(e) => setEmail(e.target.value)} size="small" autoComplete="email" />
            <TextField label={t('login.password')} type="password" value={password} onChange={(e) => setPassword(e.target.value)} size="small" autoComplete="current-password" />
            <Button type="submit" variant="contained" disabled={busy}>{t('login.submit')}</Button>
            {SHOW_DEMO_ACCOUNTS && demoAccounts.length > 0 && (
              <>
                <Divider />
                {/* Picking an account signs in right away. */}
                <TextField
                  select
                  size="small"
                  label={t('login.demoAccounts')}
                  value=""
                  disabled={busy}
                  onChange={(e) => {
                    const account = demoAccounts.find((a) => a.user === e.target.value);
                    if (account) void submitLogin(account.user, account.password);
                  }}
                >
                  {demoAccounts.map((a) => (
                    <MenuItem key={a.user} value={a.user}>
                      {a.name}
                      <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>{a.user}</Typography>
                    </MenuItem>
                  ))}
                </TextField>
              </>
            )}
          </Box>
        )}

        {mode === 'register' && (
          <Box
            component="form"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                const data = await post('/auth/register', { email, displayName, password });
                if (!data.ok) fail(data.error ?? 'request-failed');
                const session = data as Session;
                saveSession(session);
                onLoggedIn(session);
              });
            }}
            sx={{ display: 'grid', gap: 2 }}
          >
            <Typography variant="body2" color="text.secondary">
              {t('login.registerHint')}
            </Typography>
            <TextField label={t('login.displayName')} value={displayName} onChange={(e) => setDisplayName(e.target.value)} size="small" autoComplete="name" />
            <TextField label={t('common.email')} value={email} onChange={(e) => setEmail(e.target.value)} size="small" autoComplete="email" />
            <TextField label={t('login.newPasswordMin')} type="password" value={password} onChange={(e) => setPassword(e.target.value)} size="small" autoComplete="new-password" />
            <Button type="submit" variant="contained" disabled={busy}>
              {t('login.registerSubmit')}
            </Button>
          </Box>
        )}

        {mode === 'invite' && (
          <Box
            component="form"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                const data = await post('/auth/invitations/accept', { token, displayName, password });
                if (!data.ok) fail(data.error ?? 'request-failed');
                const session = data as Session;
                saveSession(session);
                onLoggedIn(session);
              });
            }}
            sx={{ display: 'grid', gap: 2 }}
          >
            <Typography variant="body2" color="text.secondary">
              {t('login.inviteHint')}
              {SHOW_DEMO_ACCOUNTS && <> {t('login.inviteDemo', { token: DEMO_INVITE_TOKEN, email: 'invited@acme.com' })}</>}
            </Typography>
            <TextField label={t('login.inviteToken')} value={token} onChange={(e) => setToken(e.target.value)} size="small" />
            <TextField label={t('login.displayName')} value={displayName} onChange={(e) => setDisplayName(e.target.value)} size="small" autoComplete="name" />
            <TextField label={t('login.newPasswordMin')} type="password" value={password} onChange={(e) => setPassword(e.target.value)} size="small" autoComplete="new-password" />
            <Button type="submit" variant="contained" disabled={busy}>
              {t('login.inviteSubmit')}
            </Button>
          </Box>
        )}

        {mode === 'reset' && (
          <Box
            component="form"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await post('/auth/reset', { email, newPassword });
                setNotice(t('login.resetDone'));
              });
            }}
            sx={{ display: 'grid', gap: 2 }}
          >
            <TextField label={t('common.email')} value={email} onChange={(e) => setEmail(e.target.value)} size="small" autoComplete="email" />
            <TextField label={t('login.resetPasswordMin')} type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} size="small" autoComplete="new-password" />
            <Button type="submit" variant="contained" disabled={busy}>
              {t('login.resetSubmit')}
            </Button>
          </Box>
        )}
      </Paper>
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 1, mt: 2 }}>
        {LOCALES.map((l) => (
          <Button key={l.code} size="small" disabled={l.code === locale} onClick={() => setLocale(l.code)} sx={{ textTransform: 'none' }}>
            {l.label}
          </Button>
        ))}
        <Tooltip title={themeMode === 'dark' ? t('usermenu.themeLight') : t('usermenu.themeDark')}>
          <IconButton size="small" onClick={toggleMode} aria-label={themeMode === 'dark' ? t('usermenu.themeLight') : t('usermenu.themeDark')}>
            {themeMode === 'dark' ? <LightModeIcon fontSize="small" /> : <DarkModeIcon fontSize="small" />}
          </IconButton>
        </Tooltip>
      </Box>
      </Container>
    </Box>
  );
}
