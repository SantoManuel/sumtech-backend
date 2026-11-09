export const GENIEACS_WEBHOOK_QUEUE = 'genieacs-webhook';

export const GENIEACS_WEBHOOK_JOBS = {
  DEVICE_EVENT: 'device-event',
} as const;

export const GENIEACS_EVENTS = {
  BOOTSTRAP_COMPLETE: 'genieacs.device.bootstrap',
  PLAN_APPLIED: 'genieacs.device.plan_applied',
  OPTICAL_ALARM: 'genieacs.device.optical_alarm',
  FIRMWARE_TRIGGERED: 'genieacs.device.firmware_triggered',
} as const;

