import { ExecutionContext, ForbiddenException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Reflector } from "@nestjs/core";
import { randomUUID } from "node:crypto";
import { ExceptionReason } from "@paadi/contracts";
import { buildSuspensePosting } from "@paadi/domain";
import { PrismaService } from "@paadi/db";
import { AdminGuard } from "../../common/guards/admin.guard";
import { AdminOnly } from "../../common/decorators/admin-only.decorator";
import { RaiseExceptionService } from "../../modules/reconciliation/raise-exception.service";
import { PrismaLedgerRepository } from "./ledger.repository";
import { PrismaOutboxRepository } from "./outbox.repository";
import { ReconciliationRepository } from "./reconciliation.repository";

const DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://paadi:paadi@localhost:5433/paadi";

describe("ReconciliationRepository (integration, real Postgres :5433)", () => {
  let prisma: PrismaService;
  let ledger: PrismaLedgerRepository;
  let outbox: PrismaOutboxRepository;
  let repo: ReconciliationRepository;
  let raise: RaiseExceptionService;

  const userIds: string[] = [];
  const exceptionIds: string[] = [];
  const nombaTransactionIds: string[] = [];

  beforeAll(async () => {
    process.env.DATABASE_URL = DATABASE_URL;
    prisma = new PrismaService();
    await prisma.$connect();
    ledger = new PrismaLedgerRepository(prisma);
    outbox = new PrismaOutboxRepository(prisma);
    repo = new ReconciliationRepository(prisma, ledger, outbox);
    raise = new RaiseExceptionService(prisma, outbox);
  });

  afterAll(async () => {
    if (exceptionIds.length > 0) {
      for (const id of exceptionIds) {
        await prisma.webhookEventOut.deleteMany({
          where: { payload: { path: ["exceptionId"], equals: id } }
        });
      }
      await prisma.reconciliationException.deleteMany({ where: { id: { in: exceptionIds } } });
    }
    if (nombaTransactionIds.length > 0) {
      await prisma.reconciliationException.deleteMany({
        where: { nombaTransactionId: { in: nombaTransactionIds } }
      });
    }
    if (userIds.length > 0) {
      await prisma.ledgerEntry.deleteMany({ where: { account: { ownerRef: { in: userIds } } } });
      await prisma.ledgerAccount.deleteMany({ where: { ownerRef: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await prisma.$disconnect();
  });

  async function seedUser(): Promise<string> {
    const user = await prisma.user.create({
      data: { phoneBlindIndex: `pbi-${randomUUID()}`, phoneEncrypted: "enc" }
    });
    userIds.push(user.id);
    return user.id;
  }

  function trackTxn(nombaTransactionId: string): string {
    if (!nombaTransactionIds.includes(nombaTransactionId)) {
      nombaTransactionIds.push(nombaTransactionId);
    }
    return nombaTransactionId;
  }

  async function fundSuspense(amountKobo: number): Promise<void> {
    await ledger.record(buildSuspensePosting({ potId: null, amountKobo }));
  }

  async function seedOpenException(opts: {
    amountKobo: number;
    reason?: ExceptionReason;
    senderAccount?: string | null;
    senderName?: string | null;
  }): Promise<string> {
    await fundSuspense(opts.amountKobo);
    const nombaTransactionId = trackTxn(`ntx-${randomUUID()}`);
    const exception = await prisma.reconciliationException.create({
      data: {
        nombaTransactionId,
        amountKobo: BigInt(opts.amountKobo),
        reason: opts.reason ?? ExceptionReason.UnknownAccount,
        status: "OPEN",
        senderName: opts.senderName ?? "Ada Lovelace",
        senderAccount: opts.senderAccount ?? "0123456789",
        senderBank: "GTBank",
        suspenseOwnerRef: "house"
      }
    });
    exceptionIds.push(exception.id);
    return exception.id;
  }

  async function balance(kind: string, ownerRef: string): Promise<number> {
    const account = await prisma.ledgerAccount.findUnique({
      where: { kind_ownerRef: { kind, ownerRef } }
    });
    return account ? await ledger.balance(account.id) : 0;
  }

  async function magnitude(kind: string, ownerRef: string): Promise<number> {
    return Math.abs(await balance(kind, ownerRef));
  }

  async function outboxFor(exceptionId: string, eventType: string): Promise<number> {
    const rows = await prisma.webhookEventOut.findMany({
      where: { payload: { path: ["exceptionId"], equals: exceptionId } }
    });
    return rows.filter((r) => r.eventType === eventType).length;
  }

  async function sumTrackedOpenHouseAmounts(): Promise<number> {
    if (exceptionIds.length === 0) {
      return 0;
    }
    const rows = await prisma.reconciliationException.findMany({
      where: { status: "OPEN", suspenseOwnerRef: "house", id: { in: exceptionIds } }
    });
    return rows.reduce((acc, r) => acc + Number(r.amountKobo), 0);
  }

  it("raise: materializes exactly one OPEN row over already-posted suspense and emits exception.raised", async () => {
    const amountKobo = 400000;
    await fundSuspense(amountKobo);
    const suspenseAfterCashLeg = await balance("exceptions_suspense", "house");
    const nombaTransactionId = trackTxn(`ntx-${randomUUID()}`);

    const exception = await raise.raiseException({
      nombaTransactionId,
      amountKobo,
      reason: ExceptionReason.UnknownAccount,
      senderName: "Ada Lovelace",
      senderAccount: "0123456789",
      senderBank: "GTBank",
      vaAccountNumber: "8888888888"
    });
    exceptionIds.push(exception.id);

    expect(exception.status).toBe("OPEN");
    expect(Number(exception.amountKobo)).toBe(amountKobo);
    expect(exception.suspenseOwnerRef).toBe("house");

    const rows = await prisma.reconciliationException.findMany({ where: { nombaTransactionId } });
    expect(rows).toHaveLength(1);

    expect(await balance("exceptions_suspense", "house")).toBe(suspenseAfterCashLeg);
    expect(await outboxFor(exception.id, "exception.raised")).toBe(1);
  });

  it("assign: RESOLVED, DR suspense / CR user_wallet, wallet denorm bumped, one exception.resolved", async () => {
    const amountKobo = 500000;
    const userId = await seedUser();
    const exceptionId = await seedOpenException({ amountKobo });

    const suspenseBefore = await magnitude("exceptions_suspense", "house");
    const walletBefore = await magnitude("user_wallet", userId);

    const resolved = await repo.assign(exceptionId, { userId, resolvedBy: "admin-1", note: "clearly Ada" });

    expect(resolved.status).toBe("RESOLVED");
    expect(resolved.matchedUserId).toBe(userId);
    expect(resolved.resolvedBy).toBe("admin-1");
    expect(resolved.resolvedAt).not.toBeNull();

    expect(suspenseBefore - (await magnitude("exceptions_suspense", "house"))).toBe(amountKobo);
    expect((await magnitude("user_wallet", userId)) - walletBefore).toBe(amountKobo);

    const fresh = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(Number(fresh.walletBalanceKobo)).toBe(amountKobo);

    expect(await outboxFor(exceptionId, "exception.resolved")).toBe(1);
  });

  it("assign: an unknown target user yields 404 and posts nothing", async () => {
    const amountKobo = 90000;
    const exceptionId = await seedOpenException({ amountKobo });
    const suspenseBefore = await magnitude("exceptions_suspense", "house");
    const ghostUser = randomUUID();

    await expect(
      repo.assign(exceptionId, { userId: ghostUser, resolvedBy: "admin-1" })
    ).rejects.toMatchObject({ status: 404 });

    expect(await magnitude("exceptions_suspense", "house")).toBe(suspenseBefore);
    const still = await prisma.reconciliationException.findUniqueOrThrow({ where: { id: exceptionId } });
    expect(still.status).toBe("OPEN");
  });

  it("refund: REFUNDED, DR suspense / CR pooled_cash, refundMerchantTxRef rcx_<id>, refundStatus PENDING", async () => {
    const amountKobo = 250000;
    const exceptionId = await seedOpenException({ amountKobo });

    const suspenseBefore = await magnitude("exceptions_suspense", "house");
    const pooledBefore = await balance("pooled_cash", "house");

    const resolution = await repo.refund(exceptionId, {
      senderAccount: "0123456789",
      bankCode: "058",
      senderName: "Ada Lovelace",
      resolvedBy: "admin-2"
    });

    expect(resolution.merchantTxRef).toBe(`rcx_${exceptionId}`);
    expect(resolution.amountKobo).toBe(amountKobo);
    expect(resolution.exception.status).toBe("REFUNDED");

    expect(suspenseBefore - (await magnitude("exceptions_suspense", "house"))).toBe(amountKobo);
    expect(pooledBefore - (await balance("pooled_cash", "house"))).toBe(amountKobo);

    const row = await prisma.reconciliationException.findUniqueOrThrow({ where: { id: exceptionId } });
    expect(row.status).toBe("REFUNDED");
    expect(row.refundMerchantTxRef).toBe(`rcx_${exceptionId}`);
    expect(row.refundStatus).toBe("PENDING");
    expect(row.resolvedAt).not.toBeNull();

    const withRef = await repo.recordRefundOutcome(exceptionId, {
      refundStatus: "PENDING",
      refundNombaRef: "nomba-ref-1"
    });
    expect(withRef.refundNombaRef).toBe("nomba-ref-1");
    expect(await outboxFor(exceptionId, "exception.resolved")).toBe(1);
  });

  it("hold: keeps the row OPEN, moves no money, stores the note and matched suggestion", async () => {
    const amountKobo = 60000;
    const exceptionId = await seedOpenException({ amountKobo });
    const userId = await seedUser();
    const suspenseBefore = await magnitude("exceptions_suspense", "house");

    const held = await repo.hold(exceptionId, {
      resolvedBy: "admin-4",
      matchedUserId: userId,
      note: "still investigating"
    });

    expect(held.status).toBe("OPEN");
    expect(held.note).toBe("still investigating");
    expect(held.matchedUserId).toBe(userId);
    expect(await magnitude("exceptions_suspense", "house")).toBe(suspenseBefore);
    expect(await outboxFor(exceptionId, "exception.resolved")).toBe(0);
  });

  it("conservation: house suspense tracks the OPEN house exception total leg-for-leg across a mix of raise/assign/refund", async () => {
    const suspenseStart = await magnitude("exceptions_suspense", "house");
    const openTrackedStart = await sumTrackedOpenHouseAmounts();

    const openA = await seedOpenException({ amountKobo: 120000 });
    const openB = await seedOpenException({ amountKobo: 80000 });
    const toAssign = await seedOpenException({ amountKobo: 200000 });
    const toRefund = await seedOpenException({ amountKobo: 50000 });

    expect((await magnitude("exceptions_suspense", "house")) - suspenseStart).toBe(450000);
    expect((await sumTrackedOpenHouseAmounts()) - openTrackedStart).toBe(450000);

    const userId = await seedUser();
    await repo.assign(toAssign, { userId, resolvedBy: "admin-1" });
    await repo.refund(toRefund, {
      senderAccount: "0123456789",
      bankCode: "058",
      senderName: "Ada Lovelace",
      resolvedBy: "admin-1"
    });

    const openRows = await prisma.reconciliationException.findMany({
      where: { id: { in: [openA, openB, toAssign, toRefund] }, status: "OPEN" }
    });
    expect(openRows.map((r) => r.id).sort()).toEqual([openA, openB].sort());

    const suspenseDelta = (await magnitude("exceptions_suspense", "house")) - suspenseStart;
    const openTrackedDelta = (await sumTrackedOpenHouseAmounts()) - openTrackedStart;
    expect(suspenseDelta).toBe(openTrackedDelta);
    expect(suspenseDelta).toBe(200000);
  });

  it("double-resolve: two concurrent assigns on one OPEN exception let one win and the other 409, ledger posts once", async () => {
    const amountKobo = 300000;
    const exceptionId = await seedOpenException({ amountKobo });
    const userA = await seedUser();
    const userB = await seedUser();
    const suspenseBefore = await magnitude("exceptions_suspense", "house");

    const results = await Promise.allSettled([
      repo.assign(exceptionId, { userId: userA, resolvedBy: "admin-a" }),
      repo.assign(exceptionId, { userId: userB, resolvedBy: "admin-b" })
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ status: 409 });

    expect(suspenseBefore - (await magnitude("exceptions_suspense", "house"))).toBe(amountKobo);
    expect(await outboxFor(exceptionId, "exception.resolved")).toBe(1);

    const row = await prisma.reconciliationException.findUniqueOrThrow({ where: { id: exceptionId } });
    expect(row.status).toBe("RESOLVED");
  });

  it("failed-refund compensation: reopenAfterFailedRefund reverses the ledger, restores conservation, and re-resolve works", async () => {
    const amountKobo = 250000;
    const exceptionId = await seedOpenException({ amountKobo });

    const suspensePreRefund = await magnitude("exceptions_suspense", "house");
    const pooledPreRefund = await balance("pooled_cash", "house");

    await repo.refund(exceptionId, {
      senderAccount: "0123456789",
      bankCode: "058",
      senderName: "Ada Lovelace",
      resolvedBy: "admin-2"
    });

    expect(suspensePreRefund - (await magnitude("exceptions_suspense", "house"))).toBe(amountKobo);
    expect(pooledPreRefund - (await balance("pooled_cash", "house"))).toBe(amountKobo);

    const reopened = await repo.reopenAfterFailedRefund(exceptionId);

    expect(reopened.status).toBe("OPEN");
    expect(reopened.refundStatus).toBe("FAILED");
    expect(reopened.refundMerchantTxRef).toBeNull();

    expect(await magnitude("exceptions_suspense", "house")).toBe(suspensePreRefund);
    expect(await balance("pooled_cash", "house")).toBe(pooledPreRefund);

    const userId = await seedUser();
    const resolved = await repo.assign(exceptionId, { userId, resolvedBy: "admin-1" });

    expect(resolved.status).toBe("RESOLVED");
    expect(suspensePreRefund - (await magnitude("exceptions_suspense", "house"))).toBe(amountKobo);
    expect((await magnitude("user_wallet", userId))).toBe(amountKobo);
  });

  it("resolve on a non-OPEN exception is a 409 via the FOR UPDATE status guard", async () => {
    const exceptionId = await seedOpenException({ amountKobo: 40000 });
    const userId = await seedUser();
    await repo.assign(exceptionId, { userId, resolvedBy: "admin-1" });

    await expect(
      repo.hold(exceptionId, { resolvedBy: "admin-1", note: "too late" })
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      repo.refund(exceptionId, {
        senderAccount: "0123456789",
        bankCode: "058",
        senderName: "Ada Lovelace",
        resolvedBy: "admin-1"
      })
    ).rejects.toMatchObject({ status: 409 });
  });

  it("admin gate: a non-allowlisted caller is denied 403 on the admin-only surface", () => {
    const reflector = new Reflector();
    const config = { get: () => ["admin-allowed"] } as unknown as ConfigService;
    const guard = new AdminGuard(reflector, config);

    class Guarded {
      @AdminOnly()
      handler(): void {}
    }
    const context = {
      getHandler: () => Guarded.prototype.handler,
      getClass: () => Guarded,
      switchToHttp: () => ({ getRequest: () => ({ user: { sub: "not-admin", sid: "s", tier: "t" } }) })
    } as unknown as ExecutionContext;

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it("admin gate: an allowlisted caller passes the admin-only surface", () => {
    const reflector = new Reflector();
    const config = { get: () => ["admin-allowed"] } as unknown as ConfigService;
    const guard = new AdminGuard(reflector, config);

    class Guarded {
      @AdminOnly()
      handler(): void {}
    }
    const context = {
      getHandler: () => Guarded.prototype.handler,
      getClass: () => Guarded,
      switchToHttp: () => ({ getRequest: () => ({ user: { sub: "admin-allowed", sid: "s", tier: "t" } }) })
    } as unknown as ExecutionContext;

    expect(guard.canActivate(context)).toBe(true);
  });
});
