import { randomUUID } from "node:crypto";
import { Prisma, PrismaService, ReconciliationException } from "@paadi/db";
import { PrismaLedgerRepository } from "./ledger.repository";
import { PrismaOutboxRepository } from "./outbox.repository";
import { CreditWalletInput, WalletCreditRepository } from "./wallet-credit.repository";
import {
  RaiseExceptionInput,
  RaiseExceptionService
} from "../../modules/reconciliation/raise-exception.service";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://paadi:paadi@localhost:5433/paadi";

interface RaiseExceptionCall {
  input: RaiseExceptionInput;
  tx: Prisma.TransactionClient | undefined;
}

function makeRaiseExceptionFake() {
  const calls: RaiseExceptionCall[] = [];
  const raiseException = jest.fn(
    async (input: RaiseExceptionInput, tx?: Prisma.TransactionClient) => {
      calls.push({ input, tx });
      return { id: `exc-${randomUUID()}`, nombaTransactionId: input.nombaTransactionId } as ReconciliationException;
    }
  );
  return { service: { raiseException } as unknown as RaiseExceptionService, raiseException, calls };
}

describe("WalletCreditRepository (integration, real Postgres :5433)", () => {
  let prisma: PrismaService;
  let ledger: PrismaLedgerRepository;
  let outbox: PrismaOutboxRepository;
  let repo: WalletCreditRepository;
  let raiseExceptionFake: ReturnType<typeof makeRaiseExceptionFake>;

  const userIds: string[] = [];
  const webhookEventInIds: string[] = [];
  const nombaTransactionIds: string[] = [];

  beforeAll(async () => {
    process.env.DATABASE_URL = DATABASE_URL;
    prisma = new PrismaService();
    await prisma.$connect();
    ledger = new PrismaLedgerRepository(prisma);
    outbox = new PrismaOutboxRepository(prisma);
    raiseExceptionFake = makeRaiseExceptionFake();
    repo = new WalletCreditRepository(prisma, ledger, outbox, raiseExceptionFake.service);
  });

  afterAll(async () => {
    if (nombaTransactionIds.length > 0) {
      await prisma.walletCredit.deleteMany({
        where: { nombaTransactionId: { in: nombaTransactionIds } }
      });
    }
    if (userIds.length > 0) {
      await prisma.ledgerEntry.deleteMany({
        where: { account: { ownerRef: { in: userIds } } }
      });
      await prisma.ledgerAccount.deleteMany({ where: { ownerRef: { in: userIds } } });
    }
    for (const eventId of webhookEventInIds) {
      await prisma.webhookEventOut.deleteMany({
        where: { payload: { path: ["nombaTransactionId"], equals: eventId } }
      });
    }
    for (const txnId of nombaTransactionIds) {
      await prisma.webhookEventOut.deleteMany({
        where: { payload: { path: ["nombaTransactionId"], equals: txnId } }
      });
    }
    if (webhookEventInIds.length > 0) {
      await prisma.webhookEventIn.deleteMany({ where: { id: { in: webhookEventInIds } } });
    }
    if (userIds.length > 0) {
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

  async function makeWebhookEvent(): Promise<string> {
    const event = await prisma.webhookEventIn.create({
      data: {
        provider: "nomba",
        providerEventId: `pe-${randomUUID()}`,
        signatureOk: true,
        payload: {}
      }
    });
    webhookEventInIds.push(event.id);
    return event.id;
  }

  function creditInput(overrides: Partial<CreditWalletInput>): CreditWalletInput {
    const nombaTransactionId = overrides.nombaTransactionId ?? `txn-${randomUUID()}`;
    if (!nombaTransactionIds.includes(nombaTransactionId)) {
      nombaTransactionIds.push(nombaTransactionId);
    }
    return {
      userId: "",
      virtualAccountId: null,
      amountKobo: 0,
      senderName: "Ada Lovelace",
      senderAccount: "0123456789",
      senderBank: "GTBank",
      senderBankCode: "058",
      rawEventId: "",
      ...overrides,
      nombaTransactionId
    };
  }

  async function accountBalance(kind: string, ownerRef: string): Promise<number> {
    const account = await prisma.ledgerAccount.findUnique({
      where: { kind_ownerRef: { kind, ownerRef } }
    });
    if (!account) {
      return 0;
    }
    return ledger.balance(account.id);
  }

  async function walletBalance(userId: string): Promise<number> {
    const net = await accountBalance("user_wallet", userId);
    return net === 0 ? 0 : -net;
  }

  async function creditLedgerSums(
    userId: string
  ): Promise<{ dr: bigint; cr: bigint; entryCount: number; txnCount: number }> {
    const account = await prisma.ledgerAccount.findUnique({
      where: { kind_ownerRef: { kind: "user_wallet", ownerRef: userId } }
    });
    if (!account) {
      return { dr: 0n, cr: 0n, entryCount: 0, txnCount: 0 };
    }
    const entries = await prisma.ledgerEntry.findMany({
      where: { accountId: account.id },
      include: { transaction: true }
    });
    const txnIds = new Set(entries.map((e) => e.transactionId));
    const txns = await prisma.ledgerTransaction.findMany({
      where: { id: { in: [...txnIds] } },
      include: { entries: true }
    });
    const allEntries = txns.flatMap((t) => t.entries);
    const dr = allEntries
      .filter((e) => e.direction === "DR")
      .reduce((acc, e) => acc + e.amountKobo, 0n);
    const cr = allEntries
      .filter((e) => e.direction === "CR")
      .reduce((acc, e) => acc + e.amountKobo, 0n);
    return { dr, cr, entryCount: allEntries.length, txnCount: txns.length };
  }

  async function outboxFor(nombaTransactionId: string) {
    return prisma.webhookEventOut.findMany({
      where: { payload: { path: ["nombaTransactionId"], equals: nombaTransactionId } }
    });
  }

  async function globalLedgerNet(): Promise<bigint> {
    const entries = await prisma.ledgerEntry.findMany({
      select: { direction: true, amountKobo: true }
    });
    return entries.reduce(
      (acc, e) => acc + (e.direction === "DR" ? e.amountKobo : -e.amountKobo),
      0n
    );
  }

  it("credits a wallet: one WalletCredit, balanced ledger, denorm bump, one wallet.credited", async () => {
    const userId = await seedUser();
    const rawEventId = await makeWebhookEvent();
    const nombaTransactionId = `txn-${randomUUID()}`;

    const pooledBefore = await accountBalance("pooled_cash", "house");

    const result = await repo.creditWallet(
      creditInput({ userId, rawEventId, nombaTransactionId, amountKobo: 500000 })
    );

    expect(result.alreadyProcessed).toBe(false);
    expect(result.walletCreditId).not.toBeNull();
    expect(result.amountKobo).toBe(500000);

    const credits = await prisma.walletCredit.findMany({ where: { userId } });
    expect(credits).toHaveLength(1);
    expect(credits[0].nombaTransactionId).toBe(nombaTransactionId);
    expect(Number(credits[0].amountKobo)).toBe(500000);
    expect(credits[0].senderBankCode).toBe("058");
    expect(credits[0].status).toBe("succeeded");

    const sums = await creditLedgerSums(userId);
    expect(sums.txnCount).toBe(1);
    expect(sums.entryCount).toBe(2);
    expect(sums.dr).toBe(sums.cr);

    expect((await accountBalance("pooled_cash", "house")) - pooledBefore).toBe(500000);
    expect(await walletBalance(userId)).toBe(500000);

    const fresh = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(Number(fresh.walletBalanceKobo)).toBe(500000);

    const event = await prisma.webhookEventIn.findUniqueOrThrow({ where: { id: rawEventId } });
    expect(event.processedAt).not.toBeNull();

    const out = await outboxFor(nombaTransactionId);
    expect(out.filter((r) => r.eventType === "wallet.credited")).toHaveLength(1);
  });

  it("holds the balance invariant across a sequence: walletBalanceKobo == balance(user_wallet[U])", async () => {
    const userId = await seedUser();
    const netBefore = await globalLedgerNet();
    const pooledBefore = await accountBalance("pooled_cash", "house");

    for (const amount of [100000, 250000, 75000]) {
      const rawEventId = await makeWebhookEvent();
      await repo.creditWallet(creditInput({ userId, rawEventId, amountKobo: amount }));
    }

    const fresh = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(Number(fresh.walletBalanceKobo)).toBe(425000);
    expect(await walletBalance(userId)).toBe(425000);
    expect(Number(fresh.walletBalanceKobo)).toBe(await walletBalance(userId));

    expect((await accountBalance("pooled_cash", "house")) - pooledBefore).toBe(425000);

    const netAfter = await globalLedgerNet();
    expect(netAfter).toBe(netBefore);
  });

  it("is replay-safe: the same nombaTransactionId twice leaves one WalletCredit and a byte-identical ledger", async () => {
    const userId = await seedUser();
    const firstEvent = await makeWebhookEvent();
    const nombaTransactionId = `txn-${randomUUID()}`;

    await repo.creditWallet(
      creditInput({ userId, rawEventId: firstEvent, nombaTransactionId, amountKobo: 300000 })
    );

    const before = await creditLedgerSums(userId);
    const walletBefore = await walletBalance(userId);

    const secondEvent = await makeWebhookEvent();
    const replay = await repo.creditWallet(
      creditInput({ userId, rawEventId: secondEvent, nombaTransactionId, amountKobo: 300000 })
    );

    expect(replay.alreadyProcessed).toBe(true);
    expect(replay.walletCreditId).toBeNull();

    const loser = await prisma.webhookEventIn.findUniqueOrThrow({ where: { id: secondEvent } });
    expect(loser.processedAt).not.toBeNull();

    const credits = await prisma.walletCredit.findMany({ where: { nombaTransactionId } });
    expect(credits).toHaveLength(1);

    const after = await creditLedgerSums(userId);
    expect(after.txnCount).toBe(before.txnCount);
    expect(after.entryCount).toBe(before.entryCount);
    expect(after.dr).toBe(before.dr);
    expect(after.cr).toBe(before.cr);
    expect(await walletBalance(userId)).toBe(walletBefore);

    const fresh = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(Number(fresh.walletBalanceKobo)).toBe(300000);
  });

  it("records two distinct credits for one user as the exact sum (concurrency parity)", async () => {
    const userId = await seedUser();
    const firstEvent = await makeWebhookEvent();
    const secondEvent = await makeWebhookEvent();

    const [a, b] = await Promise.all([
      repo.creditWallet(creditInput({ userId, rawEventId: firstEvent, amountKobo: 120000 })),
      repo.creditWallet(creditInput({ userId, rawEventId: secondEvent, amountKobo: 80000 }))
    ]);

    expect(a.alreadyProcessed).toBe(false);
    expect(b.alreadyProcessed).toBe(false);

    const credits = await prisma.walletCredit.findMany({ where: { userId } });
    expect(credits).toHaveLength(2);

    expect(await walletBalance(userId)).toBe(200000);
    const fresh = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(Number(fresh.walletBalanceKobo)).toBe(200000);

    const sums = await creditLedgerSums(userId);
    expect(sums.dr).toBe(sums.cr);
  });

  it("parks an unmatched credit to house suspense without writing a WalletCredit", async () => {
    raiseExceptionFake.raiseException.mockClear();
    raiseExceptionFake.calls.length = 0;
    const userId = await seedUser();
    const rawEventId = await makeWebhookEvent();
    const nombaTransactionId = `txn-${randomUUID()}`;
    nombaTransactionIds.push(nombaTransactionId);

    const suspenseBefore = await accountBalance("exceptions_suspense", "house");

    const result = await repo.recordUnmatched({
      webhookEventInId: rawEventId,
      accountNumber: "8888888888",
      nombaTransactionId,
      amountKobo: 400000,
      reason: "UNKNOWN_ACCOUNT",
      senderName: "Ada Lovelace",
      senderAccount: "0123456789",
      senderBank: "GTBank"
    });

    expect(result.reason).toBe("UNKNOWN_ACCOUNT");

    expect(raiseExceptionFake.raiseException).toHaveBeenCalledTimes(1);
    const raised = raiseExceptionFake.calls[0];
    expect(raised.tx).toBeDefined();
    expect(raised.input.nombaTransactionId).toBe(nombaTransactionId);
    expect(raised.input.reason).toBe("UNKNOWN_ACCOUNT");
    expect(raised.input.amountKobo).toBe(400000);
    expect(raised.input.vaAccountNumber).toBe("8888888888");
    expect(raised.input.suspenseOwnerRef).toBe("house");
    expect(result.exceptionId).toMatch(/^exc-/);

    const credits = await prisma.walletCredit.findMany({ where: { nombaTransactionId } });
    expect(credits).toHaveLength(0);

    expect(await walletBalance(userId)).toBe(0);

    const suspenseAfter = await accountBalance("exceptions_suspense", "house");
    expect(-(suspenseAfter - suspenseBefore)).toBe(400000);

    const event = await prisma.webhookEventIn.findUniqueOrThrow({ where: { id: rawEventId } });
    expect(event.processedAt).not.toBeNull();

    const out = await outboxFor(nombaTransactionId);
    expect(out.filter((r) => r.eventType === "wallet.credit_unmatched")).toHaveLength(1);
  });
});
