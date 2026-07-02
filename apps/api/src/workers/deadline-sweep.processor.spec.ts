import { Job } from "bullmq";
import { OutboxMessage } from "@paadi/domain";
import {
  CompletionRule as DbCompletionRule,
  PotStatus as DbPotStatus,
  PrismaService
} from "@paadi/db";
import { PrismaOutboxRepository } from "../infra/persistence/outbox.repository";
import { DeadlineSweepProcessor } from "./deadline-sweep.processor";

interface FakePot {
  id: string;
  status: DbPotStatus;
  completionRule: DbCompletionRule;
  collectedKobo: bigint;
}

function makePrisma(due: FakePot[], potsById: Map<string, FakePot>) {
  const updates: { id: string; status: DbPotStatus }[] = [];
  const tx = {
    $queryRaw: jest.fn(async () => []),
    pot: {
      findUniqueOrThrow: jest.fn(async (args: { where: { id: string } }) => {
        const pot = potsById.get(args.where.id);
        if (!pot) {
          throw new Error(`pot ${args.where.id} not seeded`);
        }
        return pot;
      }),
      update: jest.fn(async (args: { where: { id: string }; data: { status: DbPotStatus } }) => {
        updates.push({ id: args.where.id, status: args.data.status });
        const pot = potsById.get(args.where.id);
        if (pot) {
          pot.status = args.data.status;
        }
        return pot;
      })
    }
  };
  const prisma = {
    pot: {
      findMany: jest.fn(async () => due.map((p) => ({ id: p.id })))
    },
    $transaction: jest.fn(async (cb: (client: typeof tx) => Promise<unknown>) => cb(tx))
  };
  return { prisma: prisma as unknown as PrismaService, tx, updates };
}

function makeOutbox() {
  const events: OutboxMessage[] = [];
  const enqueue = jest.fn(async (message: OutboxMessage) => {
    events.push(message);
  });
  return { outbox: { enqueue } as unknown as PrismaOutboxRepository, events };
}

function build(due: FakePot[]) {
  const potsById = new Map(due.map((p) => [p.id, { ...p }]));
  const { prisma, updates } = makePrisma(due, potsById);
  const { outbox, events } = makeOutbox();
  const processor = new DeadlineSweepProcessor(prisma, outbox);
  return { processor, updates, events };
}

function eventTypes(events: OutboxMessage[]): string[] {
  return events.map((e) => e.event.type);
}

describe("DeadlineSweepProcessor", () => {
  it("transitions a progressive pot with collected>0 to FUNDED, emits pool.funded", async () => {
    const { processor, updates, events } = build([
      {
        id: "pot-prog",
        status: DbPotStatus.OPEN,
        completionRule: DbCompletionRule.PROGRESSIVE,
        collectedKobo: 500000n
      }
    ]);

    await processor.process({} as Job);

    expect(updates).toEqual([{ id: "pot-prog", status: DbPotStatus.FUNDED }]);
    expect(eventTypes(events)).toEqual(["pool.funded"]);
  });

  it("expires an all_or_nothing miss and emits pool.expired (outbox drives refund-all)", async () => {
    const { processor, updates, events } = build([
      {
        id: "pot-aon",
        status: DbPotStatus.OPEN,
        completionRule: DbCompletionRule.ALL_OR_NOTHING,
        collectedKobo: 200000n
      }
    ]);

    await processor.process({} as Job);

    expect(updates).toEqual([{ id: "pot-aon", status: DbPotStatus.EXPIRED }]);
    expect(eventTypes(events)).toEqual(["pool.expired"]);
  });

  it("expires a progressive pot with collected==0 (no-op close) and emits pool.expired", async () => {
    const { processor, updates, events } = build([
      {
        id: "pot-zero",
        status: DbPotStatus.OPEN,
        completionRule: DbCompletionRule.PROGRESSIVE,
        collectedKobo: 0n
      }
    ]);

    await processor.process({} as Job);

    expect(updates).toEqual([{ id: "pot-zero", status: DbPotStatus.EXPIRED }]);
    expect(eventTypes(events)).toEqual(["pool.expired"]);
  });

  it("expires an all_or_nothing pot with collected==0 and emits pool.expired", async () => {
    const { processor, updates, events } = build([
      {
        id: "pot-aon-zero",
        status: DbPotStatus.OPEN,
        completionRule: DbCompletionRule.ALL_OR_NOTHING,
        collectedKobo: 0n
      }
    ]);

    await processor.process({} as Job);

    expect(updates).toEqual([{ id: "pot-aon-zero", status: DbPotStatus.EXPIRED }]);
    expect(eventTypes(events)).toEqual(["pool.expired"]);
  });

  it("skips a pot that is no longer OPEN at lock time (idempotent on status)", async () => {
    const { processor, updates, events } = build([
      {
        id: "pot-raced",
        status: DbPotStatus.FUNDED,
        completionRule: DbCompletionRule.PROGRESSIVE,
        collectedKobo: 500000n
      }
    ]);

    await processor.process({} as Job);

    expect(updates).toEqual([]);
    expect(events).toEqual([]);
  });

  it("isolates a failure on one due pot so the rest still sweep", async () => {
    const due: FakePot[] = [
      {
        id: "pot-bad",
        status: DbPotStatus.OPEN,
        completionRule: DbCompletionRule.PROGRESSIVE,
        collectedKobo: 500000n
      },
      {
        id: "pot-good",
        status: DbPotStatus.OPEN,
        completionRule: DbCompletionRule.ALL_OR_NOTHING,
        collectedKobo: 100000n
      }
    ];
    const potsById = new Map<string, FakePot>([["pot-good", { ...due[1] }]]);
    const { prisma, updates } = makePrisma(due, potsById);
    const { outbox } = makeOutbox();
    const processor = new DeadlineSweepProcessor(prisma, outbox);

    await processor.process({} as Job);

    expect(updates).toEqual([{ id: "pot-good", status: DbPotStatus.EXPIRED }]);
  });
});
