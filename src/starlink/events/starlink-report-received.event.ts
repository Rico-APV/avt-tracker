import { StarlinkReport } from '../entities/starlink-report.entity';
import { ParsedStarlinkFrame } from '../parser/starlink-parser.types';

export class StarlinkReportReceivedEvent {
  constructor(
    public readonly deviceId: string,
    public readonly parsed: ParsedStarlinkFrame,
    public readonly saved: StarlinkReport,
  ) {}
}
