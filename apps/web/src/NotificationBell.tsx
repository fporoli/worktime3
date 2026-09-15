import { useState } from 'react';
import { Badge, Box, Button, Divider, IconButton, Menu, MenuItem, Snackbar, Typography } from '@mui/material';
import { useT } from './i18n';
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
  const t = useT();
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
          <Box component="span" sx={{ fontSize: 20 }}>🔔</Box>
        </Badge>
      </IconButton>

      <Menu anchorEl={anchorEl} open={!!anchorEl} onClose={() => setAnchorEl(null)}>
        <Box sx={{ px: 2, py: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, minWidth: 280 }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>{t('notifications.title')}</Typography>
          {unreadCount > 0 && (
            <Button size="small" onClick={markAllRead}>{t('notifications.markAllRead')}</Button>
          )}
        </Box>
        <Divider />
        {items.length === 0 && (
          <Box sx={{ px: 2, py: 2 }}>
            <Typography variant="body2" color="text.secondary">{t('notifications.empty')}</Typography>
          </Box>
        )}
        {items.map((n) => (
          <MenuItem key={n.id} onClick={() => openItem(n)} sx={{ whiteSpace: 'normal', alignItems: 'flex-start', py: 1 }}>
            <Box>
              <Typography variant="body2" sx={{ fontWeight: n.read_at ? 400 : 700 }}>{n.title}</Typography>
              {n.body && <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{n.body}</Typography>}
            </Box>
          </MenuItem>
        ))}
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
