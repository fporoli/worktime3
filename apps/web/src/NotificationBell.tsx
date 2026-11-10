import { useState } from 'react';
import { Badge, Box, Button, Divider, IconButton, Menu, MenuItem, Snackbar, Typography } from '@mui/material';
import { useI18n } from './i18n';
import { NotificationsIcon } from './icons';
import { formatRelativeTime } from './localeFormat';
import type { Notification } from './useNotifications';

interface NotificationBellProps {
  items: Notification[];
  unreadCount: number;
  live: Notification | null;
  clearLive: () => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
  onItemClick: (notification: Notification) => void;
}

export default function NotificationBell({ items, unreadCount, live, clearLive, markRead, markAllRead, onItemClick }: NotificationBellProps) {
  const { t, locale } = useI18n();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);

  function openItem(n: Notification) {
    if (!n.read_at) markRead(n.id);
    setAnchorEl(null);
    onItemClick(n);
  }

  return (
    <>
      <IconButton color="inherit" onClick={(e) => setAnchorEl(e.currentTarget)} aria-label={t('notifications.ariaLabel')} aria-haspopup="menu">
        <Badge badgeContent={unreadCount} color="error" max={99}>
          <NotificationsIcon fontSize="small" />
        </Badge>
      </IconButton>

      <Menu
        anchorEl={anchorEl}
        open={!!anchorEl}
        onClose={() => setAnchorEl(null)}
        slotProps={{ paper: { sx: { width: 340, maxWidth: '92vw' } } }}
      >
        <Box sx={{ px: 2, py: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>{t('notifications.title')}</Typography>
          {unreadCount > 0 && (
            <Button size="small" onClick={markAllRead}>{t('notifications.markAllRead')}</Button>
          )}
        </Box>
        <Divider />
        <Box sx={{ maxHeight: 380, overflowY: 'auto' }}>
          {items.length === 0 && (
            <Box sx={{ px: 2, py: 3, textAlign: 'center' }}>
              <Typography variant="body2" color="text.secondary">{t('notifications.empty')}</Typography>
            </Box>
          )}
          {items.map((n) => (
            <MenuItem
              key={n.id}
              onClick={() => openItem(n)}
              sx={{
                whiteSpace: 'normal',
                alignItems: 'flex-start',
                py: 1.25,
                gap: 1.25,
                bgcolor: n.read_at ? 'transparent' : 'action.hover',
              }}
            >
              <Box
                sx={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  bgcolor: n.read_at ? 'transparent' : 'primary.main',
                  mt: 0.85,
                  flexShrink: 0,
                }}
              />
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography variant="body2" sx={{ fontWeight: n.read_at ? 400 : 700 }}>{n.title}</Typography>
                {n.body && <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{n.body}</Typography>}
                <Typography variant="caption" color="text.disabled" sx={{ display: 'block', mt: 0.25 }}>
                  {formatRelativeTime(n.created_at, locale)}
                </Typography>
              </Box>
            </MenuItem>
          ))}
        </Box>
      </Menu>

      <Snackbar
        open={!!live}
        autoHideDuration={6000}
        onClose={clearLive}
        message={live?.title}
        action={
          live && (
            <Button color="inherit" size="small" onClick={() => { openItem(live); clearLive(); }}>
              {t('notifications.viewAction')}
            </Button>
          )
        }
      />
    </>
  );
}
