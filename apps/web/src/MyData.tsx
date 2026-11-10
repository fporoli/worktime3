import { Box } from '@mui/material';
import { BasicDataPanel, ReviewQueue } from './BasicDataPanel';

export interface MyDataProps {
  orgId: string;
  userId: string;
  authHeaders: () => Promise<Record<string, string>>;
  onReviewResolved?: () => void;
}

/** Personal basic data page + HR change-request review queue. */
export default function MyData({ orgId, userId, authHeaders, onReviewResolved }: MyDataProps) {
  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <BasicDataPanel orgId={orgId} userId={userId} isSelf authHeaders={authHeaders} />
      <ReviewQueue orgId={orgId} authHeaders={authHeaders} onResolved={onReviewResolved} />
    </Box>
  );
}
