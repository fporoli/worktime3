import { Box } from '@mui/material';
import { BasicDataPanel, ReviewQueue } from './BasicDataPanel';
import WorkSchedulePanel from './WorkSchedulePanel';

export interface MyDataProps {
  orgId: string;
  userId: string;
  authHeaders: () => Promise<Record<string, string>>;
  onReviewResolved?: () => void;
  /** The caller may see their own work schedule (section.workTime.schedule). */
  showWorkSchedule?: boolean;
}

/** Personal basic data page + HR change-request review queue. */
export default function MyData({ orgId, userId, authHeaders, onReviewResolved, showWorkSchedule = true }: MyDataProps) {
  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <BasicDataPanel orgId={orgId} userId={userId} isSelf authHeaders={authHeaders} />
      {showWorkSchedule && <WorkSchedulePanel orgId={orgId} userId={userId} authHeaders={authHeaders} />}
      <ReviewQueue orgId={orgId} authHeaders={authHeaders} onResolved={onReviewResolved} />
    </Box>
  );
}
