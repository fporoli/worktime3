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
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { useT } from './i18n';
import { PageHeader, TableEmptyRow } from './components';
import { SettingsIcon } from './icons';
import BrandingSettings from './BrandingSettings';
import WorkTimeSettings from './WorkTimeSettings';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';

interface OrgDetails {
  id: string;
  slug: string;
  name: string;
  type: string;
  default_currency: string;
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
  const [defaultCurrency, setDefaultCurrency] = useState('');
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
        setDefaultCurrency(data.default_currency ?? '');
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


  async function handleSaveOrg() {
    if (!orgName.trim() || !/^[A-Za-z]{3}$/.test(defaultCurrency)) return;
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`${API}/organizations/${orgId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ name: orgName.trim(), defaultCurrency: defaultCurrency.toUpperCase() }),
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
    setSuccess(null);
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
    setSuccess(null);
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
    <Box sx={{ display: 'grid', gap: 2 }}>
      <PageHeader
        title={t('orgSettings.title')}
        subtitle={t('orgSettings.subtitle')}
        end={<Chip label={t('staticdata.adminAccess')} color="secondary" size="small" variant="outlined" />}
      />

      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
      {success && <Alert severity="success" onClose={() => setSuccess(null)}>{success}</Alert>}
      {loading && <LinearProgress />}

      <Paper
        component="form"
        onSubmit={(e) => {
          e.preventDefault();
          void handleSaveOrg();
        }}
        sx={{ p: 2 }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1, mb: 1.5 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>{t('orgSettings.profile')}</Typography>
          {org && <Chip label={t('orgSettings.slugLabel', { slug: org.slug })} size="small" variant="outlined" />}
        </Box>
        <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <TextField label={t('orgSettings.name')} value={orgName} onChange={(e) => setOrgName(e.target.value)} size="small" sx={{ minWidth: 220 }} />
          <TextField
            label={t('orgSettings.defaultCurrency')}
            value={defaultCurrency}
            onChange={(e) => setDefaultCurrency(e.target.value.toUpperCase())}
            size="small"
            slotProps={{ htmlInput: { maxLength: 3 } }}
            sx={{ maxWidth: 160 }}
            helperText={t('orgSettings.defaultCurrencyHelper')}
          />
          <Button type="submit" variant="contained" sx={{ height: 40 }} disabled={!orgName.trim() || !/^[A-Za-z]{3}$/.test(defaultCurrency)}>
            {t('common.save')}
          </Button>
        </Box>
      </Paper>

      <BrandingSettings orgId={orgId} authHeaders={authHeaders} />

      <WorkTimeSettings orgId={orgId} authHeaders={authHeaders} />

      <Paper sx={{ p: 2 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1.5 }}>{t('orgSettings.domains')}</Typography>
        <TableContainer sx={{ mb: 1.5 }}>
          <Table size="small">
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
                <TableEmptyRow colSpan={3} icon={<SettingsIcon fontSize="inherit" />} title={t('orgSettings.noDomains')} />
              )}
            </TableBody>
          </Table>
        </TableContainer>
        <Box
          component="form"
          onSubmit={(e) => {
            e.preventDefault();
            void handleAddDomain();
          }}
          sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}
        >
          <TextField label={t('orgSettings.addDomain')} value={newDomain} onChange={(e) => setNewDomain(e.target.value)} size="small" placeholder="example.com" />
          <FormControlLabel
            control={<Checkbox checked={newDomainAutoJoin} onChange={(e) => setNewDomainAutoJoin(e.target.checked)} size="small" />}
            label={t('orgSettings.autoJoin')}
          />
          <Button type="submit" variant="outlined" size="small" disabled={!newDomain.trim()}>{t('common.add')}</Button>
        </Box>
      </Paper>

      <Paper
        component="form"
        onSubmit={(e) => {
          e.preventDefault();
          void handleSaveSso();
        }}
        sx={{ p: 2 }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1, mb: 1.5 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>{t('orgSettings.sso')}</Typography>
          {sso && <Chip label={sso.is_active ? t('orgSettings.active') : t('orgSettings.inactive')} size="small" color={sso.is_active ? 'success' : 'default'} />}
        </Box>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
          <TextField select label={t('orgSettings.protocol')} value={ssoProtocol} onChange={(e) => setSsoProtocol(e.target.value as 'saml2' | 'oidc')} size="small" sx={{ minWidth: 120 }}>
            <MenuItem value="saml2">SAML 2.0</MenuItem>
            <MenuItem value="oidc">OIDC</MenuItem>
          </TextField>
          <TextField label={t('orgSettings.idpEntityId')} value={ssoEntityId} onChange={(e) => setSsoEntityId(e.target.value)} size="small" sx={{ minWidth: 220 }} />
          <TextField label={t('orgSettings.idpSsoUrl')} value={ssoUrl} onChange={(e) => setSsoUrl(e.target.value)} size="small" sx={{ minWidth: 260 }} />
          <Button type="submit" variant="outlined" size="small" disabled={!ssoEntityId.trim() || !ssoUrl.trim()}>{t('common.save')}</Button>
        </Box>
      </Paper>
    </Box>
  );
}
