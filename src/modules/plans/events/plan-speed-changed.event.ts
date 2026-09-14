export class PlanSpeedChangedEvent {
  planId: string;
  planName: string;
  oldSpeedMbps: number;
  newSpeedMbps: number;
  occurredOn: Date;
}
