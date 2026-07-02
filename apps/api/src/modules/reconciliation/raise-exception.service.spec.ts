import { ExceptionReason } from "@paadi/contracts";
import { OutboxMessage } from "@paadi/domain";
import { Prisma, PrismaService, ReconciliationException } from "@paadi/db";
import { PrismaOutboxRepository } from "../../infra/persistence/outbox.repository";
import { RaiseExceptionInput, RaiseExceptionService } from "./raise-exception.service";

interface ExceptionStore {
  createCalls: Prisma.ReconciliationExceptionCreateArgs[];
  findUniqueOrThrowCalls: string[];
  rows: Map<string, ReconciliationException>;
  duplicateOnCreate: boolean;
}

function makeRow(overrides: Partial<ReconciliationException> = {}): ReconciliationException {
  return {
    id: overrides.id ?? "exc-1",
    nombaTransactionId: overrides.nombaTransactionId ?? "ntx-1",
    amountKobo: overrides.amountKobo ?? 400000n,
    reason: overrides.reason ?? "UNKNOWN_ACCOUNT",
    status: overrides.status ?? "OPEN",
    senderName: overrides.senderName ?? null,
    senderAccount: overrides.senderAccount ?? null,
    senderBank: overrides.senderBank ?? null,
    senderBankCode: overrides.senderBankCode ?? null,
    vaAccountNumber: overrides.vaAccountNumber ?? null,
    suspenseOwnerRef: overrides.suspenseOwnerRef ?? "house",
    ledgerTxnId: overrides.ledgerTxnId ?? null,
    matchedUserId: overrides.matchedUserId ?? null,
    resolvedBy: overrides.resolvedBy ?? null,
    resolvedAt: overrides.resolvedAt ?? null,
    note: overrides.note ?? null,
    refundMerchantTxRef: overrides.refundMerchantTxRef ?? null,
    refundNombaRef: overrides.refundNombaRef ?? null,
    refundStatus: overrides.refundStatus ?? null,
    createdAt: overrides.createdAt ?? new Date("2026-07-01T00:00:00.000Z"),
    updatedAt: overrides.updatedAt ?? new Date("2026-07-01T00:00:00.000Z")
  } as ReconciliationException;
}

function duplicateError(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("duplicate", {
    code: "P2002",
    clientVersion: "test",
    meta: { target: ["nombaTransactionId"] }
  });
}

function makeClient(store: ExceptionStore) {
  return {
    reconciliationException: {
      create: jest.fn(async (args: Prisma.ReconciliationExceptionCreateArgs) => {
        store.createCalls.push(args);
        if (store.duplicateOnCreate) {
          throw duplicateError();
        }
        const data = args.data as Record<string, unknown>;
        const row = makeRow({
          id: (data.id as string) ?? "exc-1",
          nombaTransactionId: data.nombaTransactionId as string,
          amountKobo: data.amountKobo as bigint,
          reason: data.reason as ReconciliationException["reason"],
          status: data.status as ReconciliationException["status"],
          senderName: (data.senderName as string | null) ?? null,
          senderAccount: (data.senderAccount as string | null) ?? null,
          senderBank: (data.senderBank as string | null) ?? null,
          senderBankCode: (data.senderBankCode as string | null) ?? null,
          vaAccountNumber: (data.vaAccountNumber as string | null) ?? null,
          suspenseOwnerRef: (data.suspenseOwnerRef as string) ?? "house",
          ledgerTxnId: (data.ledgerTxnId as string | null) ?? null
        });
        store.rows.set(row.nombaTransactionId, row);
        return row;
      }),
      findUniqueOrThrow: jest.fn(
        async (args: { where: { nombaTransactionId: string } }) => {
          store.findUniqueOrThrowCalls.push(args.where.nombaTransactionId);
          const existing = store.rows.get(args.where.nombaTransactionId);
          if (!existing) {
            throw new Error("no existing row");
          }
          return existing;
        }
      )
    }
  };
}

function makePrisma(store: ExceptionStore): { prisma: PrismaService; txCalls: number } {
  const state = { txCalls: 0 };
  const prisma = {
    $transaction: jest.fn(async (cb: (client: unknown) => Promise<unknown>) => {
      state.txCalls += 1;
      return cb(makeClient(store));
    })
  } as unknown as PrismaService;
  return { prisma, get txCalls() {
    return state.txCalls;
  } };
}

function makeOutbox(): { outbox: PrismaOutboxRepository; enqueued: OutboxMessage[] } {
  const enqueued: OutboxMessage[] = [];
  const outbox = {
    enqueue: jest.fn(async (message: OutboxMessage) => {
      enqueued.push(message);
    })
  } as unknown as PrismaOutboxRepository;
  return { outbox, enqueued };
}

function baseInput(overrides: Partial<RaiseExceptionInput> = {}): RaiseExceptionInput {
  return {
    nombaTransactionId: "ntx-1",
    amountKobo: 400000,
    reason: ExceptionReason.UnknownAccount,
    ...overrides
  };
}

describe("RaiseExceptionService", () => {
  it("maps the input to an OPEN row (BigInt kobo, defaulted suspenseOwnerRef) and emits exception.raised", async () => {
    const store: ExceptionStore = {
      createCalls: [],
      findUniqueOrThrowCalls: [],
      rows: new Map(),
      duplicateOnCreate: false
    };
    const { prisma } = makePrisma(store);
    const { outbox, enqueued } = makeOutbox();
    const service = new RaiseExceptionService(prisma, outbox);

    const result = await service.raiseException(
      baseInput({
        nombaTransactionId: "ntx-42",
        amountKobo: 250000,
        reason: ExceptionReason.ClosedAccount,
        senderName: "Ada Lovelace",
        senderAccount: "0123456789",
        senderBank: "GTBank"
      })
    );

    expect(store.createCalls).toHaveLength(1);
    const created = store.createCalls[0].data as Record<string, unknown>;
    expect(created.nombaTransactionId).toBe("ntx-42");
    expect(created.amountKobo).toBe(250000n);
    expect(created.reason).toBe(ExceptionReason.ClosedAccount);
    expect(created.status).toBe("OPEN");
    expect(created.senderName).toBe("Ada Lovelace");
    expect(created.suspenseOwnerRef).toBe("house");
    expect(created.ledgerTxnId).toBeNull();

    expect(result.status).toBe("OPEN");
    expect(store.findUniqueOrThrowCalls).toHaveLength(0);

    expect(enqueued).toHaveLength(1);
    expect(enqueued[0].event).toEqual({
      type: "exception.raised",
      exceptionId: result.id,
      amountKobo: 250000,
      reason: ExceptionReason.ClosedAccount
    });
  });

  it("honours an explicit suspenseOwnerRef and passes optional sender/ledger fields through", async () => {
    const store: ExceptionStore = {
      createCalls: [],
      findUniqueOrThrowCalls: [],
      rows: new Map(),
      duplicateOnCreate: false
    };
    const { prisma } = makePrisma(store);
    const { outbox } = makeOutbox();
    const service = new RaiseExceptionService(prisma, outbox);

    await service.raiseException(
      baseInput({ suspenseOwnerRef: "pot-9", senderBankCode: "058", ledgerTxnId: "ltx-1" })
    );

    const created = store.createCalls[0].data as Record<string, unknown>;
    expect(created.suspenseOwnerRef).toBe("pot-9");
    expect(created.senderBankCode).toBe("058");
    expect(created.ledgerTxnId).toBe("ltx-1");
  });

  it("is idempotent: a duplicate nombaTransactionId returns the existing row with no second insert and no outbox emit", async () => {
    const existing = makeRow({ id: "exc-existing", nombaTransactionId: "ntx-dup", status: "RESOLVED" });
    const store: ExceptionStore = {
      createCalls: [],
      findUniqueOrThrowCalls: [],
      rows: new Map([[existing.nombaTransactionId, existing]]),
      duplicateOnCreate: true
    };
    const { prisma } = makePrisma(store);
    const { outbox, enqueued } = makeOutbox();
    const service = new RaiseExceptionService(prisma, outbox);

    const result = await service.raiseException(baseInput({ nombaTransactionId: "ntx-dup" }));

    expect(result).toBe(existing);
    expect(store.createCalls).toHaveLength(1);
    expect(store.findUniqueOrThrowCalls).toEqual(["ntx-dup"]);
    expect(enqueued).toHaveLength(0);
  });

  it("reuses the caller's interactive tx (no self-managed $transaction) when one is provided", async () => {
    const store: ExceptionStore = {
      createCalls: [],
      findUniqueOrThrowCalls: [],
      rows: new Map(),
      duplicateOnCreate: false
    };
    const transaction = jest.fn();
    const prisma = { $transaction: transaction } as unknown as PrismaService;
    const { outbox, enqueued } = makeOutbox();
    const service = new RaiseExceptionService(prisma, outbox);
    const tx = makeClient(store) as unknown as Prisma.TransactionClient;

    const result = await service.raiseException(baseInput({ nombaTransactionId: "ntx-tx" }), tx);

    expect(transaction).not.toHaveBeenCalled();
    expect(store.createCalls).toHaveLength(1);
    expect(result.nombaTransactionId).toBe("ntx-tx");
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0].event.type).toBe("exception.raised");
  });

  it("rethrows non-duplicate database errors untouched", async () => {
    const store: ExceptionStore = {
      createCalls: [],
      findUniqueOrThrowCalls: [],
      rows: new Map(),
      duplicateOnCreate: false
    };
    const boom = new Error("connection reset");
    const prisma = {
      $transaction: jest.fn(async (cb: (client: unknown) => Promise<unknown>) =>
        cb({
          reconciliationException: {
            create: jest.fn(async () => {
              throw boom;
            }),
            findUniqueOrThrow: jest.fn()
          }
        })
      )
    } as unknown as PrismaService;
    const { outbox } = makeOutbox();
    const service = new RaiseExceptionService(prisma, outbox);

    await expect(service.raiseException(baseInput())).rejects.toBe(boom);
    void store;
  });
});
