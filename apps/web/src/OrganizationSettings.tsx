import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  FormControlLabel,
  LinearProgress,
  MenuItem,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { useT } from './i18n';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';

interface OrgDetails {
  id: string;
  slug: string;
  name: string;
  type: string;
  avatar_url: string | null;
  default_currency: string;
  max_hours_per_day: number;
}

interface DomainItem {
  id: string;
  domain: string;
  verified_at: string | null;
  auto_join_enabled: boolean;
}

interface SsoConfig {
  protocol: 'saml2' | 'oidc';
  idp_entity_id: string;
  idp_sso_url: string;
  is_active: boolean;
}

interface OrganizationSettingsProps {
  orgId: string;
  authHeaders: () => Promise<Record<string, string>>;
}

export default function OrganizationSettings({ orgId, authHeaders }: OrganizationSettingsProps) {
  const t = useT();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [org, setOrg] = useState<OrgDetails | null>(null);
  const [orgName, setOrgName] = useState('');
  const [orgLogoUrl, setOrgLogoUrl] = useState('');
  const [defaultCurrency, setDefaultCurrency] = useState('');
  const [maxHoursPerDay, setMaxHoursPerDay] = useState('');
  const [domains, setDomains] = useState<DomainItem[]>([]);
  const [newDomain, setNewDomain] = useState('');
  const [newDomainAutoJoin, setNewDomainAutoJoin] = useState(false);
  const [sso, setSso] = useState<SsoConfig | null>(null);
  const [ssoProtocol, setSsoProtocol] = useState<'saml2' | 'oidc'>('saml2');
  const [ssoEntityId, setSsoEntityId] = useState('');
  const [ssoUrl, setSsoUrl] = useState('');

  async function reloadOrg() {
    try {
      const res = await fetch(`${API}/organizations/${orgId}`, { headers: await authHeaders() });
      const data = await res.json();
      if (data) {
        setOrg(data);
        setOrgName(data.name ?? '');
        setOrgLogoUrl(data.avatar_url ?? '');
        setDefaultCurrency(data.default_currency ?? '');
        setMaxHoursPerDay(data.max_hours_per_day != null ? String(data.max_hours_per_day) : '');
      }
    } catch { /* offline fallback */ }
  }

  async function reloadDomains() {
    try {
      const res = await fetch(`${API}/organizations/${orgId}/domains`, { headers: await authHeaders() });
      const data = await res.json();
      if (Array.isArray(data)) setDomains(data);
    } catch { /* offline fallback */ }
  }

  async function reloadSso() {
    try {
      const res = await fetch(`${API}/organizations/${orgId}/sso`, { headers: await authHeaders() });
      const data = await res.json();
      if (data) {
        setSso(data);
        setSsoProtocol(data.protocol ?? 'saml2');
        setSsoEntityId(data.idp_entity_id ?? '');
        setSsoUrl(data.idp_sso_url ?? '');
      }
    } catch { /* offline fallback */ }
  }

  useEffect(() => {
    setLoading(true);
    Promise.all([reloadOrg(), reloadDomains(), reloadSso()]).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  const maxHoursPerDayValue = Number(maxHoursPerDay);
  const isMaxHoursPerDayValid = maxHoursPerDay.trim() !== '' && Number.isFinite(maxHoursPerDayValue) && maxHoursPerDayValue > 0 && maxHoursPerDayValue <= 24;

  async function handleSaveOrg() {
    if (!orgName.trim() || !/^[A-Za-z]{3}$/.test(defaultCurrency) || !isMaxHoursPerDayValid) return;
    setError(null);
    try {
      const res = await fetch(`${API}/organizations/${orgId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ name: orgName.trim(), avatarUrl: orgLogoUrl.trim() || null, defaultCurrency: defaultCurrency.toUpperCase(), maxHoursPerDay: maxHoursPerDayValue }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error === 'forbidden' ? t('orgSettings.forbiddenProfile') : t('orgSettings.saveFailed'));
        return;
      }
      setSuccess(t('orgSettings.saved'));
      await reloadOrg();
    } catch {
      setError(t('orgSettings.saveFailed'));
    }
  }

  async function handleAddDomain() {
    const domain = newDomain.trim().toLowerCase();
    if (!domain) return;
    setError(null);
    try {
      const res = await fetch(`${API}/organizations/${orgId}/domains`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ domain, autoJoin: newDomainAutoJoin }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error === 'forbidden' ? t('orgSettings.forbiddenDomains') : t('orgSettings.addDomainFailed'));
        return;
      }
      setNewDomain('');
      setNewDomainAutoJoin(false);
      setSuccess(t('orgSettings.domainSaved', { domain }));
      await reloadDomains();
    } catch {
      setError(t('orgSettings.addDomainFailed'));
    }
  }

  async function handleSaveSso() {
    if (!ssoEntityId.trim() || !ssoUrl.trim()) return;
    setError(null);
    try {
      const res = await fetch(`${API}/organizations/${orgId}/sso`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ protocol: ssoProtocol, idpEntityId: ssoEntityId.trim(), idpSsoUrl: ssoUrl.trim() }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error === 'forbidden' ? t('orgSettings.forbiddenSso') : t('orgSettings.ssoSaveFailed'));
        return;
      }
      setSuccess(t('orgSettings.ssoSaved'));
      await reloadSso();
    } catch {
      setError(t('orgSettings.ssoSaveFailed'));
    }
  }

  return (
    <Paper sx={{ p: 2 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
        <Typography variant="h6">{t('orgSettings.title')}</Typography>
        <Chip label={t('staticdata.adminAccess')} color="secondary" size="small" variant="outlined" />
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t('orgSettings.subtitle')}
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess(null)}>{success}</Alert>}
      {loading && <LinearProgress sx={{ mb: 2 }} />}

      <Box sx={{ display: 'grid', gap: 3 }}>
        <Box>
          <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>{t('orgSettings.profile')}</Typography>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
            <TextField label={t('orgSettings.name')} value={orgName} onChange={(e) => setOrgName(e.target.value)} size="small" sx={{ minWidth: 220 }} />
            <TextField label={t('orgSettings.logoUrl')} value={orgLogoUrl} onChange={(e) => setOrgLogoUrl(e.target.value)} size="small" sx={{ minWidth: 260 }} placeholder="https://…" />
            <TextField
              label={t('orgSettings.defaultCurrency')}
              value={defaultCurrency}
              onChange={(e) => setDefaultCurrency(e.target.value.toUpperCase())}
              size="small"
              slotProps={{ htmlInput: { maxLength: 3 } }}
              sx={{ maxWidth: 130 }}
              helperText={t('orgSettings.defaultCurrencyHelper')}
            />
            <TextField
              label={t('orgSettings.maxHoursPerDay')}
              type="number"
              value={maxHoursPerDay}
              onChange={(e) => setMaxHoursPerDay(e.target.value)}
              size="small"
              slotProps={{ htmlInput: { min: 0, max: 24, step: 0.5 } }}
              sx={{ maxWidth: 160 }}
              helperText={t('orgSettings.maxHoursPerDayHelper')}
            />
            <Button variant="contained" onClick={handleSaveOrg} disabled={!orgName.trim() || !/^[A-Za-z]{3}$/.test(defaultCurrency) || !isMaxHoursPerDayValid}>{t('common.save')}</Button>
            {org && <Chip label={`slug: ${org.slug}`} size="small" variant="outlined" />}
          </Box>
        </Box>

        <Box>
          <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>{t('orgSettings.domains')}</Typography>
          <Table size="small" sx={{ mb: 1 }}>
            <TableHead>
              <TableRow>
                <TableCell>{t('orgSettings.domain')}</TableCell>
                <TableCell>{t('orgSettings.verified')}</TableCell>
                <TableCell>{t('orgSettings.autoJoin')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {domains.map((d) => (
                <TableRow key={d.id}>
                  <TableCell>{d.domain}</TableCell>
                  <TableCell>{d.verified_at ? t('orgSettings.yes') : t('orgSettings.pending')}</TableCell>
                  <TableCell>{d.auto_join_enabled ? t('orgSettings.enabled') : t('orgSettings.disabled')}</TableCell>
                </TableRow>
              ))}
              {domains.length === 0 && (
                <TableRow><TableCell colSpan={3}>{t('orgSettings.noDomains')}</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
            <TextField label={t('orgSettings.addDomain')} value={newDomain} onChange={(e) => setNewDomain(e.target.value)} size="small" placeholder="example.com" />
            <FormControlLabel
              control={<Checkbox checked={newDomainAutoJoin} onChange={(e) => setNewDomainAutoJoin(e.target.checked)} size="small" />}
              label={t('orgSettings.autoJoin')}
            />
            <Button variant="outlined" size="small" onClick={handleAddDomain} disabled={!newDomain.trim()}>{t('common.add')}</Button>
          </Box>
        </Box>

        <Box>
          <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>{t('orgSettings.sso')}</Typography>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
            <TextField select label={t('orgSettings.protocol')} value={ssoProtocol} onChange={(e) => setSsoProtocol(e.target.value as 'saml2' | 'oidc')} size="small" sx={{ minWidth: 120 }}>
              <MenuItem value="saml2">SAML 2.0</MenuItem>
              <MenuItem value="oidc">OIDC</MenuItem>
            </TextField>
            <TextField label={t('orgSettings.idpEntityId')} value={ssoEntityId} onChange={(e) => setSsoEntityId(e.target.value)} size="small" sx={{ minWidth: 220 }} />
            <TextField label={t('orgSettings.idpSsoUrl')} value={ssoUrl} onChange={(e) => setSsoUrl(e.target.value)} size="small" sx={{ minWidth: 260 }} />
            <Button variant="outlined" size="small" onClick={handleSaveSso} disabled={!ssoEntityId.trim() || !ssoUrl.trim()}>{t('common.save')}</Button>
            {sso && <Chip label={sso.is_active ? t('orgSettings.active') : t('orgSettings.inactive')} size="small" color={sso.is_active ? 'success' : 'default'} />}
          </Box>
        </Box>
      </Box>
    </Paper>
  );
}
