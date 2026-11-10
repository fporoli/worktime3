import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  LinearProgress,
  MenuItem,
  Paper,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import type { Session } from './Login';
import { useT } from './i18n';
import { ConfirmDialog, PageHeader, TableEmptyRow } from './components';
import { AddIcon, DeleteIcon, EditIcon, PeopleIcon, WorkspacesIcon } from './icons';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';

export interface OrgMember {
  id: string;
  user_id: string;
  role_ids: string[];
  role_names: string[];
  status: string;
  email: string;
  display_name: string;
}

export interface TeamItem {
  id: string;
  organization_id: string;
  name: string;
  description?: string | null;
  lead_user_id?: string | null;
  lead_display_name?: string | null;
  member_count?: number;
}

export interface TeamMemberItem {
  team_id: string;
  membership_id: string;
  user_id: string;
  email: string;
  display_name: string;
  team_role_id?: string | null;
  team_role_name?: string | null;
}

export interface ProjectItem {
  id: string;
  organization_id: string;
  name: string;
  owner_user_id: string;
  cost_item?: string | null;
  type: 'internal' | 'customer' | 'research';
  owner_name?: string | null;
  owner_email?: string | null;
  subproject_count?: number;
}

export interface SubprojectItem {
  id: string;
  project_id: string;
  organization_id: string;
  name: string;
  owner_user_id: string;
  cost_item?: string | null;
  type: 'phase' | 'work_package' | 'task';
  owner_name?: string | null;
  owner_email?: string | null;
  project_name?: string | null;
}

interface ManagementProps {
  session: Session;
  orgId: string;
  role: 'admin' | 'manager' | 'user';
  authHeaders: () => Promise<Record<string, string>>;
  onDataChanged?: () => void;
  tab: 'teams' | 'projects';
  onTabChange: (tab: 'teams' | 'projects') => void;
}

export default function Management({ session, orgId, role, authHeaders, onDataChanged, tab, onTabChange }: ManagementProps) {
  const t = useT();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [members, setMembers] = useState<OrgMember[]>([]);
  const [teams, setTeams] = useState<TeamItem[]>([]);
  const [teamDialogOpen, setTeamDialogOpen] = useState(false);
  const [editingTeam, setEditingTeam] = useState<TeamItem | null>(null);
  const [teamName, setTeamName] = useState('');
  const [teamDesc, setTeamDesc] = useState('');
  const [teamLeadId, setTeamLeadId] = useState('');

  const [selectedTeam, setSelectedTeam] = useState<TeamItem | null>(null);
  const [teamMembers, setTeamMembers] = useState<TeamMemberItem[]>([]);
  const [addMemberId, setAddMemberId] = useState('');

  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [subprojectsByProject, setSubprojectsByProject] = useState<Record<string, SubprojectItem[]>>({});
  const [expandedProjectId, setExpandedProjectId] = useState<string | null>(null);

  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<ProjectItem | null>(null);
  const [projectName, setProjectName] = useState('');
  const [projectType, setProjectType] = useState<'internal' | 'customer' | 'research'>('internal');
  const [projectCost, setProjectCost] = useState('');
  const [projectOwner, setProjectOwner] = useState(session.userId);

  const [subprojectDialogOpen, setSubprojectDialogOpen] = useState(false);
  const [editingSubproject, setEditingSubproject] = useState<SubprojectItem | null>(null);
  const [subprojectParentId, setSubprojectParentId] = useState<string>('');
  const [subprojectName, setSubprojectName] = useState('');
  const [subprojectType, setSubprojectType] = useState<'phase' | 'work_package' | 'task'>('phase');
  const [subprojectCost, setSubprojectCost] = useState('');
  const [subprojectOwner, setSubprojectOwner] = useState(session.userId);

  const [confirmDialog, setConfirmDialog] = useState<{ title: string; message: string; onConfirm: () => void | Promise<void> } | null>(null);

  async function reloadMembers() {
    try {
      const res = await fetch(`${API}/organizations/${orgId}/members`, { headers: await authHeaders() });
      const data = await res.json();
      if (Array.isArray(data)) setMembers(data);
    } catch { /* offline fallback */ }
  }

  async function reloadTeams() {
    try {
      const res = await fetch(`${API}/organizations/${orgId}/teams`, { headers: await authHeaders() });
      const data = await res.json();
      if (Array.isArray(data)) setTeams(data);
    } catch { /* offline fallback */ }
  }

  async function reloadProjects() {
    try {
      const res = await fetch(`${API}/organizations/${orgId}/projects`, { headers: await authHeaders() });
      const data = await res.json();
      if (Array.isArray(data)) setProjects(data);
    } catch { /* offline fallback */ }
  }

  async function reloadSubprojects(pid: string) {
    if (!pid) return;
    try {
      const res = await fetch(`${API}/projects/${pid}/subprojects`, { headers: await authHeaders() });
      const data = await res.json();
      if (Array.isArray(data)) {
        setSubprojectsByProject((prev) => ({ ...prev, [pid]: data }));
      }
    } catch { /* offline fallback */ }
  }

  useEffect(() => {
    setLoading(true);
    setExpandedProjectId(null);
    setSubprojectsByProject({});
    Promise.all([reloadMembers(), reloadTeams(), reloadProjects()]).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  useEffect(() => {
    if (expandedProjectId) void reloadSubprojects(expandedProjectId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandedProjectId]);

  async function loadTeamMembers(team: TeamItem) {
    setSelectedTeam(team);
    setAddMemberId('');
    setTeamMembers([]);
    try {
      const res = await fetch(`${API}/teams/${team.id}/members`, { headers: await authHeaders() });
      const data = await res.json();
      if (Array.isArray(data)) setTeamMembers(data);
    } catch { /* offline fallback */ }
  }

  function canManageTeamMembers(team: TeamItem): boolean {
    if (role === 'admin') return true;
    if (role === 'manager' && team.lead_user_id === session.userId) return true;
    return false;
  }

  function canEditTeamLead(team: TeamItem | null): boolean {
    if (role === 'admin') return true;
    return !!team && team.lead_user_id === session.userId;
  }

  function openCreateTeam() {
    setEditingTeam(null);
    setTeamName('');
    setTeamDesc('');
    setTeamLeadId('');
    setTeamDialogOpen(true);
  }

  function openEditTeam(team: TeamItem) {
    setEditingTeam(team);
    setTeamName(team.name);
    setTeamDesc(team.description ?? '');
    setTeamLeadId(team.lead_user_id ?? '');
    setTeamDialogOpen(true);
  }

  async function handleSaveTeam() {
    if (!teamName.trim()) return;
    setError(null);
    setSuccess(null);
    const canEditLead = canEditTeamLead(editingTeam);
    const leadPatch = canEditLead ? { leadUserId: teamLeadId || null } : {};
    try {
      if (editingTeam) {
        const res = await fetch(`${API}/teams/${editingTeam.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
          body: JSON.stringify({ name: teamName.trim(), description: teamDesc.trim() || null, ...leadPatch }),
        });
        const data = await res.json();
        if (!res.ok || data.ok === false) {
          setError(t('management.teamSaveFailed'));
          return;
        }
        setSuccess(t('management.teamUpdated', { name: teamName.trim() }));
      } else {
        const res = await fetch(`${API}/organizations/${orgId}/teams`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
          body: JSON.stringify({ name: teamName.trim(), description: teamDesc.trim() || null, ...leadPatch }),
        });
        const data = await res.json();
        if (!res.ok || data.ok === false) {
          setError(t('management.teamSaveFailed'));
          return;
        }
        setSuccess(t('management.teamCreated', { name: teamName.trim() }));
      }
      setTeamDialogOpen(false);
      await reloadTeams();
    } catch {
      setError(t('management.teamSaveFailed'));
    }
  }

  async function handleDeleteTeam(teamId: string) {
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`${API}/teams/${teamId}`, { method: 'DELETE', headers: await authHeaders() });
      const data = await res.json();
      if (!res.ok || data.ok === false) {
        setError(t('management.teamDeleteFailed'));
        return;
      }
      setTeams((prev) => prev.filter((tm) => tm.id !== teamId));
      setSuccess(t('management.teamDeleted'));
      if (selectedTeam?.id === teamId) setSelectedTeam(null);
    } catch {
      setError(t('management.teamDeleteFailed'));
    }
  }

  async function handleAddTeamMember() {
    if (!selectedTeam || !addMemberId) return;
    const member = members.find((m) => m.id === addMemberId || m.user_id === addMemberId);
    if (!member) return;
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`${API}/teams/${selectedTeam.id}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ membershipId: member.id }),
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) {
        setError(t('management.memberAddFailed'));
        return;
      }
      setAddMemberId('');
      setSuccess(t('management.memberAdded', { name: member.display_name, team: selectedTeam.name }));
      await Promise.all([loadTeamMembers(selectedTeam), reloadTeams()]);
    } catch {
      setError(t('management.memberAddFailed'));
    }
  }

  async function handleRemoveTeamMember(membershipId: string) {
    if (!selectedTeam) return;
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`${API}/teams/${selectedTeam.id}/members/${membershipId}`, {
        method: 'DELETE',
        headers: await authHeaders(),
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) {
        setError(t('management.memberRemoveFailed'));
        return;
      }
      setSuccess(t('management.memberRemoved'));
      await Promise.all([loadTeamMembers(selectedTeam), reloadTeams()]);
    } catch {
      setError(t('management.memberRemoveFailed'));
    }
  }

  function openCreateProject() {
    setEditingProject(null);
    setProjectName('');
    setProjectType('internal');
    setProjectCost('');
    setProjectOwner(session.userId);
    setProjectDialogOpen(true);
  }

  function openEditProject(proj: ProjectItem) {
    setEditingProject(proj);
    setProjectName(proj.name);
    setProjectType(proj.type);
    setProjectCost(proj.cost_item ?? '');
    setProjectOwner(proj.owner_user_id);
    setProjectDialogOpen(true);
  }

  async function handleSaveProject() {
    if (!projectName.trim()) return;
    setError(null);
    setSuccess(null);
    try {
      if (editingProject) {
        const res = await fetch(`${API}/projects/${editingProject.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
          body: JSON.stringify({
            name: projectName.trim(),
            type: projectType,
            costItem: projectCost.trim() || null,
            ownerUserId: projectOwner,
          }),
        });
        const data = await res.json();
        if (!res.ok || data.ok === false) {
          setError(t('management.projectSaveFailed'));
          return;
        }
        setSuccess(t('management.projectUpdated', { name: projectName.trim() }));
      } else {
        const res = await fetch(`${API}/organizations/${orgId}/projects`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
          body: JSON.stringify({
            name: projectName.trim(),
            type: projectType,
            costItem: projectCost.trim() || undefined,
            ownerUserId: projectOwner,
          }),
        });
        const data = await res.json();
        if (!res.ok || data.ok === false) {
          setError(t('management.projectSaveFailed'));
          return;
        }
        setSuccess(t('management.projectCreated', { name: projectName.trim() }));
      }
      setProjectDialogOpen(false);
      onDataChanged?.();
      await reloadProjects();
    } catch {
      setError(t('management.projectSaveFailed'));
    }
  }

  async function handleDeleteProject(pid: string) {
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`${API}/projects/${pid}`, { method: 'DELETE', headers: await authHeaders() });
      const data = await res.json();
      if (!res.ok || data.ok === false) {
        setError(t('management.projectDeleteFailed'));
        return;
      }
      setProjects((prev) => prev.filter((p) => p.id !== pid));
      setSubprojectsByProject((prev) => {
        const next = { ...prev };
        delete next[pid];
        return next;
      });
      if (expandedProjectId === pid) setExpandedProjectId(null);
      setSuccess(t('management.projectDeleted'));
      onDataChanged?.();
    } catch {
      setError(t('management.projectDeleteFailed'));
    }
  }

  function canManageSubprojects(project: ProjectItem): boolean {
    if (role === 'admin') return true;
    if (role === 'manager' && project.owner_user_id === session.userId) return true;
    return false;
  }

  function openCreateSubproject(project: ProjectItem) {
    setEditingSubproject(null);
    setSubprojectParentId(project.id);
    setSubprojectName('');
    setSubprojectType('phase');
    setSubprojectCost('');
    setSubprojectOwner(session.userId);
    setSubprojectDialogOpen(true);
  }

  function openEditSubproject(sub: SubprojectItem) {
    setEditingSubproject(sub);
    setSubprojectParentId(sub.project_id);
    setSubprojectName(sub.name);
    setSubprojectType(sub.type);
    setSubprojectCost(sub.cost_item ?? '');
    setSubprojectOwner(sub.owner_user_id);
    setSubprojectDialogOpen(true);
  }

  async function handleSaveSubproject() {
    if (!subprojectName.trim() || !subprojectParentId) return;
    setError(null);
    setSuccess(null);
    try {
      if (editingSubproject) {
        const res = await fetch(`${API}/subprojects/${editingSubproject.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
          body: JSON.stringify({
            name: subprojectName.trim(),
            type: subprojectType,
            costItem: subprojectCost.trim() || null,
            ownerUserId: subprojectOwner,
          }),
        });
        const data = await res.json();
        if (!res.ok || data.ok === false) {
          setError(t('management.subprojectSaveFailed'));
          return;
        }
        setSuccess(t('management.subprojectUpdated', { name: subprojectName.trim() }));
      } else {
        const res = await fetch(`${API}/projects/${subprojectParentId}/subprojects`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
          body: JSON.stringify({
            organizationId: orgId,
            name: subprojectName.trim(),
            type: subprojectType,
            costItem: subprojectCost.trim() || undefined,
            ownerUserId: subprojectOwner,
          }),
        });
        const data = await res.json();
        if (!res.ok || data.ok === false) {
          setError(t('management.subprojectSaveFailed'));
          return;
        }
        setSuccess(t('management.subprojectAdded', { name: subprojectName.trim() }));
      }
      setSubprojectDialogOpen(false);
      onDataChanged?.();
      await Promise.all([reloadSubprojects(subprojectParentId), reloadProjects()]);
    } catch {
      setError(t('management.subprojectSaveFailed'));
    }
  }

  async function handleDeleteSubproject(sub: SubprojectItem) {
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`${API}/subprojects/${sub.id}`, { method: 'DELETE', headers: await authHeaders() });
      const data = await res.json();
      if (!res.ok || data.ok === false) {
        setError(t('management.subprojectDeleteFailed'));
        return;
      }
      setSuccess(t('management.subprojectDeleted', { name: sub.name }));
      onDataChanged?.();
      await Promise.all([reloadSubprojects(sub.project_id), reloadProjects()]);
    } catch {
      setError(t('management.subprojectDeleteFailed'));
    }
  }

  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <PageHeader
        title={t('management.title')}
        subtitle={`${t('management.subtitle')}${role === 'manager' ? ` ${t('management.managerNote')}` : ''}`}
        end={
          <Chip
            label={role === 'admin' ? t('management.accessAdmin') : t('management.accessManager')}
            color={role === 'admin' ? 'secondary' : 'primary'}
            size="small"
            variant="outlined"
          />
        }
      />

      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
      {success && <Alert severity="success" onClose={() => setSuccess(null)}>{success}</Alert>}
      {loading && <LinearProgress />}

      <Paper sx={{ p: 2 }}>
        <Tabs value={tab} onChange={(_, v) => onTabChange(v)} sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
          <Tab value="teams" label={t('management.tabTeams', { count: teams.length })} />
          <Tab value="projects" label={t('management.tabProjects', { count: projects.length })} />
        </Tabs>

        {tab === 'teams' && (
          <Box>
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
              <Button variant="contained" size="small" startIcon={<AddIcon fontSize="small" />} onClick={openCreateTeam}>
                {t('management.createTeam')}
              </Button>
            </Box>

            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>{t('management.teamName')}</TableCell>
                    <TableCell>{t('management.description')}</TableCell>
                    <TableCell>{t('management.lead')}</TableCell>
                    <TableCell align="center">{t('management.members')}</TableCell>
                    <TableCell align="right">{t('common.actions')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {teams.map((team) => (
                    <TableRow key={team.id} hover>
                      <TableCell sx={{ fontWeight: 600 }}>{team.name}</TableCell>
                      <TableCell>{team.description ?? '—'}</TableCell>
                      <TableCell>
                        {team.lead_display_name ?? '—'}
                        {team.lead_user_id === session.userId && <Chip label={t('management.you')} size="small" color="success" sx={{ ml: 1 }} />}
                      </TableCell>
                      <TableCell align="center">
                        <Chip label={t('management.memberCount', { count: team.member_count ?? 0 })} size="small" />
                      </TableCell>
                      <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                        <Button size="small" variant="outlined" startIcon={<PeopleIcon fontSize="small" />} sx={{ mr: 0.5 }} onClick={() => void loadTeamMembers(team)}>
                          {t('management.members')}
                        </Button>
                        <Tooltip title={t('common.edit')}>
                          <IconButton size="small" aria-label={t('common.edit')} onClick={() => openEditTeam(team)}>
                            <EditIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title={t('common.delete')}>
                          <IconButton
                            size="small"
                            color="error"
                            aria-label={t('common.delete')}
                            onClick={() =>
                              setConfirmDialog({
                                title: t('management.deleteTeam'),
                                message: t('management.deleteTeamConfirm'),
                                onConfirm: () => handleDeleteTeam(team.id),
                              })
                            }
                          >
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </TableCell>
                    </TableRow>
                  ))}
                  {teams.length === 0 && !loading && (
                    <TableEmptyRow colSpan={5} icon={<PeopleIcon fontSize="inherit" />} title={t('management.noTeams')} />
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </Box>
        )}

        {tab === 'projects' && (
          <Box>
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
              <Button variant="contained" size="small" startIcon={<AddIcon fontSize="small" />} onClick={openCreateProject}>
                {t('management.createProject')}
              </Button>
            </Box>

            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>{t('management.projectName')}</TableCell>
                    <TableCell>{t('approvals.col.type')}</TableCell>
                    <TableCell>{t('management.costItem')}</TableCell>
                    <TableCell>{t('management.owner')}</TableCell>
                    <TableCell align="center">{t('management.subprojects')}</TableCell>
                    <TableCell align="right">{t('common.actions')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {projects.map((p) => {
                    const isExpanded = expandedProjectId === p.id;
                    const pSubprojects = subprojectsByProject[p.id];
                    const isOwner = p.owner_user_id === session.userId;
                    const subCount = pSubprojects ? pSubprojects.length : (p.subproject_count ?? 0);

                    return (
                      <TableRow key={p.id} hover selected={isExpanded}>
                        <TableCell sx={{ fontWeight: 600 }}>{p.name}</TableCell>
                        <TableCell>
                          <Chip
                            label={t(`management.projectType.${p.type}`)}
                            size="small"
                            color={p.type === 'customer' ? 'primary' : p.type === 'research' ? 'warning' : 'default'}
                          />
                        </TableCell>
                        <TableCell>{p.cost_item ?? '—'}</TableCell>
                        <TableCell>
                          {p.owner_name ?? p.owner_email ?? '—'}
                          {isOwner && <Chip label={t('management.you')} size="small" color="success" sx={{ ml: 1 }} />}
                        </TableCell>
                        <TableCell align="center">
                          <Button
                            size="small"
                            variant={isExpanded ? 'contained' : 'outlined'}
                            onClick={() => setExpandedProjectId(isExpanded ? null : p.id)}
                          >
                            {t('management.subprojectsCount', { count: subCount })}
                          </Button>
                        </TableCell>
                        <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                          <Tooltip title={t('common.edit')}>
                            <span>
                              <IconButton
                                size="small"
                                disabled={role !== 'admin' && !isOwner}
                                aria-label={t('common.edit')}
                                onClick={() => openEditProject(p)}
                              >
                                <EditIcon fontSize="small" />
                              </IconButton>
                            </span>
                          </Tooltip>
                          <Tooltip title={t('common.delete')}>
                            <span>
                              <IconButton
                                size="small"
                                color="error"
                                disabled={role !== 'admin' && !isOwner}
                                aria-label={t('common.delete')}
                                onClick={() =>
                                  setConfirmDialog({
                                    title: t('management.deleteProject'),
                                    message: t('management.deleteProjectConfirm'),
                                    onConfirm: () => handleDeleteProject(p.id),
                                  })
                                }
                              >
                                <DeleteIcon fontSize="small" />
                              </IconButton>
                            </span>
                          </Tooltip>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {projects.length === 0 && !loading && (
                    <TableEmptyRow colSpan={6} icon={<WorkspacesIcon fontSize="inherit" />} title={t('management.noProjects')} />
                  )}
                </TableBody>
              </Table>
            </TableContainer>

            {expandedProjectId && (() => {
              const currentProj = projects.find((p) => p.id === expandedProjectId);
              if (!currentProj) return null;
              const pSubs = subprojectsByProject[currentProj.id] ?? [];
              const canSub = canManageSubprojects(currentProj);

              return (
                <Box sx={{ mt: 3, p: 2, bgcolor: 'action.hover', borderRadius: 1 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1, flexWrap: 'wrap', gap: 1 }}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                      {t('management.subprojectsOf', { name: currentProj.name })}
                    </Typography>
                    <Button
                      variant="contained"
                      size="small"
                      disabled={!canSub}
                      startIcon={<AddIcon fontSize="small" />}
                      onClick={() => openCreateSubproject(currentProj)}
                    >
                      {t('management.addSubproject')}
                    </Button>
                  </Box>
                  {!canSub && (
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                      {t('management.subprojectsOwnerOnly')}
                    </Typography>
                  )}

                  <TableContainer sx={{ bgcolor: 'background.paper' }}>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>{t('management.subprojectName')}</TableCell>
                          <TableCell>{t('approvals.col.type')}</TableCell>
                          <TableCell>{t('management.costItem')}</TableCell>
                          <TableCell>{t('management.owner')}</TableCell>
                          <TableCell align="right">{t('common.actions')}</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {pSubs.map((s) => (
                          <TableRow key={s.id} hover>
                            <TableCell sx={{ fontWeight: 500 }}>{s.name}</TableCell>
                            <TableCell><Chip label={t(`management.subprojectType.${s.type}`)} size="small" variant="outlined" /></TableCell>
                            <TableCell>{s.cost_item ?? '—'}</TableCell>
                            <TableCell>
                              {s.owner_name ?? s.owner_email ?? '—'}
                              {s.owner_user_id === session.userId && <Chip label={t('management.you')} size="small" color="success" sx={{ ml: 1 }} />}
                            </TableCell>
                            <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                              <Tooltip title={t('common.edit')}>
                                <span>
                                  <IconButton size="small" disabled={!canSub} aria-label={t('common.edit')} onClick={() => openEditSubproject(s)}>
                                    <EditIcon fontSize="small" />
                                  </IconButton>
                                </span>
                              </Tooltip>
                              <Tooltip title={t('common.delete')}>
                                <span>
                                  <IconButton
                                    size="small"
                                    color="error"
                                    disabled={!canSub}
                                    aria-label={t('common.delete')}
                                    onClick={() =>
                                      setConfirmDialog({
                                        title: t('management.deleteSubproject'),
                                        message: t('management.deleteSubprojectConfirm', { name: s.name }),
                                        onConfirm: () => handleDeleteSubproject(s),
                                      })
                                    }
                                  >
                                    <DeleteIcon fontSize="small" />
                                  </IconButton>
                                </span>
                              </Tooltip>
                            </TableCell>
                          </TableRow>
                        ))}
                        {pSubs.length === 0 && (
                          <TableEmptyRow colSpan={5} icon={<WorkspacesIcon fontSize="inherit" />} title={t('management.noSubprojects')} />
                        )}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </Box>
              );
            })()}
          </Box>
        )}
      </Paper>

      <Dialog open={teamDialogOpen} onClose={() => setTeamDialogOpen(false)} fullWidth maxWidth="xs">
        <Box
          component="form"
          onSubmit={(e) => {
            e.preventDefault();
            void handleSaveTeam();
          }}
        >
          <DialogTitle>{editingTeam ? t('management.editTeam') : t('management.createTeam')}</DialogTitle>
          <DialogContent sx={{ display: 'grid', gap: 2, pt: 1 }}>
            <TextField label={t('management.teamName')} value={teamName} onChange={(e) => setTeamName(e.target.value)} size="small" required autoFocus sx={{ mt: 1 }} />
            <TextField label={t('management.description')} value={teamDesc} onChange={(e) => setTeamDesc(e.target.value)} size="small" multiline rows={2} />
            {canEditTeamLead(editingTeam) && (
              <TextField
                select
                label={t('management.teamLead')}
                value={teamLeadId}
                onChange={(e) => setTeamLeadId(e.target.value)}
                size="small"
                helperText={t('management.teamLeadHelper')}
              >
                <MenuItem value=""><em>{t('common.none')}</em></MenuItem>
                {members.map((m) => (<MenuItem key={m.user_id} value={m.user_id}>{m.display_name} ({m.email})</MenuItem>))}
              </TextField>
            )}
            {!editingTeam && !canEditTeamLead(editingTeam) && (
              <Typography variant="caption" color="text.secondary">{t('management.youWillBeLead')}</Typography>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setTeamDialogOpen(false)}>{t('common.cancel')}</Button>
            <Button type="submit" variant="contained" disabled={!teamName.trim()}>{t('common.save')}</Button>
          </DialogActions>
        </Box>
      </Dialog>

      <Dialog open={!!selectedTeam} onClose={() => setSelectedTeam(null)} fullWidth maxWidth="sm">
        <DialogTitle>{t('management.teamMembersOf', { name: selectedTeam?.name ?? '' })}</DialogTitle>
        <DialogContent sx={{ display: 'grid', gap: 2, pt: 1 }}>
          {selectedTeam?.description && (
            <Typography variant="body2" color="text.secondary">{selectedTeam.description}</Typography>
          )}
          {selectedTeam && !canManageTeamMembers(selectedTeam) && (
            <Typography variant="caption" color="text.secondary">
              {selectedTeam.lead_display_name
                ? t('management.membersLeadOnlyNamed', { name: selectedTeam.lead_display_name })
                : t('management.membersLeadOnly')}
            </Typography>
          )}

          <Typography variant="subtitle2">{t('management.currentMembers', { count: teamMembers.length })}</Typography>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t('teamHours.member')}</TableCell>
                  <TableCell align="right" />
                </TableRow>
              </TableHead>
              <TableBody>
                {teamMembers.map((tm) => (
                  <TableRow key={tm.membership_id}>
                    <TableCell>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>{tm.display_name}</Typography>
                      <Typography variant="caption" color="text.secondary">{tm.email}</Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Button
                        size="small"
                        color="error"
                        disabled={!selectedTeam || !canManageTeamMembers(selectedTeam)}
                        onClick={() => void handleRemoveTeamMember(tm.membership_id)}
                      >
                        {t('common.remove')}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {teamMembers.length === 0 && (
                  <TableRow><TableCell colSpan={2}>{t('teamHours.noMembers')}</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>

          {selectedTeam && canManageTeamMembers(selectedTeam) && (
            <Box sx={{ mt: 1, p: 2, bgcolor: 'action.hover', borderRadius: 1 }}>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>{t('management.addMember')}</Typography>
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                <TextField
                  select
                  label={t('management.selectMember')}
                  value={addMemberId}
                  onChange={(e) => setAddMemberId(e.target.value)}
                  size="small"
                  sx={{ minWidth: 200 }}
                >
                  <MenuItem value=""><em>{t('common.select')}</em></MenuItem>
                  {members
                    .filter((m) => !teamMembers.some((tm) => tm.membership_id === m.id || tm.user_id === m.user_id))
                    .map((m) => (
                      <MenuItem key={m.id} value={m.id}>{m.display_name} ({m.email})</MenuItem>
                    ))}
                </TextField>
                <Button variant="contained" size="small" disabled={!addMemberId} onClick={() => void handleAddTeamMember()}>
                  {t('common.add')}
                </Button>
              </Box>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSelectedTeam(null)}>{t('common.close')}</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={projectDialogOpen} onClose={() => setProjectDialogOpen(false)} fullWidth maxWidth="sm">
        <Box
          component="form"
          onSubmit={(e) => {
            e.preventDefault();
            void handleSaveProject();
          }}
        >
          <DialogTitle>{editingProject ? t('management.editProject') : t('management.createProject')}</DialogTitle>
          <DialogContent sx={{ display: 'grid', gap: 2, pt: 1 }}>
            <TextField label={t('management.projectName')} value={projectName} onChange={(e) => setProjectName(e.target.value)} size="small" required autoFocus sx={{ mt: 1 }} />
            <TextField select label={t('approvals.col.type')} value={projectType} onChange={(e) => setProjectType(e.target.value as ProjectItem['type'])} size="small">
              <MenuItem value="internal">{t('management.projectType.internal')}</MenuItem>
              <MenuItem value="customer">{t('management.projectType.customer')}</MenuItem>
              <MenuItem value="research">{t('management.projectType.research')}</MenuItem>
            </TextField>
            <TextField label={t('management.costItem')} value={projectCost} onChange={(e) => setProjectCost(e.target.value)} size="small" placeholder={t('management.costItemPlaceholder', { example: 'COST-101' })} />
            <TextField select label={t('management.projectOwner')} value={projectOwner} onChange={(e) => setProjectOwner(e.target.value)} size="small">
              {members.map((m) => (
                <MenuItem key={m.user_id} value={m.user_id}>
                  {m.display_name} ({m.email}) {m.user_id === session.userId ? `(${t('management.you')})` : ''}
                </MenuItem>
              ))}
            </TextField>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setProjectDialogOpen(false)}>{t('common.cancel')}</Button>
            <Button type="submit" variant="contained" disabled={!projectName.trim()}>{t('common.save')}</Button>
          </DialogActions>
        </Box>
      </Dialog>

      <Dialog open={subprojectDialogOpen} onClose={() => setSubprojectDialogOpen(false)} fullWidth maxWidth="sm">
        <Box
          component="form"
          onSubmit={(e) => {
            e.preventDefault();
            void handleSaveSubproject();
          }}
        >
          <DialogTitle>{editingSubproject ? t('management.editSubproject') : t('management.addSubproject')}</DialogTitle>
          <DialogContent sx={{ display: 'grid', gap: 2, pt: 1 }}>
            <TextField label={t('management.subprojectName')} value={subprojectName} onChange={(e) => setSubprojectName(e.target.value)} size="small" required autoFocus sx={{ mt: 1 }} />
            <TextField select label={t('approvals.col.type')} value={subprojectType} onChange={(e) => setSubprojectType(e.target.value as SubprojectItem['type'])} size="small">
              <MenuItem value="phase">{t('management.subprojectType.phase')}</MenuItem>
              <MenuItem value="work_package">{t('management.subprojectType.work_package')}</MenuItem>
              <MenuItem value="task">{t('management.subprojectType.task')}</MenuItem>
            </TextField>
            <TextField label={t('management.costItem')} value={subprojectCost} onChange={(e) => setSubprojectCost(e.target.value)} size="small" placeholder={t('management.costItemPlaceholder', { example: 'COST-102' })} />
            <TextField select label={t('management.subprojectOwner')} value={subprojectOwner} onChange={(e) => setSubprojectOwner(e.target.value)} size="small">
              {members.map((m) => (
                <MenuItem key={m.user_id} value={m.user_id}>
                  {m.display_name} ({m.email}) {m.user_id === session.userId ? `(${t('management.you')})` : ''}
                </MenuItem>
              ))}
            </TextField>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setSubprojectDialogOpen(false)}>{t('common.cancel')}</Button>
            <Button type="submit" variant="contained" disabled={!subprojectName.trim()}>{t('common.save')}</Button>
          </DialogActions>
        </Box>
      </Dialog>

      <ConfirmDialog
        open={!!confirmDialog}
        title={confirmDialog?.title ?? t('app.confirm')}
        message={confirmDialog?.message ?? ''}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        onClose={() => setConfirmDialog(null)}
        onConfirm={() => {
          if (confirmDialog) return confirmDialog.onConfirm();
        }}
      />
    </Box>
  );
}
