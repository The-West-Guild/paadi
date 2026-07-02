import { randomUUID } from "node:crypto";
import { PrismaService, VirtualAccountStatus } from "@paadi/db";
import { PrismaOutboxRepository } from "./outbox.repository";
import {
  PersistVirtualAccountInput,
  VirtualAccountRepository
} from "./virtual-account.repository";

const DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://paadi:paadi@localhost:5433/paadi";

describe("VirtualAccountRepository (integration, real Postgres :5433)", () => {
  let prisma: PrismaService;
  let outbox: PrismaOutboxRepository;
  let repo: VirtualAccountRepository;

  const userIds: string[] = [];

  beforeAll(async () => {
    process.env.DATABASE_URL = DATABASE_URL;
    prisma = new PrismaService();
    await prisma.$connect();
    outbox = new PrismaOutboxRepository(prisma);
    repo = new VirtualAccountRepository(prisma, outbox);
  });

  afterAll(async () => {
    if (userIds.length > 0) {
      for (const userId of userIds) {
        await prisma.webhookEventOut.deleteMany({
          where: { payload: { path: ["userId"], equals: userId } }
        });
      }
      await prisma.virtualAccount.deleteMany({ where: { userId: { in: userIds } } });
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

  function inputFor(userId: string, overrides: Partial<PersistVirtualAccountInput> = {}): PersistVirtualAccountInput {
    const suffix = randomUUID().replace(/-/g, "").slice(0, 10);
    return {
      userId,
      accountNumber: `90${suffix.replace(/\D/g, "0").slice(0, 8).padEnd(8, "0")}`,
      accountName: "Nomba/ADA OKEKE",
      providerBank: "Paadi MFB",
      nombaAccountRef: `acct-${suffix}`,
      ...overrides
    };
  }

  async function outboxForUser(userId: string) {
    return prisma.webhookEventOut.findMany({
      where: { payload: { path: ["userId"], equals: userId } }
    });
  }

  it("provisions exactly one ACTIVE row with the three uniques set and one provisioned event", async () => {
    const userId = await seedUser();
    const input = inputFor(userId);

    const result = await repo.provisionVirtualAccount(input);
    expect(result.created).toBe(true);
    expect(result.virtualAccount.status).toBe(VirtualAccountStatus.ACTIVE);
    expect(result.virtualAccount.kind).toBe("STATIC");
    expect(result.virtualAccount.closedAt).toBeNull();

    const rows = await prisma.virtualAccount.findMany({ where: { userId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(userId);
    expect(rows[0].accountNumber).toBe(input.accountNumber);
    expect(rows[0].nombaAccountRef).toBe(input.nombaAccountRef);
    expect(rows[0].accountNumber.length).toBeGreaterThan(0);

    const events = await outboxForUser(userId);
    const provisioned = events.filter((e) => e.eventType === "virtual_account.provisioned");
    expect(provisioned).toHaveLength(1);
    expect((provisioned[0].payload as { accountNumber: string }).accountNumber).toBe(
      input.accountNumber
    );
  });

  it("is the canonical map: findByAccountNumber returns the owning userId (the Chunk-7 contract)", async () => {
    const userId = await seedUser();
    const input = inputFor(userId);
    await repo.provisionVirtualAccount(input);

    const found = await repo.findByAccountNumber(input.accountNumber);
    expect(found).not.toBeNull();
    expect(found!.userId).toBe(userId);

    const byUser = await repo.findByUserId(userId);
    expect(byUser!.accountNumber).toBe(input.accountNumber);

    const missing = await repo.findByAccountNumber(`00${randomUUID().slice(0, 8)}`);
    expect(missing).toBeNull();
  });

  it("holds userId @unique under a concurrent double-provision: one row, one event, P2002 path returns the winner", async () => {
    const userId = await seedUser();
    const first = inputFor(userId);
    const second = inputFor(userId);

    const [a, b] = await Promise.all([
      repo.provisionVirtualAccount(first),
      repo.provisionVirtualAccount(second)
    ]);

    const createdFlags = [a.created, b.created];
    expect(createdFlags.filter(Boolean)).toHaveLength(1);
    expect(a.virtualAccount.id).toBe(b.virtualAccount.id);
    expect(a.virtualAccount.userId).toBe(userId);

    const rows = await prisma.virtualAccount.findMany({ where: { userId } });
    expect(rows).toHaveLength(1);

    const provisioned = (await outboxForUser(userId)).filter(
      (e) => e.eventType === "virtual_account.provisioned"
    );
    expect(provisioned).toHaveLength(1);
  });

  it("renames in place, keeps the account number, and emits one renamed event", async () => {
    const userId = await seedUser();
    const input = inputFor(userId);
    await repo.provisionVirtualAccount(input);

    const renamed = await repo.updateName(userId, "Nomba/TUNDE ADE");
    expect(renamed.accountName).toBe("Nomba/TUNDE ADE");
    expect(renamed.accountNumber).toBe(input.accountNumber);

    const row = await prisma.virtualAccount.findUniqueOrThrow({ where: { userId } });
    expect(row.accountName).toBe("Nomba/TUNDE ADE");
    expect(row.accountNumber).toBe(input.accountNumber);

    const events = (await outboxForUser(userId)).filter(
      (e) => e.eventType === "virtual_account.renamed"
    );
    expect(events).toHaveLength(1);
  });

  it("suspends and restores via setStatus without emitting an event", async () => {
    const userId = await seedUser();
    await repo.provisionVirtualAccount(inputFor(userId));

    const suspended = await repo.setStatus(userId, VirtualAccountStatus.SUSPENDED);
    expect(suspended.status).toBe(VirtualAccountStatus.SUSPENDED);

    const restored = await repo.setStatus(userId, VirtualAccountStatus.ACTIVE);
    expect(restored.status).toBe(VirtualAccountStatus.ACTIVE);

    const events = (await outboxForUser(userId)).filter((e) =>
      ["virtual_account.renamed", "virtual_account.closed"].includes(e.eventType)
    );
    expect(events).toHaveLength(0);
  });

  it("closes terminally: status CLOSED, closedAt stamped, row and accountNumber retained, one closed event", async () => {
    const userId = await seedUser();
    const input = inputFor(userId);
    await repo.provisionVirtualAccount(input);

    const closed = await repo.close(userId);
    expect(closed.status).toBe(VirtualAccountStatus.CLOSED);
    expect(closed.closedAt).not.toBeNull();

    const row = await prisma.virtualAccount.findUniqueOrThrow({ where: { userId } });
    expect(row.status).toBe(VirtualAccountStatus.CLOSED);
    expect(row.accountNumber).toBe(input.accountNumber);

    const stillFound = await repo.findByAccountNumber(input.accountNumber);
    expect(stillFound!.userId).toBe(userId);

    const events = (await outboxForUser(userId)).filter(
      (e) => e.eventType === "virtual_account.closed"
    );
    expect(events).toHaveLength(1);
    expect((events[0].payload as { accountNumber: string }).accountNumber).toBe(
      input.accountNumber
    );
  });
});
