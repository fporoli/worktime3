import { useEffect, useState } from 'react';
import { Alert, Box, Button, Container, Paper, Tab, Tabs, TextField, Typography } from '@mui/material';
import { ensureSsoInit, keycloak, startSsoLogin } from './auth';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';

export interface Membership {
  organizationId: string;
  slug: string;
  name: string;
  role: string;
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
}

const SESSION_KEY = 'worktime.session';

export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
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

const DEMO_ACCOUNTS = [
  { email: 'admin@acme.example', label: 'Admin (Acme)' },
  { email: 'manager@acme.example', label: 'Manager (Acme)' },
  { email: 'user@acme.example', label: 'User (Acme)' },
];
const DEMO_PASSWORD = 'dev1234';
const DEMO_INVITE_TOKEN = 'dev-invite-0001';

const ERROR_TEXT: Record<string, string> = {
  'invalid-credentials': 'Wrong email or password.',
  'account-inactive': 'This account is not active.',
  'invalid-email': 'Please enter a valid email address.',
  'display-name-required': 'Please enter a display name.',
  'password-too-short': 'Password needs at least 8 characters.',
  'email-taken': 'This email is already registered. Try logging in.',
  'token-required': 'Please enter an invitation token.',
  'invalid-token': 'Unknown invitation token.',
  'invitation-not-pending': 'This invitation was already used.',
  'invitation-expired': 'This invitation has expired.',
};

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
  const [mode, setMode] = useState<Mode>('login');
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
      setError(e instanceof Error && e.message in ERROR_TEXT ? ERROR_TEXT[e.message] : 'Something went wrong. Is the API running?');
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
    <Container maxWidth="sm" sx={{ py: 6 }}>
      <Typography variant="h4" gutterBottom>Worktime</Typography>
      <Paper sx={{ p: 3 }}>
        <Tabs value={mode} onChange={(_, v) => setMode(v)} variant="fullWidth" sx={{ mb: 2 }}>
          <Tab value="login" label="Login" />
          <Tab value="register" label="Register" />
          <Tab value="invite" label="Invited" />
          <Tab value="reset" label="Reset" />
        </Tabs>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        {notice && <Alert severity="success" sx={{ mb: 2 }}>{notice}</Alert>}

        {mode === 'login' && (
          <Box sx={{ display: 'grid', gap: 2 }}>
            <Button variant="outlined" disabled={busy || ssoChecking} onClick={() => startSsoLogin()}>
              {ssoChecking ? 'Checking single sign-on…' : 'Login with Keycloak (SSO)'}
            </Button>
            <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center' }}>— or local account —</Typography>
            <TextField label="Email" value={email} onChange={(e) => setEmail(e.target.value)} size="small" autoComplete="email" />
            <TextField label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} size="small" autoComplete="current-password" />
            <Button variant="contained" disabled={busy} onClick={() => submitLogin(email, password)}>Login</Button>
            <Typography variant="body2" color="text.secondary">Demo accounts (password `{DEMO_PASSWORD}`):</Typography>
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              {DEMO_ACCOUNTS.map((a) => (
                <Button key={a.email} variant="outlined" size="small" disabled={busy} onClick={() => submitLogin(a.email, DEMO_PASSWORD)}>
                  {a.label}
                </Button>
              ))}
            </Box>
          </Box>
        )}

        {mode === 'register' && (
          <Box sx={{ display: 'grid', gap: 2 }}>
            <Typography variant="body2" color="text.secondary">
              Creates your account plus a personal workspace where you are the admin.
            </Typography>
            <TextField label="Display name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} size="small" autoComplete="name" />
            <TextField label="Email" value={email} onChange={(e) => setEmail(e.target.value)} size="small" autoComplete="email" />
            <TextField label="Password (min 8 characters)" type="password" value={password} onChange={(e) => setPassword(e.target.value)} size="small" autoComplete="new-password" />
            <Button
              variant="contained"
              disabled={busy}
              onClick={() => run(async () => {
                const data = await post('/auth/register', { email, displayName, password });
                if (!data.ok) fail(data.error ?? 'request-failed');
                const session = data as Session;
                saveSession(session);
                onLoggedIn(session);
              })}
            >
              Register as admin
            </Button>
          </Box>
        )}

        {mode === 'invite' && (
          <Box sx={{ display: 'grid', gap: 2 }}>
            <Typography variant="body2" color="text.secondary">
              Accept an organization invitation. Demo token <code>{DEMO_INVITE_TOKEN}</code> joins Acme as <code>invited@acme.example</code>.
            </Typography>
            <TextField label="Invitation token" value={token} onChange={(e) => setToken(e.target.value)} size="small" />
            <TextField label="Display name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} size="small" autoComplete="name" />
            <TextField label="Password (min 8 characters)" type="password" value={password} onChange={(e) => setPassword(e.target.value)} size="small" autoComplete="new-password" />
            <Button
              variant="contained"
              disabled={busy}
              onClick={() => run(async () => {
                const data = await post('/auth/invitations/accept', { token, displayName, password });
                if (!data.ok) fail(data.error ?? 'request-failed');
                const session = data as Session;
                saveSession(session);
                onLoggedIn(session);
              })}
            >
              Accept invitation & login
            </Button>
          </Box>
        )}

        {mode === 'reset' && (
          <Box sx={{ display: 'grid', gap: 2 }}>
            <TextField label="Email" value={email} onChange={(e) => setEmail(e.target.value)} size="small" autoComplete="email" />
            <TextField label="New password (min 8 characters)" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} size="small" autoComplete="new-password" />
            <Button
              variant="contained"
              disabled={busy}
              onClick={() => run(async () => {
                await post('/auth/reset', { email, newPassword });
                setNotice('If the account exists, the password was updated. You can log in now.');
              })}
            >
              Reset password
            </Button>
          </Box>
        )}
      </Paper>
    </Container>
  );
}
