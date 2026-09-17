import { useEffect, useState } from 'react';
import {
  Alert,
  Avatar,
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  Menu,
  MenuItem,
  TextField,
  Typography,
} from '@mui/material';
import type { Session } from './Login';
import { LOCALES, useT, type Locale } from './i18n';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';

interface UserMenuProps {
  session: Session;
  authHeaders: () => Promise<Record<string, string>>;
  currentOrgId: string | null;
  canSwitchUser: boolean;
  adminSession: Session | null;
  onSwitchSession: (session: Session, organizationId: string) => void;
  onReturnToAdmin: () => void;
  onLogout: () => void;
  /** Called once the language change is saved, so the caller can update the session. */
  onLocaleChange: (locale: Locale) => void;
  /** Called once other settings (e.g. project time ranges) are saved, so the caller can update the session. */
  onSettingsChange: (settings: NonNullable<Session['settings']>) => void;
}

interface SearchUser {
  id: string;
  email: string;
  displayName: string;
  status: string;
}

export default function UserMenu({ session, authHeaders, currentOrgId, canSwitchUser, adminSession, onSwitchSession, onReturnToAdmin, onLogout, onLocaleChange, onSettingsChange }: UserMenuProps) {
  const t = useT();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selectedLocale, setSelectedLocale] = useState<Locale>((session.locale as Locale) ?? 'en');
  const [useProjectTimeRanges, setUseProjectTimeRanges] = useState(session.settings?.useProjectTimeMinutesRanges === true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [switchOpen, setSwitchOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [searchUsers, setSearchUsers] = useState<SearchUser[]>([]);
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    if (!switchOpen || !currentOrgId || search.trim().length < 2) {
      setSearchUsers([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch(`${API}/users/search?orgId=${encodeURIComponent(currentOrgId)}&q=${encodeURIComponent(search.trim())}`, { headers: await authHeaders() });
        const data = await res.json();
        if (!cancelled) setSearchUsers(data.ok && Array.isArray(data.users) ? data.users : []);
      } catch {
        if (!cancelled) setSearchUsers([]);
      }
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [authHeaders, currentOrgId, search, switchOpen]);

  function openSettings() {
    setSelectedLocale((session.locale as Locale) ?? 'en');
    setUseProjectTimeRanges(session.settings?.useProjectTimeMinutesRanges === true);
    setError(null);
    setSettingsOpen(true);
    setAnchorEl(null);
  }

  function openSwitchUser() {
    setSearch('');
    setSearchUsers([]);
    setError(null);
    setSwitchOpen(true);
    setAnchorEl(null);
  }

  async function switchUser(user: SearchUser) {
    if (!currentOrgId) return;
    setSwitching(true);
    setError(null);
    try {
      const res = await fetch(`${API}/users/${user.id}/impersonate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ orgId: currentOrgId }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(`Could not switch user (${data.error ?? 'unknown error'}).`);
        return;
      }
      onSwitchSession(data as Session, currentOrgId);
      setSwitchOpen(false);
    } catch {
      setError('Could not reach the API.');
    } finally {
      setSwitching(false);
    }
  }

  async function saveSettings() {
    setSaving(true);
    setError(null);
    const settings = { ...session.settings, useProjectTimeMinutesRanges: useProjectTimeRanges };
    try {
      const res = await fetch(`${API}/users/${session.userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ locale: selectedLocale, settings }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(`Could not save (${data.error ?? 'unknown error'}).`);
        return;
      }
      onLocaleChange(selectedLocale);
      onSettingsChange(settings);
      setSettingsOpen(false);
    } catch {
      setError('Could not reach the API.');
    } finally {
      setSaving(false);
    }
  }

  const initial = (session.displayName || session.email || '?').trim().charAt(0).toUpperCase();

  return (
    <>
      <Button
        color="inherit"
        size="small"
        onClick={(e) => setAnchorEl(e.currentTarget)}
        sx={{ textTransform: 'none', gap: 1 }}
        aria-haspopup="menu"
        aria-expanded={!!anchorEl}
      >
        <Avatar sx={{ width: 24, height: 24, fontSize: 13, bgcolor: 'primary.dark' }}>{initial}</Avatar>
        <Typography variant="body2" sx={{ display: { xs: 'none', sm: 'block' } }}>
          {session.displayName}
        </Typography>
        <Box component="span" aria-hidden sx={{ fontSize: 10, opacity: 0.8 }}>▾</Box>
      </Button>

      <Menu anchorEl={anchorEl} open={!!anchorEl} onClose={() => setAnchorEl(null)}>
        <Box sx={{ px: 2, py: 1, minWidth: 200 }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>{session.displayName}</Typography>
          <Typography variant="caption" color="text.secondary">{session.email}</Typography>
        </Box>
        <Divider />
        <MenuItem onClick={openSettings}>{t('usermenu.settings')}</MenuItem>
        {canSwitchUser && <MenuItem onClick={openSwitchUser}>Switch User...</MenuItem>}
        {adminSession && <MenuItem onClick={() => { setAnchorEl(null); onReturnToAdmin(); }}>Return to my account</MenuItem>}
        <MenuItem onClick={() => { setAnchorEl(null); onLogout(); }}>{t('usermenu.logout')}</MenuItem>
      </Menu>

      <Dialog open={settingsOpen} onClose={() => setSettingsOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>{t('usermenu.settings')}</DialogTitle>
        <DialogContent sx={{ display: 'grid', gap: 2, pt: 1 }}>
          {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
          <TextField
            select
            label={t('usermenu.language')}
            value={selectedLocale}
            onChange={(e) => setSelectedLocale(e.target.value as Locale)}
            size="small"
            sx={{ mt: 1 }}
          >
            {LOCALES.map((l) => (<MenuItem key={l.code} value={l.code}>{l.label}</MenuItem>))}
          </TextField>
          <FormControlLabel
            control={<Checkbox checked={useProjectTimeRanges} onChange={(e) => setUseProjectTimeRanges(e.target.checked)} />}
            label={t('usermenu.useProjectTimeRanges')}
          />
          <Typography variant="caption" color="text.secondary" sx={{ mt: -1.5 }}>
            {t('usermenu.useProjectTimeRangesHint')}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSettingsOpen(false)}>{t('usermenu.cancel')}</Button>
          <Button variant="contained" onClick={saveSettings} disabled={saving}>{t('usermenu.save')}</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={switchOpen} onClose={() => !switching && setSwitchOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>Switch User</DialogTitle>
        <DialogContent sx={{ display: 'grid', gap: 2, pt: 1 }}>
          {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
          <TextField
            autoFocus
            label="Search by name or email"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            size="small"
            helperText="Enter at least two characters."
          />
          <Box sx={{ display: 'grid', gap: 0.5 }}>
            {searchUsers.map((user) => (
              <Button key={user.id} onClick={() => switchUser(user)} disabled={switching} sx={{ justifyContent: 'flex-start', textTransform: 'none' }}>
                <Box sx={{ textAlign: 'left' }}>
                  <Typography variant="body2">{user.displayName}</Typography>
                  <Typography variant="caption" color="text.secondary">{user.email}</Typography>
                </Box>
              </Button>
            ))}
            {search.trim().length >= 2 && searchUsers.length === 0 && <Typography variant="body2" color="text.secondary">No organization members found.</Typography>}
          </Box>
        </DialogContent>
        <DialogActions><Button onClick={() => setSwitchOpen(false)} disabled={switching}>{t('usermenu.cancel')}</Button></DialogActions>
      </Dialog>
    </>
  );
}
