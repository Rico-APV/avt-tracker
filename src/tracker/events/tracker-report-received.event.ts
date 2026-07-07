import { TrackerReport } from '../entities/tracker-report.entity';
import { ParsedTrackerFrame } from '../parser/tracker-parser.types';

export class TrackerReportReceivedEvent {
  constructor(
    public readonly imei: string,
    public readonly parsed: ParsedTrackerFrame,
    public readonly saved: TrackerReport,
  ) {}
}
