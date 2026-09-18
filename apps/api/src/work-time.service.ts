import { Injectable } from '@nestjs/common';
import { bucket, minutesOf, type TimeRange } from './time-bucket.util';

export type WorkTimeInput = TimeRange;

/** Pure aggregation helpers: daily / weekly / monthly buckets for the UI. */
@Injectable()
export class WorkTimeService {
  minutesOf(entries: WorkTimeInput[]): number {
    return minutesOf(entries);
  }

  bucket(entries: WorkTimeInput[], mode: 'daily' | 'weekly' | 'monthly'): Record<string, number> {
    return bucket(entries, mode);
  }
}
