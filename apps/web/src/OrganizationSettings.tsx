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

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';

interface OrgDetails {
  id: string;
  slug: string;
  name: string;
  type: string;
  avatar_url: string | null;
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
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [org, setOrg] = useState<OrgDetails | null>(null);
  const [orgName, setOrgName] = useState('');
  const [orgLogoUrl, setOrgLogoUrl] = useState('');
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
    if (!orgName.trim()) return;
    setError(null);
    try {
      const res = await fetch(`${API}/organizations/${orgId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ name: orgName.trim(), avatarUrl: orgLogoUrl.trim() || null }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error === 'forbidden' ? 'Only admins can edit organization settings.' : 'Failed to save organization.');
        return;
      }
      setSuccess('Organization settings saved.');
      await reloadOrg();
    } catch {
      setError('Failed to save organization.');
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
        setError(data.error === 'forbidden' ? 'Only admins can manage domains.' : 'Failed to add domain.');
        return;
      }
      setNewDomain('');
      setNewDomainAutoJoin(false);
      setSuccess(`Domain "${domain}" saved.`);
      await reloadDomains();
    } catch {
      setError('Failed to add domain.');
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
        setError(data.error === 'forbidden' ? 'Only admins can configure SSO.' : 'Failed to save SSO configuration.');
        return;
      }
      setSuccess('SSO configuration saved.');
      await reloadSso();
    } catch {
      setError('Failed to save SSO configuration.');
    }
  }

  return (
    <Paper sx={{ p: 2 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
        <Typography variant="h6">Organization Settings</Typography>
        <Chip label="Admin Access" color="secondary" size="small" variant="outlined" />
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Profile, verified domains, and SSO for this organization.
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess(null)}>{success}</Alert>}
      {loading && <LinearProgress sx={{ mb: 2 }} />}

      <Box sx={{ display: 'grid', gap: 3 }}>
        <Box>
          <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>Organization Profile</Typography>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
            <TextField label="Organization Name" value={orgName} onChange={(e) => setOrgName(e.target.value)} size="small" sx={{ minWidth: 220 }} />
            <TextField label="Logo URL" value={orgLogoUrl} onChange={(e) => setOrgLogoUrl(e.target.value)} size="small" sx={{ minWidth: 260 }} placeholder="https://…" />
            <Button variant="contained" onClick={handleSaveOrg} disabled={!orgName.trim()}>Save</Button>
            {org && <Chip label={`slug: ${org.slug}`} size="small" variant="outlined" />}
          </Box>
        </Box>

        <Box>
          <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>Verified Domains</Typography>
          <Table size="small" sx={{ mb: 1 }}>
            <TableHead>
              <TableRow>
                <TableCell>Domain</TableCell>
                <TableCell>Verified</TableCell>
                <TableCell>Auto-join</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {domains.map((d) => (
                <TableRow key={d.id}>
                  <TableCell>{d.domain}</TableCell>
                  <TableCell>{d.verified_at ? 'Yes' : 'Pending'}</TableCell>
                  <TableCell>{d.auto_join_enabled ? 'Enabled' : 'Disabled'}</TableCell>
                </TableRow>
              ))}
              {domains.length === 0 && (
                <TableRow><TableCell colSpan={3}>No domains configured yet.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
            <TextField label="Add Domain" value={newDomain} onChange={(e) => setNewDomain(e.target.value)} size="small" placeholder="example.com" />
            <FormControlLabel
              control={<Checkbox checked={newDomainAutoJoin} onChange={(e) => setNewDomainAutoJoin(e.target.checked)} size="small" />}
              label="Auto-join"
            />
            <Button variant="outlined" size="small" onClick={handleAddDomain} disabled={!newDomain.trim()}>Add</Button>
          </Box>
        </Box>

        <Box>
          <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>SSO Configuration</Typography>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
            <TextField select label="Protocol" value={ssoProtocol} onChange={(e) => setSsoProtocol(e.target.value as 'saml2' | 'oidc')} size="small" sx={{ minWidth: 120 }}>
              <MenuItem value="saml2">SAML 2.0</MenuItem>
              <MenuItem value="oidc">OIDC</MenuItem>
            </TextField>
            <TextField label="IdP Entity ID" value={ssoEntityId} onChange={(e) => setSsoEntityId(e.target.value)} size="small" sx={{ minWidth: 220 }} />
            <TextField label="IdP SSO URL" value={ssoUrl} onChange={(e) => setSsoUrl(e.target.value)} size="small" sx={{ minWidth: 260 }} />
            <Button variant="outlined" size="small" onClick={handleSaveSso} disabled={!ssoEntityId.trim() || !ssoUrl.trim()}>Save</Button>
            {sso && <Chip label={sso.is_active ? 'Active' : 'Inactive'} size="small" color={sso.is_active ? 'success' : 'default'} />}
          </Box>
        </Box>
      </Box>
    </Paper>
  );
}
