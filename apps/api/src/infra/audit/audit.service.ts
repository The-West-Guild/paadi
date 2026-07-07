import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "@paadi/db";
import { CryptoService } from "../../common/crypto/crypto.service";

export interface AuditEventInput {
  eventType: string;
  actorId?: string;
  targetId?: string;
  /** Metadata only — never request bodies (they can carry PINs) and never secrets. */
  payload?: Record<string, unknown>;
}

/**
 * Hash-chained writer for the AuditEvent model. Each row's previousHash is the
 * payloadHash of the true predecessor: writers serialize on a Postgres
 * advisory transaction lock, so the chain is linear and verifiable by
 * replaying rows in sequence order and asserting
 * `row.previousHash === prior.payloadHash`.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService
  ) {}

  async record(event: AuditEventInput): Promise<void> {
    const payloadHash = this.crypto.sha256(
      JSON.stringify({
        eventType: event.eventType,
        actorId: event.actorId ?? null,
        targetId: event.targetId ?? null,
        payload: event.payload ?? null,
        at: new Date().toISOString()
      })
    );

    await this.prisma.$transaction(async (tx) => {
      // Serializes read-prior → insert across concurrent writers; the lock is
      // held only for this transaction, so contention is a queue, not a fail.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('audit_chain'))`;
      const prior = await tx.auditEvent.findFirst({
        orderBy: { sequence: "desc" },
        select: { payloadHash: true }
      });
      await tx.auditEvent.create({
        data: {
          eventType: event.eventType,
          actorId: event.actorId,
          targetId: event.targetId,
          payloadHash,
          previousHash: prior?.payloadHash
        }
      });
    });
  }

  /** Best-effort variant for money paths — an audit failure must never block a payment. */
  async recordSafe(event: AuditEventInput): Promise<void> {
    try {
      await this.record(event);
    } catch (err) {
      this.logger.error(`audit write failed for ${event.eventType}`, err instanceof Error ? err.stack : err);
    }
  }
}
