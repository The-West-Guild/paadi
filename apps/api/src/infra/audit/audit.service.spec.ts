import { ConfigService } from "@nestjs/config";
import { PrismaService } from "@paadi/db";
import { CryptoService } from "../../common/crypto/crypto.service";
import { AuditService } from "./audit.service";

interface FakeAuditRow {
  sequence: number;
  eventType: string;
  actorId: string | null;
  targetId: string | null;
  payloadHash: string;
  previousHash: string | null;
}

function build(options: { failCreate?: boolean } = {}) {
  const rows: FakeAuditRow[] = [];
  const tx = {
    $executeRaw: jest.fn(async () => 0),
    auditEvent: {
      findFirst: jest.fn(async () => (rows.length ? { payloadHash: rows[rows.length - 1].payloadHash } : null)),
      create: jest.fn(async ({ data }: { data: Omit<FakeAuditRow, "sequence"> }) => {
        if (options.failCreate) {
          throw new Error("db down");
        }
        const row: FakeAuditRow = {
          sequence: rows.length + 1,
          eventType: data.eventType,
          actorId: data.actorId ?? null,
          targetId: data.targetId ?? null,
          payloadHash: data.payloadHash,
          previousHash: data.previousHash ?? null
        };
        rows.push(row);
        return row;
      })
    }
  };
  const prisma = {
    $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx))
  } as unknown as PrismaService;
  const crypto = new CryptoService(new ConfigService({ nodeEnv: "test" }));
  const service = new AuditService(prisma, crypto);
  return { service, rows, tx };
}

describe("AuditService", () => {
  it("writes the first event with no previousHash", async () => {
    const { service, rows } = build();
    await service.record({ eventType: "apikey.minted", actorId: "user-1", targetId: "key-1" });
    expect(rows).toHaveLength(1);
    expect(rows[0].previousHash).toBeNull();
    expect(rows[0].payloadHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("chains each event to the previous event's payloadHash", async () => {
    const { service, rows } = build();
    await service.record({ eventType: "apikey.minted", actorId: "user-1" });
    await service.record({ eventType: "wallet.withdraw", actorId: "user-1" });
    await service.record({ eventType: "wallet.pay", actorId: "user-1" });

    expect(rows).toHaveLength(3);
    expect(rows[1].previousHash).toBe(rows[0].payloadHash);
    expect(rows[2].previousHash).toBe(rows[1].payloadHash);
    // chain verification: replay in sequence order
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].previousHash).toBe(rows[i - 1].payloadHash);
    }
  });

  it("serializes writers via the advisory transaction lock", async () => {
    const { service, tx } = build();
    await service.record({ eventType: "apikey.minted" });
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it("recordSafe swallows failures instead of blocking the caller", async () => {
    const { service } = build({ failCreate: true });
    await expect(service.recordSafe({ eventType: "wallet.pay" })).resolves.toBeUndefined();
    await expect(service.record({ eventType: "wallet.pay" })).rejects.toThrow("db down");
  });
});
