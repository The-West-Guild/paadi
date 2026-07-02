import { randomUUID } from "node:crypto";
import { $Enums, PrismaService, PotStatus, ShareStatus, SettlementType, CompletionRule, AttributionMode } from "@paadi/db";
import { NudgeRepository } from "./nudge.repository";

type NudgeKind = $Enums.NudgeKind;
const CREATED_DELAY: NudgeKind = "CREATED_DELAY";

const DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://paadi:paadi@localhost:5433/paadi";

describe("NudgeRepository (integration, real Postgres :5433)", () => {
  let prisma: PrismaService;
  let repo: NudgeRepository;

  const userIds: string[] = [];
  const potIds: string[] = [];

  beforeAll(async () => {
    process.env.DATABASE_URL = DATABASE_URL;
    prisma = new PrismaService();
    await prisma.$connect();
    repo = new NudgeRepository(prisma);
  });

  afterAll(async () => {
    if (potIds.length > 0) {
      await prisma.splitNudge.deleteMany({ where: { split: { potId: { in: potIds } } } });
      await prisma.potNudge.deleteMany({ where: { potId: { in: potIds } } });
      await prisma.split.deleteMany({ where: { potId: { in: potIds } } });
      await prisma.pot.deleteMany({ where: { id: { in: potIds } } });
    }
    if (userIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await prisma.$disconnect();
  });

  async function seedUser(): Promise<string> {
    const user = await prisma.user.create({
      data: { phoneBlindIndex: `pbi-${randomUUID()}`, phoneEncrypted: "enc" },
    });
    userIds.push(user.id);
    return user.id;
  }

  async function seedPot(input: { id: string; creatorId: string; title: string; status: PotStatus; createdAt: Date; deadlineAt: Date | null; splitStatus: ShareStatus; }): Promise<void> {
    potIds.push(input.id);
    await prisma.pot.create({
      data: {
        id: input.id,
        creatorId: input.creatorId,
        title: input.title,
        totalKobo: 300000n,
        collectedKobo: 0n,
        targetKobo: 300000n,
        settlementType: SettlementType.WALLET,
        completionRule: CompletionRule.PROGRESSIVE,
        attributionMode: AttributionMode.CHECKOUT_LINK,
        status: input.status,
        deadlineAt: input.deadlineAt,
        createdAt: input.createdAt,
        updatedAt: input.createdAt,
        splits: {
          create: [
            {
              id: `${input.id}-split-1`,
              label: "Tobi",
              weight: 1,
              shareKobo: 100000n,
              paidKobo: 0n,
              status: input.splitStatus,
              payToken: `tok-${input.id}`,
              payerPhoneEnc: input.splitStatus === "PAID" ? null : "enc-phone",
            },
          ],
        },
      },
    });
  }

  it("findPotsDueForCreatedDelay returns only open/funded pots with unpaid splits and no prior nudge", async () => {
    const creatorId = await seedUser();
    await seedPot({
      id: `pot-due-${randomUUID()}`,
      creatorId,
      title: "Due pot",
      status: PotStatus.OPEN,
      createdAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
      deadlineAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
      splitStatus: ShareStatus.PENDING,
    });
    await seedPot({
      id: `pot-paid-${randomUUID()}`,
      creatorId,
      title: "Paid pot",
      status: PotStatus.OPEN,
      createdAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
      deadlineAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
      splitStatus: ShareStatus.PAID,
    });
    await seedPot({
      id: `pot-fresh-${randomUUID()}`,
      creatorId,
      title: "Fresh pot",
      status: PotStatus.OPEN,
      createdAt: new Date(Date.now() - 60 * 1000),
      deadlineAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
      splitStatus: ShareStatus.PENDING,
    });

    const rows = await repo.findPotsDueForCreatedDelay(24 * 60 * 60 * 1000, 10);
    expect(rows.map((row) => row.title)).toEqual(["Due pot"]);
    expect(rows[0].splits).toHaveLength(1);
    expect(rows[0].creator.phoneEncrypted).toBe("enc");
  });

  it("findPotsDueForDeadlineWindow returns pots inside the window and excludes prior nudge kinds", async () => {
    const creatorId = await seedUser();
    const potId = `pot-window-${randomUUID()}`;
    await seedPot({
      id: potId,
      creatorId,
      title: "Window pot",
      status: PotStatus.FUNDED,
      createdAt: new Date(Date.now() - 72 * 60 * 60 * 1000),
      deadlineAt: new Date(Date.now() + 60 * 60 * 1000),
      splitStatus: ShareStatus.PARTIALLY_PAID,
    });
    await prisma.potNudge.create({ data: { potId, kind: CREATED_DELAY, recipientCount: 1 } });

    const rows = await repo.findPotsDueForDeadlineWindow(2 * 60 * 60 * 1000, 10);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(potId);
    expect(rows[0].splits[0].status).toBe(ShareStatus.PARTIALLY_PAID);
  });

  it("markPotNudged and markSplitNudged swallow unique conflicts and keep one row", async () => {
    const creatorId = await seedUser();
    const potId = `pot-mark-${randomUUID()}`;
    await seedPot({
      id: potId,
      creatorId,
      title: "Mark pot",
      status: PotStatus.OPEN,
      createdAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
      deadlineAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
      splitStatus: ShareStatus.PENDING,
    });

    await repo.markPotNudged(potId, CREATED_DELAY, 1);
    await repo.markPotNudged(potId, CREATED_DELAY, 1);
    const splitId = `${potId}-split-1`;
    await repo.markSplitNudged(splitId, CREATED_DELAY);
    await repo.markSplitNudged(splitId, CREATED_DELAY);

    expect(await prisma.potNudge.count({ where: { potId, kind: CREATED_DELAY } })).toBe(1);
    expect(await prisma.splitNudge.count({ where: { splitId, kind: CREATED_DELAY } })).toBe(1);
  });
});