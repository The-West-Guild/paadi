import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { virtualAccountResponseSchema } from "@paadi/contracts";
import { AccountStatus, KycStatus, Tier, VirtualAccountKind, VirtualAccountStatus } from "@paadi/db";
import type { AccessClaims } from "../../infra/auth/token.service";
import type { ProvisionOutcome } from "./virtual-account.service";
import { VirtualAccountsController } from "./virtual-accounts.controller";

interface FakeUser {
  tier: Tier;
  kycStatus: KycStatus;
  status: AccountStatus;
}

function rowFor(userId: string, overrides: Partial<ProvisionOutcome["virtualAccount"]> = {}) {
  return {
    id: `va-${userId}`,
    userId,
    accountNumber: `90${userId.replace(/\D/g, "").padStart(8, "1").slice(0, 8)}`,
    accountName: "Nomba/ADA OKEKE",
    providerBank: "Paadi MFB",
    nombaAccountRef: `acct-${userId}`,
    status: VirtualAccountStatus.ACTIVE,
    kind: VirtualAccountKind.STATIC,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    closedAt: null,
    ...overrides
  };
}

function makeService(users: Record<string, FakeUser>) {
  const rows = new Map<string, ReturnType<typeof rowFor>>();
  function eligible(userId: string): boolean {
    const u = users[userId];
    return (
      !!u &&
      u.tier !== Tier.TIER_0 &&
      u.kycStatus === KycStatus.VERIFIED &&
      u.status === AccountStatus.ACTIVE
    );
  }
  return {
    rows,
    getForUser: jest.fn(async (userId: string) => {
      const row = rows.get(userId);
      if (!row) {
        throw new NotFoundException("no virtual account");
      }
      return row;
    }),
    provisionVirtualAccount: jest.fn(async (userId: string): Promise<ProvisionOutcome> => {
      const existing = rows.get(userId);
      if (existing) {
        return { virtualAccount: existing, created: false };
      }
      if (!eligible(userId)) {
        throw new ForbiddenException("kyc verification required");
      }
      const created = rowFor(userId);
      rows.set(userId, created);
      return { virtualAccount: created, created: true };
    })
  };
}

function makeRes() {
  return { status: jest.fn((_code: number) => undefined) };
}

function claimsFor(sub: string): AccessClaims {
  return { sub } as AccessClaims;
}

const verified: FakeUser = {
  tier: Tier.TIER_1,
  kycStatus: KycStatus.VERIFIED,
  status: AccountStatus.ACTIVE
};

const unverified: FakeUser = {
  tier: Tier.TIER_0,
  kycStatus: KycStatus.NONE,
  status: AccountStatus.ACTIVE
};

describe("VirtualAccountsController GET /me/virtual-account", () => {
  it("404s when the caller has no VA", async () => {
    const service = makeService({ "user-1": verified });
    const controller = new VirtualAccountsController(service as never);
    await expect(controller.get(claimsFor("user-1"))).rejects.toBeInstanceOf(NotFoundException);
    await expect(controller.get(claimsFor("user-1"))).rejects.toThrow("no virtual account");
  });

  it("returns only the response DTO fields (no nombaAccountRef leak) for the caller", async () => {
    const service = makeService({ "user-1": verified });
    const controller = new VirtualAccountsController(service as never);
    const res = makeRes();

    await controller.provision(claimsFor("user-1"), {}, res as never);
    const view = await controller.get(claimsFor("user-1"));

    expect(() => virtualAccountResponseSchema.parse(view)).not.toThrow();
    expect(Object.keys(view).sort()).toEqual(Object.keys(virtualAccountResponseSchema.shape).sort());
    expect(service.getForUser).toHaveBeenCalledWith("user-1");
    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain("nombaAccountRef");
    expect(serialized).not.toContain("acct-user-1");
    expect(view.createdAt).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("VirtualAccountsController POST /me/virtual-account", () => {
  it("mints and returns 201 for an eligible caller with no VA", async () => {
    const service = makeService({ "user-1": verified });
    const controller = new VirtualAccountsController(service as never);
    const res = makeRes();

    const view = await controller.provision(claimsFor("user-1"), {}, res as never);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(service.provisionVirtualAccount).toHaveBeenCalledWith("user-1");
    expect(view.status).toBe("ACTIVE");
    expect(() => virtualAccountResponseSchema.parse(view)).not.toThrow();
  });

  it("is idempotent: a second POST returns 200 with the same account number and no second mint", async () => {
    const service = makeService({ "user-1": verified });
    const controller = new VirtualAccountsController(service as never);

    const firstRes = makeRes();
    const first = await controller.provision(claimsFor("user-1"), {}, firstRes as never);
    expect(firstRes.status).toHaveBeenCalledWith(201);

    const secondRes = makeRes();
    const second = await controller.provision(claimsFor("user-1"), {}, secondRes as never);
    expect(secondRes.status).toHaveBeenCalledWith(200);

    expect(second.accountNumber).toBe(first.accountNumber);
    expect(service.rows.size).toBe(1);
  });

  it("403s for an ineligible (TIER_0 / unverified) caller and mints nothing", async () => {
    const service = makeService({ "user-1": unverified });
    const controller = new VirtualAccountsController(service as never);
    const res = makeRes();

    await expect(controller.provision(claimsFor("user-1"), {}, res as never)).rejects.toBeInstanceOf(
      ForbiddenException
    );
    await expect(controller.provision(claimsFor("user-1"), {}, res as never)).rejects.toThrow(
      "kyc verification required"
    );
    expect(res.status).not.toHaveBeenCalled();
    expect(service.rows.size).toBe(0);
  });
});

describe("VirtualAccountsController self-scoping (IDOR)", () => {
  it("scopes GET to claims.sub — one caller never sees another's VA", async () => {
    const service = makeService({ "user-1": verified, "user-2": verified });
    const controller = new VirtualAccountsController(service as never);

    await controller.provision(claimsFor("user-1"), {}, makeRes() as never);

    const mine = await controller.get(claimsFor("user-1"));
    expect(mine.accountNumber).toBe(service.rows.get("user-1")!.accountNumber);

    await expect(controller.get(claimsFor("user-2"))).rejects.toBeInstanceOf(NotFoundException);
    expect(service.getForUser).toHaveBeenLastCalledWith("user-2");
  });

  it("scopes POST to claims.sub — each caller provisions only their own row", async () => {
    const service = makeService({ "user-1": verified, "user-2": verified });
    const controller = new VirtualAccountsController(service as never);

    const view1 = await controller.provision(claimsFor("user-1"), {}, makeRes() as never);
    const view2 = await controller.provision(claimsFor("user-2"), {}, makeRes() as never);

    expect(view1.accountNumber).not.toBe(view2.accountNumber);
    expect(service.provisionVirtualAccount).toHaveBeenNthCalledWith(1, "user-1");
    expect(service.provisionVirtualAccount).toHaveBeenNthCalledWith(2, "user-2");
    expect(service.rows.get("user-1")!.userId).toBe("user-1");
    expect(service.rows.get("user-2")!.userId).toBe("user-2");
  });
});
