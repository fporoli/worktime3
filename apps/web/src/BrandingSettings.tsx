import { useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, IconButton, Paper, Tooltip, Typography } from '@mui/material';
import { darken } from '@mui/material/styles';
import {
  BRANDING_COLOR_KEYS,
  LOGO_MIME_TYPES,
  MAX_LOGO_DATA_URL_LENGTH,
  contrastTextColor,
  isDarkColor,
  validateBranding,
  type BrandingColorKey,
  type OrgBranding,
} from '@worktime3/shared/branding';
import { useT } from './i18n';
import { DEFAULT_BRANDING_COLORS, useBranding } from './theme';
import { CloseIcon } from './icons';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';

/** Raster logos are scaled into this box before upload: enough for the 36px header at 3x. */
const LOGO_MAX_WIDTH = 420;
const LOGO_MAX_HEIGHT = 108;

const COLOR_LABELS: Record<BrandingColorKey, string> = {
  headerColor: 'branding.headerColor',
  backgroundColor: 'branding.backgroundColor',
  sidebarColor: 'branding.sidebarColor',
};

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/**
 * The file as a logo data URL: SVG as is, raster images scaled down into the logo box (never
 * up) and re-encoded as PNG, or WebP when the PNG is still too large.
 */
async function logoDataUrl(file: File): Promise<string> {
  if (!LOGO_MIME_TYPES.includes(file.type)) throw new Error('invalid-logo');
  const original = await readAsDataUrl(file);
  if (file.type === 'image/svg+xml') return original;
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('invalid-logo'));
    img.src = original;
  });
  const scale = Math.min(1, LOGO_MAX_WIDTH / img.naturalWidth, LOGO_MAX_HEIGHT / img.naturalHeight);
  if (scale === 1 && original.length <= MAX_LOGO_DATA_URL_LENGTH) return original;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height);
  const png = canvas.toDataURL('image/png');
  return png.length <= MAX_LOGO_DATA_URL_LENGTH ? png : canvas.toDataURL('image/webp', 0.85);
}

interface BrandingSettingsProps {
  orgId: string;
  authHeaders: () => Promise<Record<string, string>>;
}

/**
 * Organization settings' Look and feel card: header, page and sidebar colors and a logo,
 * with a small preview. Saved branding is applied to the whole app at once.
 */
export default function BrandingSettings({ orgId, authHeaders }: BrandingSettingsProps) {
  const t = useT();
  const { setBranding: applyBranding } = useBranding();
  const [draft, setDraft] = useState<OrgBranding>({});
  const [saved, setSaved] = useState<OrgBranding>({});
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    setDraft({});
    setSaved({});
    (async () => {
      try {
        const res = await fetch(`${API}/organizations/${orgId}/branding`, { headers: await authHeaders() });
        const data = await res.json();
        if (!cancelled && data?.ok && data.branding) {
          setDraft(data.branding);
          setSaved(data.branding);
        }
      } catch { /* offline: defaults */ }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  function errorMessage(code: string | undefined): string {
    if (code === 'forbidden') return t('branding.forbidden');
    if (code === 'invalid-color') return t('branding.invalidColor');
    if (code === 'invalid-logo') return t('branding.invalidLogo');
    if (code === 'logo-too-large') return t('branding.logoTooLarge');
    return t('branding.saveFailed');
  }

  function setColor(key: BrandingColorKey, value: string | undefined) {
    setSuccess(null);
    setDraft((prev) => {
      const next = { ...prev };
      if (value) next[key] = value;
      else delete next[key];
      return next;
    });
  }

  async function pickLogo(file: File | undefined) {
    if (!file) return;
    setError(null);
    setSuccess(null);
    try {
      const logo = await logoDataUrl(file);
      const check = validateBranding({ logo });
      if (!check.ok) {
        setError(errorMessage(check.error));
        return;
      }
      setDraft((prev) => ({ ...prev, logo }));
    } catch {
      setError(errorMessage('invalid-logo'));
    }
  }

  async function save() {
    setError(null);
    setSuccess(null);
    setBusy(true);
    try {
      const res = await fetch(`${API}/organizations/${orgId}/branding`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify(draft),
      });
      const data = await res.json();
      if (!data?.ok) {
        setError(errorMessage(data?.error));
        return;
      }
      const branding: OrgBranding = data.branding ?? draft;
      setDraft(branding);
      setSaved(branding);
      applyBranding(branding);
      setSuccess(t('branding.saved'));
    } catch {
      setError(t('branding.saveFailed'));
    } finally {
      setBusy(false);
    }
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const header = draft.headerColor ?? DEFAULT_BRANDING_COLORS.headerColor;
  const page = draft.backgroundColor ?? DEFAULT_BRANDING_COLORS.backgroundColor;
  const sidebar = draft.sidebarColor ?? DEFAULT_BRANDING_COLORS.sidebarColor;
  const sidebarText = isDarkColor(sidebar) ? contrastTextColor(sidebar) : undefined;

  return (
    <Paper sx={{ p: 2 }}>
      <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>{t('branding.title')}</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>{t('branding.subtitle')}</Typography>

      {error && <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 1.5 }}>{error}</Alert>}
      {success && <Alert severity="success" onClose={() => setSuccess(null)} sx={{ mb: 1.5 }}>{success}</Alert>}

      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: 'minmax(260px, 1fr) minmax(280px, 1.2fr)' } }}>
        <Box sx={{ display: 'grid', gap: 1.5, alignContent: 'start' }}>
          {BRANDING_COLOR_KEYS.map((key) => {
            const value = draft[key];
            return (
              <Box key={key} sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                <Box
                  component="input"
                  type="color"
                  aria-label={t(COLOR_LABELS[key])}
                  value={value ?? DEFAULT_BRANDING_COLORS[key]}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setColor(key, e.target.value.toLowerCase())}
                  sx={{ width: 44, height: 32, p: 0, border: 1, borderColor: 'divider', borderRadius: 1, bgcolor: 'transparent', cursor: 'pointer' }}
                />
                <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>{t(COLOR_LABELS[key])}</Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
                    {value ?? `${t('branding.default')} (${DEFAULT_BRANDING_COLORS[key]})`}
                  </Typography>
                </Box>
                {value && (
                  <Tooltip title={t('branding.resetColor')}>
                    <IconButton size="small" onClick={() => setColor(key, undefined)} aria-label={t('branding.resetColor')}>
                      <CloseIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                )}
              </Box>
            );
          })}

          <Box>
            <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>{t('branding.logo')}</Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
              <Button variant="outlined" size="small" onClick={() => fileInput.current?.click()}>{t('branding.uploadLogo')}</Button>
              {draft.logo && (
                <Button
                  size="small"
                  color="inherit"
                  onClick={() => {
                    setSuccess(null);
                    setDraft(({ logo: _logo, ...rest }) => rest);
                  }}
                >
                  {t('common.remove')}
                </Button>
              )}
              <input
                ref={fileInput}
                type="file"
                accept={LOGO_MIME_TYPES.join(',')}
                hidden
                onChange={(e) => {
                  void pickLogo(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
              {draft.logo ? t('branding.logoHelper') : `${t('branding.noLogo')} ${t('branding.logoHelper')}`}
            </Typography>
          </Box>
        </Box>

        <Box>
          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            {t('branding.preview')}
          </Typography>
          <Box sx={{ mt: 0.5, border: 1, borderColor: 'divider', borderRadius: 1.5, overflow: 'hidden' }} aria-hidden>
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                px: 1.5,
                height: 48,
                backgroundImage: `linear-gradient(135deg, ${header} 0%, ${darken(header, 0.2)} 100%)`,
                color: contrastTextColor(header),
              }}
            >
              {draft.logo ? (
                <Box component="img" src={draft.logo} alt="" sx={{ height: 30, maxWidth: 120, objectFit: 'contain', borderRadius: '4px' }} />
              ) : (
                <Box sx={{ width: 24, height: 24, borderRadius: '6px', bgcolor: 'rgba(255,255,255,0.18)', display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: '0.8rem' }}>W</Box>
              )}
              <Typography sx={{ fontWeight: 700 }}>{t('appbar.title')}</Typography>
            </Box>
            <Box sx={{ display: 'flex', height: 120 }}>
              <Box sx={{ width: 96, bgcolor: sidebar, color: sidebarText ?? 'text.primary', borderRight: 1, borderColor: 'divider', p: 1, display: 'grid', gap: 0.75, alignContent: 'start' }}>
                {[0.9, 0.7, 0.8].map((w, i) => (
                  <Box key={i} sx={{ height: 8, width: `${w * 100}%`, borderRadius: 1, bgcolor: 'currentColor', opacity: i === 0 ? 0.55 : 0.25 }} />
                ))}
              </Box>
              <Box sx={{ flexGrow: 1, bgcolor: page, p: 1.25 }}>
                <Typography variant="caption" sx={{ fontWeight: 700, color: isDarkColor(page) ? '#ffffff' : 'text.primary' }}>
                  {t('branding.previewPage')}
                </Typography>
                <Box sx={{ mt: 0.75, height: 64, bgcolor: '#ffffff', borderRadius: 1, boxShadow: '0 1px 3px rgba(16,24,40,0.12)' }} />
              </Box>
            </Box>
          </Box>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }}>{t('branding.lightOnly')}</Typography>
          {isDarkColor(page) && (
            <Alert severity="warning" sx={{ mt: 1 }}>{t('branding.lowContrast')}</Alert>
          )}
        </Box>
      </Box>

      <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end', mt: 2 }}>
        <Button
          color="inherit"
          disabled={busy || Object.keys(draft).length === 0}
          onClick={() => {
            setSuccess(null);
            setDraft({});
          }}
        >
          {t('branding.resetAll')}
        </Button>
        <Button variant="contained" disabled={busy || !dirty} onClick={() => void save()}>{t('common.save')}</Button>
      </Box>
    </Paper>
  );
}
