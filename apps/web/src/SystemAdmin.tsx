import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  LinearProgress,
  Paper,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';

interface WorkflowDefinition {
  workflow_def_id: string;
  name: string;
  description: string | null;
  steps: unknown[];
}

interface Permission {
  id: string;
  description: string;
}

interface Role {
  id: string;
  organization_id: string | null;
  name: string;
  description: string | null;
  is_system_role: boolean;
  permission_ids: string[];
}

interface Props {
  orgId: string;
  authHeaders: () => Promise<Record<string, string>>;
}

function prettyJson(value: unknown): string {
  return JSON.stringify(value ?? [], null, 2);
}

export default function SystemAdmin({ orgId, authHeaders }: Props) {
  const [tab, setTab] = useState(0);
  const [workflows, setWorkflows] = useState<WorkflowDefinition[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [workflowEditor, setWorkflowEditor] = useState<WorkflowDefinition | null>(null);
  const [roleEditor, setRoleEditor] = useState<Role | null>(null);
  const [newRole, setNewRole] = useState(false);

  async function request(path: string, options?: RequestInit) {
    const response = await fetch(`${API}${path}`, {
      ...options,
      headers: { ...(options?.body ? { 'Content-Type': 'application/json' } : {}), ...(await authHeaders()), ...options?.headers },
    });
    const data = await response.json();
    if (!response.ok || data?.ok === false) throw new Error(data?.error ?? 'request-failed');
    return data;
  }

  async function reload() {
    setLoading(true);
    setError(null);
    try {
      const [workflowRows, permissionRows, roleRows] = await Promise.all([
        request(`/organizations/${orgId}/system-admin/workflow-definitions`),
        request(`/organizations/${orgId}/system-admin/permissions`),
        request(`/organizations/${orgId}/system-admin/roles`),
      ]);
      setWorkflows(Array.isArray(workflowRows) ? workflowRows : []);
      setPermissions(Array.isArray(permissionRows) ? permissionRows : []);
      setRoles(Array.isArray(roleRows) ? roleRows : []);
    } catch {
      setError('Could not load system administration data.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
    // Reload when changing organization, not when the auth callback identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  async function saveWorkflow(value: { id?: string; name: string; description: string; steps: string }) {
    let steps: unknown;
    try {
      steps = JSON.parse(value.steps);
    } catch {
      setError('Workflow steps must contain valid JSON.');
      return;
    }
    try {
      const path = value.id
        ? `/organizations/${orgId}/system-admin/workflow-definitions/${value.id}`
        : `/organizations/${orgId}/system-admin/workflow-definitions`;
      await request(path, {
        method: value.id ? 'PATCH' : 'POST',
        body: JSON.stringify({ name: value.name, description: value.description, steps }),
      });
      setWorkflowEditor(null);
      setNotice('Workflow definition saved.');
      await reload();
    } catch {
      setError('Could not save workflow definition.');
    }
  }

  async function removeWorkflow(row: WorkflowDefinition) {
    if (!window.confirm(`Delete workflow definition "${row.name}"? Existing workflow instances will also be removed.`)) return;
    try {
      await request(`/organizations/${orgId}/system-admin/workflow-definitions/${row.workflow_def_id}`, { method: 'DELETE' });
      setNotice('Workflow definition deleted.');
      await reload();
    } catch {
      setError('Could not delete workflow definition.');
    }
  }

  async function saveRole(value: { id?: string; name: string; description: string; permissionIds: string[] }) {
    try {
      const path = value.id
        ? `/organizations/${orgId}/system-admin/roles/${value.id}`
        : `/organizations/${orgId}/system-admin/roles`;
      await request(path, {
        method: value.id ? 'PATCH' : 'POST',
        body: JSON.stringify({ name: value.name, description: value.description, permissionIds: value.permissionIds }),
      });
      setRoleEditor(null);
      setNewRole(false);
      setNotice('Role permissions saved.');
      await reload();
    } catch {
      setError('Could not save role permissions.');
    }
  }

  async function removeRole(row: Role) {
    if (row.is_system_role || !window.confirm(`Delete custom role "${row.name}"?`)) return;
    try {
      await request(`/organizations/${orgId}/system-admin/roles/${row.id}`, { method: 'DELETE' });
      setNotice('Role deleted.');
      await reload();
    } catch {
      setError('Could not delete role.');
    }
  }

  return (
    <Paper sx={{ p: 2 }}>
      <Typography variant="h6">System administration</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Configure organization workflow definitions and the permissions granted by each role.
      </Typography>
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
      {notice && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setNotice(null)}>{notice}</Alert>}
      {loading && <LinearProgress sx={{ mb: 2 }} />}
      <Tabs value={tab} onChange={(_, value) => setTab(value)} sx={{ mb: 2 }}>
        <Tab label="Workflow definitions" />
        <Tab label="Roles & permissions" />
      </Tabs>

      {tab === 0 && (
        <Box>
          <Button variant="contained" sx={{ mb: 2 }} onClick={() => setWorkflowEditor({ workflow_def_id: '', name: '', description: '', steps: [] })}>
            New workflow
          </Button>
          <Table size="small">
            <TableHead><TableRow><TableCell>Name</TableCell><TableCell>Description</TableCell><TableCell>Steps</TableCell><TableCell align="right">Actions</TableCell></TableRow></TableHead>
            <TableBody>
              {workflows.map((row) => (
                <TableRow key={row.workflow_def_id} hover>
                  <TableCell sx={{ fontWeight: 600 }}>{row.name}</TableCell>
                  <TableCell>{row.description || '—'}</TableCell>
                  <TableCell><Chip size="small" label={Array.isArray(row.steps) ? `${row.steps.length} step(s)` : 'Invalid'} /></TableCell>
                  <TableCell align="right">
                    <Button size="small" onClick={() => setWorkflowEditor(row)}>Edit</Button>
                    <Button size="small" color="error" onClick={() => void removeWorkflow(row)}>Delete</Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      )}

      {tab === 1 && (
        <Box>
          <Button variant="contained" sx={{ mb: 2 }} onClick={() => setNewRole(true)}>New custom role</Button>
          <Table size="small">
            <TableHead><TableRow><TableCell>Role</TableCell><TableCell>Description</TableCell><TableCell>Permissions</TableCell><TableCell align="right">Actions</TableCell></TableRow></TableHead>
            <TableBody>
              {roles.map((row) => (
                <TableRow key={row.id} hover>
                  <TableCell sx={{ fontWeight: 600 }}>{row.name}{row.is_system_role && <Chip label="System" size="small" sx={{ ml: 1 }} />}</TableCell>
                  <TableCell>{row.description || '—'}</TableCell>
                  <TableCell>{row.permission_ids.length} of {permissions.length}</TableCell>
                  <TableCell align="right">
                    <Button size="small" onClick={() => setRoleEditor(row)}>Edit</Button>
                    {!row.is_system_role && <Button size="small" color="error" onClick={() => void removeRole(row)}>Delete</Button>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      )}

      <WorkflowDialog row={workflowEditor} onClose={() => setWorkflowEditor(null)} onSave={saveWorkflow} />
      <RoleDialog row={roleEditor} create={newRole} permissions={permissions} onClose={() => { setRoleEditor(null); setNewRole(false); }} onSave={saveRole} />
    </Paper>
  );
}

function WorkflowDialog({ row, onClose, onSave }: { row: WorkflowDefinition | null; onClose: () => void; onSave: (value: { id?: string; name: string; description: string; steps: string }) => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [steps, setSteps] = useState('[]');
  useEffect(() => {
    if (row) {
      setName(row.name);
      setDescription(row.description ?? '');
      setSteps(prettyJson(row.steps));
    }
  }, [row]);
  return (
    <Dialog open={!!row} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>{row?.workflow_def_id ? 'Edit workflow definition' : 'New workflow definition'}</DialogTitle>
      <DialogContent>
        <TextField autoFocus fullWidth margin="normal" label="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <TextField fullWidth margin="normal" label="Description" value={description} onChange={(e) => setDescription(e.target.value)} />
        <TextField fullWidth multiline minRows={12} margin="normal" label="Steps (JSON array)" value={steps} onChange={(e) => setSteps(e.target.value)} />
      </DialogContent>
      <DialogActions><Button onClick={onClose}>Cancel</Button><Button variant="contained" onClick={() => onSave({ id: row?.workflow_def_id || undefined, name, description, steps })}>Save</Button></DialogActions>
    </Dialog>
  );
}

function RoleDialog({ row, create, permissions, onClose, onSave }: { row: Role | null; create: boolean; permissions: Permission[]; onClose: () => void; onSave: (value: { id?: string; name: string; description: string; permissionIds: string[] }) => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  useEffect(() => {
    if (row) {
      setName(row.name);
      setDescription(row.description ?? '');
      setSelected(row.permission_ids);
    } else if (create) {
      setName('');
      setDescription('');
      setSelected([]);
    }
  }, [row, create]);
  function toggle(permissionId: string) {
    setSelected((current) => current.includes(permissionId) ? current.filter((id) => id !== permissionId) : [...current, permissionId]);
  }
  return (
    <Dialog open={!!row || create} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{create ? 'New custom role' : `Edit ${row?.name ?? 'role'}`}</DialogTitle>
      <DialogContent>
        <TextField autoFocus fullWidth margin="normal" label="Name" value={name} disabled={!!row?.is_system_role} onChange={(e) => setName(e.target.value)} />
        <TextField fullWidth margin="normal" label="Description" value={description} onChange={(e) => setDescription(e.target.value)} />
        <Typography variant="subtitle2" sx={{ mt: 2 }}>Granted permissions</Typography>
        {permissions.map((permission) => (
          <Box key={permission.id} sx={{ display: 'flex', alignItems: 'center' }}>
            <Checkbox checked={selected.includes(permission.id)} onChange={() => toggle(permission.id)} />
            <Box><Typography variant="body2">{permission.id}</Typography><Typography variant="caption" color="text.secondary">{permission.description}</Typography></Box>
          </Box>
        ))}
      </DialogContent>
      <DialogActions><Button onClick={onClose}>Cancel</Button><Button variant="contained" onClick={() => onSave({ id: row?.id, name, description, permissionIds: selected })}>Save</Button></DialogActions>
    </Dialog>
  );
}
