import { SetMetadata } from "@nestjs/common";

export const AUDITED_EVENT = "auditedEvent";

/**
 * Marks a route for audit-trail capture. The AuditInterceptor records a
 * hash-chained AuditEvent on success when the caller is an API-key principal —
 * machine-driven money movement is always attributable.
 */
export const Audited = (eventType: string) => SetMetadata(AUDITED_EVENT, eventType);
