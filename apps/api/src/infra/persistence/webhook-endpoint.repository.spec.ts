import { randomUUID } from "node:crypto";
import { ConfigService } from "@nestjs/config";
import { PrismaService, Tier as DbTier, WebhookEndpointStatus as DbWebhookEndpointStatus } from "@paadi/db";
import { CryptoService } from "../../common/crypto/crypto.service";
import { WebhookEndpointRepository } from "./webhook-endpoint.repository";

const DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://paadi:paadi@localhost:5433/paadi";

describe("WebhookEndpointRepository (integration, real Postgres :5433)", () => {
  let prisma: PrismaService;
  let crypto: CryptoService;
  let repo: WebhookEndpointRepository;

  const userIds: string[] = [];
  const endpointIds: string[] = [];

  beforeAll(async () => {
    process.env.DATABASE_URL = DATABASE_URL;
    prisma = new PrismaService();
    await prisma.$connect();
    crypto = new CryptoService(new ConfigService({ nodeEnv: "test" }));
    repo = new WebhookEndpointRepository(prisma, crypto);
  });

  afterAll(async () => {
    if (endpointIds.length > 0) {
      await prisma.webhookDelivery.deleteMany({ where: { endpointId: { in: endpointIds } } });
      await prisma.webhookEventOut.deleteMany({ where: { endpointId: { in: endpointIds } } });
      await prisma.webhookEndpoint.deleteMany({ where: { id: { in: endpointIds } } });
    }
    if (userIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await prisma.$disconnect();
  });

  async function seedUser(): Promise<string> {
    const user = await prisma.user.create({
      data: { phoneBlindIndex: `pbi-${randomUUID()}`, phoneEncrypted: "enc", tier: DbTier.TIER_1 }
    });
    userIds.push(user.id);
    return user.id;
  }

  async function register(userId: string, events: string[], url?: string) {
    const registered = await repo.register({
      userId,
      url: url ?? `https://tenant.example/${randomUUID()}`,
      events
    });
    endpointIds.push(registered.endpoint.id);
    return registered;
  }

  it("stores a hashed and encrypted secret at rest and returns the plaintext exactly once", async () => {
    const userId = await seedUser();

    const { endpoint, secret } = await register(userId, ["wallet.credited"]);

    expect(secret).toEqual(expect.any(String));
    expect(secret.length).toBeGreaterThan(0);

    const row = await prisma.webhookEndpoint.findUniqueOrThrow({ where: { id: endpoint.id } });
    expect(row.secretHash).not.toBe(secret);
    expect(row.secretEnc).not.toBe(secret);
    expect(row.secretEnc).not.toContain(secret);
    expect(await crypto.verifySecret(row.secretHash, secret)).toBe(true);
    expect(crypto.decryptAccountNumber(row.secretEnc)).toBe(secret);
    expect(repo.revealSecret(row)).toBe(secret);
  });

  it("issues a distinct secret per registration", async () => {
    const userId = await seedUser();

    const first = await register(userId, ["wallet.credited"]);
    const second = await register(userId, ["wallet.credited"]);

    expect(first.secret).not.toBe(second.secret);
  });

  it("findActiveForEvent returns only ACTIVE endpoints subscribed to the event, scoped to the owner", async () => {
    const owner = await seedUser();
    const other = await seedUser();

    const subscribed = await register(owner, ["wallet.credited", "wallet.debited"]);
    await register(owner, ["withdrawal.completed"]);
    const disabled = await register(owner, ["wallet.credited"]);
    await repo.disable(disabled.endpoint.id);
    await register(other, ["wallet.credited"]);

    const matches = await repo.findActiveForEvent(owner, "wallet.credited");

    expect(matches.map((m) => m.id)).toEqual([subscribed.endpoint.id]);
  });

  it("findActiveForEvent excludes an endpoint that does not subscribe to the event type", async () => {
    const userId = await seedUser();
    await register(userId, ["withdrawal.completed"]);

    const matches = await repo.findActiveForEvent(userId, "wallet.credited");

    expect(matches).toHaveLength(0);
  });

  it("listForUser returns the owner's endpoints newest-first and never another user's", async () => {
    const owner = await seedUser();
    const other = await seedUser();
    const older = await register(owner, ["wallet.credited"]);
    const newer = await register(owner, ["wallet.debited"]);
    const foreign = await register(other, ["wallet.credited"]);

    const rows = await repo.listForUser(owner);

    const ids = rows.map((r) => r.id);
    expect(ids).toContain(older.endpoint.id);
    expect(ids).toContain(newer.endpoint.id);
    expect(ids).not.toContain(foreign.endpoint.id);
    expect(ids.indexOf(newer.endpoint.id)).toBeLessThan(ids.indexOf(older.endpoint.id));
  });

  it("rotateSecret replaces the stored hash and ciphertext and returns a new plaintext, invalidating the old secret", async () => {
    const userId = await seedUser();
    const { endpoint, secret: original } = await register(userId, ["wallet.credited"]);

    const rotated = await repo.rotateSecret(endpoint.id);

    expect(rotated.secret).not.toBe(original);
    const row = await prisma.webhookEndpoint.findUniqueOrThrow({ where: { id: endpoint.id } });
    expect(crypto.decryptAccountNumber(row.secretEnc)).toBe(rotated.secret);
    expect(await crypto.verifySecret(row.secretHash, rotated.secret)).toBe(true);
    expect(await crypto.verifySecret(row.secretHash, original)).toBe(false);
  });

  it("disable flips the status to DISABLED so the endpoint no longer matches fan-out", async () => {
    const userId = await seedUser();
    const { endpoint } = await register(userId, ["wallet.credited"]);

    const disabled = await repo.disable(endpoint.id);

    expect(disabled.status).toBe(DbWebhookEndpointStatus.DISABLED);
    expect(await repo.findActiveForEvent(userId, "wallet.credited")).toHaveLength(0);
  });

  it("findById returns the row for an existing endpoint and null for an unknown id", async () => {
    const userId = await seedUser();
    const { endpoint } = await register(userId, ["wallet.credited"]);

    expect((await repo.findById(endpoint.id))?.id).toBe(endpoint.id);
    expect(await repo.findById(randomUUID())).toBeNull();
  });
});
