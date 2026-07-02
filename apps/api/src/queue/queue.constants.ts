import { DefaultJobOptions } from "bullmq";

export const QUEUES = {
  settlement: "settlement",
  payoutConfirm: "payout-confirm",
  reconciliation: "reconciliation",
  outbox: "outbox",
  deadlineSweep: "deadline-sweep",
  nudge: "nudge",
  ingestion: "ingestion",
  vaProvisioning: "va-provisioning",
  webhookRetry: "webhook-retry"
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export const DEFAULT_JOB_OPTIONS: DefaultJobOptions = {
  attempts: 3,
  backoff: { type: "exponential", delay: 1000 },
  removeOnComplete: true
};

export const OUTBOX_DRAIN_SCHEDULER_ID = "outbox-drain";
export const RECONCILIATION_SWEEP_SCHEDULER_ID = "reconciliation-sweep";
export const DEADLINE_SWEEP_SCHEDULER_ID = "deadline-sweep";
export const NUDGE_CREATED_DELAY_SCHEDULER_ID = "nudge-created-delay-sweep";
export const NUDGE_DEADLINE_WINDOW_SCHEDULER_ID = "nudge-deadline-window-sweep";
export const WEBHOOK_RETRY_SWEEP_SCHEDULER_ID = "webhook-retry-sweep";
export const OUTBOX_DRAIN_EVERY_MS = 10_000;
export const RECONCILIATION_SWEEP_EVERY_MS = 60_000;
export const DEADLINE_SWEEP_EVERY_MS = 60_000;
export const WEBHOOK_RETRY_SWEEP_EVERY_MS = 60_000;
export const NUDGE_SWEEP_EVERY_MS = 15 * 60_000;
