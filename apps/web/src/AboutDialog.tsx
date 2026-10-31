import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import type { Session } from './Login';
import { useI18n } from './i18n';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';

interface Build {
  release: string | null;
  commit: string | null;
  date: string | null;
}

interface AboutInfo {
  build: Build;
  server: {
    hostname: string;
    environment: string | null;
    nodeVersion: string;
    timeZone: string;
    startedAt: string;
    time: string;
  };
  database: { status: string; lastChangeset: string | null };
}

/** Baked in at image build time (see apps/web/Dockerfile) — empty or unset on a local build. */
const WEB_BUILD: Build = {
  release: import.meta.env.VITE_BUILD_RELEASE || null,
  commit: import.meta.env.VITE_BUILD_COMMIT || null,
  date: import.meta.env.VITE_BUILD_DATE || null,
};

interface AboutDialogProps {
  open: boolean;
  onClose: () => void;
  session: Session;
  authHeaders: () => Promise<Record<string, string>>;
  currentOrgId: string | null;
  /** The admin's own session while they are impersonating `session`. */
  adminSession: Session | null;
}

export default function AboutDialog({ open, onClose, session, authHeaders, currentOrgId, adminSession }: AboutDialogProps) {
  const { t, locale } = useI18n();
  const [info, setInfo] = useState<AboutInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setInfo(null);
    setError(null);
    (async () => {
      try {
        const res = await fetch(`${API}/about`, { headers: await authHeaders() });
        const data = await res.json();
        if (cancelled) return;
        if (data.ok) setInfo(data);
        else setError(t('about.loadError', { error: data.error ?? data.message ?? res.status }));
      } catch {
        if (!cancelled) setError(t('about.unreachable'));
      }
    })();
    return () => {
      cancelled = true;
    };
    // Once per opening: authHeaders is a new function on every App render, and a notification
    // arriving must not blank a dialog someone is reading.
  }, [open]);

  const formatDate = (value: string | null | undefined) => (value ? new Date(value).toLocaleString(locale) : '—');
  const releaseLabel = (build: Build) => build.release ?? t(build.commit ? 'about.untagged' : 'about.localBuild');
  const shortCommit = (build: Build) => build.commit?.slice(0, 7) ?? '—';

  const membership = session.memberships.find((m) => m.organizationId === currentOrgId);
  const databaseStatus = info ? t(`about.database.${info.database.status}`) : '—';

  const serverRows: [string, string][] = [
    [t('about.apiUrl'), API],
    [t('about.hostname'), info?.server.hostname ?? '—'],
    [t('about.environment'), info?.server.environment ?? '—'],
    [t('about.nodeVersion'), info?.server.nodeVersion ?? '—'],
    [t('about.startedAt'), formatDate(info?.server.startedAt)],
    [t('about.serverTime'), formatDate(info?.server.time)],
    [t('about.timeZone'), info?.server.timeZone ?? '—'],
    [t('about.database'), databaseStatus],
    [t('about.lastChangeset'), info?.database.lastChangeset ?? '—'],
  ];

  const userRows: [string, string][] = [
    [t('about.name'), session.displayName],
    [t('about.email'), session.email],
    [t('about.userId'), session.userId],
    [t('about.organization'), membership?.name ?? '—'],
    [t('about.roles'), membership?.roles.join(', ') || '—'],
    [t('about.signIn'), t(session.sso ? 'about.signInSso' : 'about.signInPassword')],
    ...(adminSession ? [[t('about.impersonatedBy'), `${adminSession.displayName} (${adminSession.email})`] as [string, string]] : []),
  ];

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{t('about.title')}</DialogTitle>
      <DialogContent sx={{ display: 'grid', gap: 2 }}>
        {error && <Alert severity="error">{error}</Alert>}

        <section>
          <Typography variant="subtitle2" gutterBottom>{t('about.software')}</Typography>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell />
                <TableCell>{t('about.web')}</TableCell>
                <TableCell>{t('about.api')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              <TableRow>
                <TableCell component="th" scope="row">{t('about.release')}</TableCell>
                <TableCell>{releaseLabel(WEB_BUILD)}</TableCell>
                <TableCell>{info ? releaseLabel(info.build) : '—'}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell component="th" scope="row">{t('about.commit')}</TableCell>
                <TableCell>{shortCommit(WEB_BUILD)}</TableCell>
                <TableCell>{info ? shortCommit(info.build) : '—'}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell component="th" scope="row">{t('about.date')}</TableCell>
                <TableCell>{formatDate(WEB_BUILD.date)}</TableCell>
                <TableCell>{formatDate(info?.build.date)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </section>

        {[
          { title: t('about.server'), rows: serverRows },
          { title: t('about.user'), rows: userRows },
        ].map(({ title, rows }) => (
          <section key={title}>
            <Typography variant="subtitle2" gutterBottom>{title}</Typography>
            <Table size="small">
              <TableBody>
                {rows.map(([label, value]) => (
                  <TableRow key={label}>
                    <TableCell component="th" scope="row" sx={{ width: '40%' }}>{label}</TableCell>
                    <TableCell sx={{ overflowWrap: 'anywhere' }}>{value}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </section>
        ))}
      </DialogContent>
      <DialogActions><Button onClick={onClose}>{t('about.close')}</Button></DialogActions>
    </Dialog>
  );
}
