import type { ReactNode } from 'react';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  TableCell,
  TableRow,
  Typography,
} from '@mui/material';

/** Consistent top-of-page header with title, optional subtitle, and right-aligned badges/actions. */
export function PageHeader({
  title,
  subtitle,
  end,
}: {
  title: string;
  subtitle?: string;
  end?: ReactNode;
}) {
  return (
    <Box
      sx={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        gap: 2,
        flexWrap: 'wrap',
        mb: 0.5,
      }}
    >
      <Box>
        <Typography variant="h5" component="h1" sx={{ fontSize: { xs: '1.25rem', sm: '1.4rem' } }}>
          {title}
        </Typography>
        {subtitle && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
            {subtitle}
          </Typography>
        )}
      </Box>
      {end && <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>{end}</Box>}
    </Box>
  );
}

/** Shared confirmation modal so destructive actions are always confirmed cleanly. */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
  confirmColor = 'error',
  onClose,
  onConfirm,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  confirmColor?: 'error' | 'primary' | 'warning';
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
}) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <DialogContentText>{message}</DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{cancelLabel}</Button>
        <Button
          color={confirmColor}
          variant="contained"
          onClick={async () => {
            onClose();
            await onConfirm();
          }}
        >
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** Centered empty-state box for empty lists and tables. */
export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <Box
      sx={{
        py: 4,
        px: 2,
        textAlign: 'center',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 1,
        color: 'text.secondary',
      }}
    >
      {icon && <Box sx={{ color: 'text.disabled', fontSize: 36, lineHeight: 0 }}>{icon}</Box>}
      <Typography variant="body2" sx={{ fontWeight: 600, color: 'text.primary' }}>
        {title}
      </Typography>
      {description && (
        <Typography variant="caption" color="text.secondary" sx={{ maxWidth: 420 }}>
          {description}
        </Typography>
      )}
      {action && <Box sx={{ mt: 0.5 }}>{action}</Box>}
    </Box>
  );
}

/** Table-row wrapper around EmptyState so empty tables look clean and centered. */
export function TableEmptyRow({
  colSpan,
  icon,
  title,
  description,
  action,
}: {
  colSpan: number;
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan} sx={{ borderBottom: 'none' }}>
        <EmptyState icon={icon} title={title} description={description} action={action} />
      </TableCell>
    </TableRow>
  );
}
