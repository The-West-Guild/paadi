import { ForbiddenException, NotFoundException } from "@nestjs/common";
import {
  AccountStatus,
  KycStatus,
  Tier,
  VirtualAccountKind,
  VirtualAccountStatus
} from "@paadi/db";
import type {
  CreateVirtualAccountInput,
  UpdateVirtualAccountInput,
  VirtualAccountDetails
} from "@paadi/domain";
import type { PersistVirtualAccountInput } from "../../infra/persistence/virtual-account.repository";
import { VirtualAccountService } from "./virtual-account.service";

interface FakeUser {
  id: string;
  tier: Tier;
  kycStatus: KycStatus;
  status: AccountStatus;
}

interface FakeProfile {
  firstName: string | null;
  lastName: string | null;
  displayName: string | null;
}

interface FakeRow {
  id: string;
  userId: string;
  accountNumber: string;
  accountName: string;
  providerBank: string;
  nombaAccountRef: string;
  status: VirtualAccountStatus;
  kind: VirtualAccountKind;
  createdAt: Date;
  updatedAt: Date;
  closedAt: Date | null;
}

function rowFor(
  input: PersistVirtualAccountInput,
  status: VirtualAccountStatus = VirtualAccountStatus.ACTIVE
): FakeRow {
  return {
    id: `va-${input.userId}`,
    userId: input.userId,
    accountNumber: input.accountNumber,
    accountName: input.accountName,
    providerBank: input.providerBank,
    nombaAccountRef: input.nombaAccountRef,
    status,
    kind: VirtualAccountKind.STATIC,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    closedAt: null
  };
}

function details(overrides: Partial<VirtualAccountDetails> = {}): VirtualAccountDetails {
  return {
    accountHolderId: "acct-holder-1",
    accountRef: "va_user-1",
    accountNumber: "9012345678",
    accountName: "Nomba/ADA OKEKE",
    providerBank: "Paadi MFB",
    currency: "NGN",
    expired: false,
    ...overrides
  };
}

function makeUserRepo(user: FakeUser | null) {
  return {
    findById: jest.fn(async (_id: string) => user)
  };
}

function makeProfileRepo(profile: FakeProfile | null) {
  return {
    findByUserId: jest.fn(async (_userId: string) => profile)
  };
}

function makeRepo(seed: FakeRow | null = null) {
  const rows = new Map<string, FakeRow>();
  if (seed) {
    rows.set(seed.userId, seed);
  }
  return {
    rows,
    findByUserId: jest.fn(async (userId: string) => rows.get(userId) ?? null),
    provisionVirtualAccount: jest.fn(async (input: PersistVirtualAccountInput) => {
      const existing = rows.get(input.userId);
      if (existing) {
        return { virtualAccount: existing, created: false };
      }
      const created = rowFor(input);
      rows.set(input.userId, created);
      return { virtualAccount: created, created: true };
    }),
    updateName: jest.fn(async (userId: string, accountName: string) => {
      const row = rows.get(userId)!;
      row.accountName = accountName;
      return row;
    }),
    setStatus: jest.fn(async (userId: string, status: VirtualAccountStatus) => {
      const row = rows.get(userId)!;
      row.status = status;
      return row;
    }),
    close: jest.fn(async (userId: string) => {
      const row = rows.get(userId)!;
      row.status = VirtualAccountStatus.CLOSED;
      row.closedAt = new Date("2026-02-02T00:00:00.000Z");
      return row;
    })
  };
}

function makeProvider(create: VirtualAccountDetails = details()) {
  return {
    createVirtualAccount: jest.fn(async (_input: CreateVirtualAccountInput) => create),
    updateVirtualAccount: jest.fn(
      async (_identifier: string, input: UpdateVirtualAccountInput) =>
        details({ accountName: `Nomba/${input.accountName ?? ""}` })
    ),
    expireVirtualAccount: jest.fn(async (_identifier: string) => undefined)
  };
}

function build(opts: {
  user?: FakeUser | null;
  profile?: FakeProfile | null;
  seed?: FakeRow | null;
  create?: VirtualAccountDetails;
} = {}) {
  const userRepo = makeUserRepo(
    opts.user === undefined
      ? { id: "user-1", tier: Tier.TIER_1, kycStatus: KycStatus.VERIFIED, status: AccountStatus.ACTIVE }
      : opts.user
  );
  const profileRepo = makeProfileRepo(
    opts.profile === undefined ? { firstName: "Ada", lastName: "Okeke", displayName: "Ada O" } : opts.profile
  );
  const repo = makeRepo(opts.seed ?? null);
  const provider = makeProvider(opts.create);
  const service = new VirtualAccountService(
    userRepo as never,
    profileRepo as never,
    repo as never,
    provider as never
  );
  return { service, userRepo, profileRepo, repo, provider };
}

describe("VirtualAccountService.getForUser", () => {
  it("returns the existing VA for the user", async () => {
    const seed = rowFor({
      userId: "user-1",
      accountNumber: "9012345678",
      accountName: "Nomba/ADA OKEKE",
      providerBank: "Paadi MFB",
      nombaAccountRef: "va_user-1"
    });
    const { service } = build({ seed });
    await expect(service.getForUser("user-1")).resolves.toBe(seed);
  });

  it("throws NotFound with a lowercase message when none exists", async () => {
    const { service } = build();
    await expect(service.getForUser("user-1")).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.getForUser("user-1")).rejects.toThrow("no virtual account");
  });
});

describe("VirtualAccountService holder-name derivation", () => {
  it("uses the verified legal name uppercased and collapsed", async () => {
    const { service, provider } = build({
      profile: { firstName: "  ada", lastName: "okeke ", displayName: "nickname" }
    });
    await service.provisionVirtualAccount("user-1");
    expect(provider.createVirtualAccount).toHaveBeenCalledWith(
      expect.objectContaining({ accountName: "ADA OKEKE" })
    );
  });

  it("ASCII-folds diacritics in the legal name", async () => {
    const { service, provider } = build({
      profile: { firstName: "Chiamaka", lastName: "Ọnyẹ́kà", displayName: null }
    });
    await service.provisionVirtualAccount("user-1");
    const arg = provider.createVirtualAccount.mock.calls[0][0].accountName as string;
    expect(arg).toBe("CHIAMAKA ONYEKA");
    expect(arg).toMatch(/^[\x20-\x7e]+$/);
  });

  it("falls back to displayName when the legal name is absent", async () => {
    const { service, provider } = build({
      profile: { firstName: null, lastName: null, displayName: "Tunde Ade" }
    });
    await service.provisionVirtualAccount("user-1");
    expect(provider.createVirtualAccount).toHaveBeenCalledWith(
      expect.objectContaining({ accountName: "TUNDE ADE" })
    );
  });

  it("pads a too-short name up to the provider minimum", async () => {
    const { service, provider } = build({
      profile: { firstName: "Ab", lastName: null, displayName: null }
    });
    await service.provisionVirtualAccount("user-1");
    const arg = provider.createVirtualAccount.mock.calls[0][0].accountName as string;
    expect(arg.length).toBeGreaterThanOrEqual(8);
    expect(arg.startsWith("AB")).toBe(true);
  });
});

describe("VirtualAccountService eligibility predicate", () => {
  const cases: { label: string; user: FakeUser; eligible: boolean }[] = [
    {
      label: "TIER_0 rejected",
      user: { id: "user-1", tier: Tier.TIER_0, kycStatus: KycStatus.VERIFIED, status: AccountStatus.ACTIVE },
      eligible: false
    },
    {
      label: "kyc not verified rejected",
      user: { id: "user-1", tier: Tier.TIER_1, kycStatus: KycStatus.PENDING, status: AccountStatus.ACTIVE },
      eligible: false
    },
    {
      label: "suspended account rejected",
      user: { id: "user-1", tier: Tier.TIER_1, kycStatus: KycStatus.VERIFIED, status: AccountStatus.SUSPENDED },
      eligible: false
    },
    {
      label: "TIER_1 + VERIFIED + ACTIVE accepted",
      user: { id: "user-1", tier: Tier.TIER_1, kycStatus: KycStatus.VERIFIED, status: AccountStatus.ACTIVE },
      eligible: true
    }
  ];

  for (const { label, user, eligible } of cases) {
    it(label, async () => {
      const { service, provider, repo } = build({ user });
      if (eligible) {
        const outcome = await service.provisionVirtualAccount("user-1");
        expect(outcome.created).toBe(true);
        expect(provider.createVirtualAccount).toHaveBeenCalledTimes(1);
      } else {
        await expect(service.provisionVirtualAccount("user-1")).rejects.toBeInstanceOf(
          ForbiddenException
        );
        await expect(service.provisionVirtualAccount("user-1")).rejects.toThrow(
          "kyc verification required"
        );
        expect(provider.createVirtualAccount).not.toHaveBeenCalled();
        expect(repo.provisionVirtualAccount).not.toHaveBeenCalled();
      }
    });
  }

  it("throws ForbiddenException when the user does not exist", async () => {
    const { service, provider } = build({ user: null });
    await expect(service.provisionVirtualAccount("user-1")).rejects.toBeInstanceOf(
      ForbiddenException
    );
    expect(provider.createVirtualAccount).not.toHaveBeenCalled();
  });
});

describe("VirtualAccountService.provisionVirtualAccount idempotency", () => {
  it("sends the deterministic va_<userId> reference and stores it as nombaAccountRef", async () => {
    const { service, provider, repo } = build();
    await service.provisionVirtualAccount("user-1");
    expect(provider.createVirtualAccount).toHaveBeenCalledWith(
      expect.objectContaining({ accountRef: "va_user-1" })
    );
    expect(repo.provisionVirtualAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        accountNumber: "9012345678",
        accountName: "Nomba/ADA OKEKE",
        providerBank: "Paadi MFB",
        nombaAccountRef: "va_user-1"
      })
    );
  });

  it("short-circuits a second provision to the existing row with no second provider call", async () => {
    const { service, provider, repo, userRepo } = build();

    const first = await service.provisionVirtualAccount("user-1");
    expect(first.created).toBe(true);

    const second = await service.provisionVirtualAccount("user-1");
    expect(second.created).toBe(false);
    expect(second.virtualAccount).toBe(first.virtualAccount);

    expect(provider.createVirtualAccount).toHaveBeenCalledTimes(1);
    expect(repo.provisionVirtualAccount).toHaveBeenCalledTimes(1);
    expect(userRepo.findById).toHaveBeenCalledTimes(1);
  });

  it("does not consult the eligibility gate when a VA already exists", async () => {
    const seed = rowFor({
      userId: "user-1",
      accountNumber: "9012345678",
      accountName: "Nomba/ADA OKEKE",
      providerBank: "Paadi MFB",
      nombaAccountRef: "va_user-1"
    });
    const { service, userRepo, provider } = build({
      seed,
      user: { id: "user-1", tier: Tier.TIER_0, kycStatus: KycStatus.NONE, status: AccountStatus.SUSPENDED }
    });
    const outcome = await service.provisionVirtualAccount("user-1");
    expect(outcome.created).toBe(false);
    expect(userRepo.findById).not.toHaveBeenCalled();
    expect(provider.createVirtualAccount).not.toHaveBeenCalled();
  });
});

describe("VirtualAccountService.renameFromIdentity diff-gate", () => {
  function seededRename(accountName: string) {
    const seed = rowFor({
      userId: "user-1",
      accountNumber: "9012345678",
      accountName,
      providerBank: "Paadi MFB",
      nombaAccountRef: "va_user-1"
    });
    return seed;
  }

  it("does not call the provider when the recomputed name matches the stored name", async () => {
    const { service, provider, repo } = build({
      seed: seededRename("ADA OKEKE"),
      profile: { firstName: "Ada", lastName: "Okeke", displayName: null }
    });
    const result = await service.renameFromIdentity("user-1");
    expect(result?.accountName).toBe("ADA OKEKE");
    expect(provider.updateVirtualAccount).not.toHaveBeenCalled();
    expect(repo.updateName).not.toHaveBeenCalled();
  });

  it("renames via the provider and stores the returned name when it differs", async () => {
    const { service, provider, repo } = build({
      seed: seededRename("OLD NAME"),
      profile: { firstName: "Tunde", lastName: "Ade", displayName: null }
    });
    const result = await service.renameFromIdentity("user-1");
    expect(provider.updateVirtualAccount).toHaveBeenCalledWith("va_user-1", {
      accountName: "TUNDE ADE"
    });
    expect(repo.updateName).toHaveBeenCalledWith("user-1", "Nomba/TUNDE ADE");
    expect(result?.accountName).toBe("Nomba/TUNDE ADE");
  });

  it("returns null and is a no-op when no VA exists", async () => {
    const { service, provider } = build();
    await expect(service.renameFromIdentity("user-1")).resolves.toBeNull();
    expect(provider.updateVirtualAccount).not.toHaveBeenCalled();
  });

  it("returns null and does not touch a CLOSED VA", async () => {
    const seed = rowFor(
      {
        userId: "user-1",
        accountNumber: "9012345678",
        accountName: "ADA OKEKE",
        providerBank: "Paadi MFB",
        nombaAccountRef: "va_user-1"
      },
      VirtualAccountStatus.CLOSED
    );
    const { service, provider } = build({ seed });
    await expect(service.renameFromIdentity("user-1")).resolves.toBeNull();
    expect(provider.updateVirtualAccount).not.toHaveBeenCalled();
  });
});

describe("VirtualAccountService lifecycle transitions", () => {
  function seed(status: VirtualAccountStatus) {
    return rowFor(
      {
        userId: "user-1",
        accountNumber: "9012345678",
        accountName: "ADA OKEKE",
        providerBank: "Paadi MFB",
        nombaAccountRef: "va_user-1"
      },
      status
    );
  }

  it("suspends an ACTIVE VA", async () => {
    const { service, repo } = build({ seed: seed(VirtualAccountStatus.ACTIVE) });
    const result = await service.suspend("user-1");
    expect(result?.status).toBe(VirtualAccountStatus.SUSPENDED);
    expect(repo.setStatus).toHaveBeenCalledWith("user-1", VirtualAccountStatus.SUSPENDED);
  });

  it("does not re-suspend a non-ACTIVE VA", async () => {
    const { service, repo } = build({ seed: seed(VirtualAccountStatus.SUSPENDED) });
    const result = await service.suspend("user-1");
    expect(result?.status).toBe(VirtualAccountStatus.SUSPENDED);
    expect(repo.setStatus).not.toHaveBeenCalled();
  });

  it("restores a SUSPENDED VA back to ACTIVE", async () => {
    const { service, repo } = build({ seed: seed(VirtualAccountStatus.SUSPENDED) });
    const result = await service.restore("user-1");
    expect(result?.status).toBe(VirtualAccountStatus.ACTIVE);
    expect(repo.setStatus).toHaveBeenCalledWith("user-1", VirtualAccountStatus.ACTIVE);
  });

  it("does not restore an ACTIVE VA", async () => {
    const { service, repo } = build({ seed: seed(VirtualAccountStatus.ACTIVE) });
    await service.restore("user-1");
    expect(repo.setStatus).not.toHaveBeenCalled();
  });

  it("closes an ACTIVE VA, expiring it at the provider first", async () => {
    const { service, provider, repo } = build({ seed: seed(VirtualAccountStatus.ACTIVE) });
    const result = await service.close("user-1");
    expect(provider.expireVirtualAccount).toHaveBeenCalledWith("va_user-1");
    expect(repo.close).toHaveBeenCalledWith("user-1");
    expect(result?.status).toBe(VirtualAccountStatus.CLOSED);
    expect(result?.closedAt).not.toBeNull();
  });

  it("closure is terminal: a CLOSED VA is never expired or re-closed", async () => {
    const { service, provider, repo } = build({ seed: seed(VirtualAccountStatus.CLOSED) });
    const result = await service.close("user-1");
    expect(result?.status).toBe(VirtualAccountStatus.CLOSED);
    expect(provider.expireVirtualAccount).not.toHaveBeenCalled();
    expect(repo.close).not.toHaveBeenCalled();
  });

  it("suspend/restore/close on a missing VA are safe no-ops returning null", async () => {
    const { service, provider, repo } = build();
    await expect(service.suspend("user-1")).resolves.toBeNull();
    await expect(service.restore("user-1")).resolves.toBeNull();
    await expect(service.close("user-1")).resolves.toBeNull();
    expect(provider.expireVirtualAccount).not.toHaveBeenCalled();
    expect(repo.setStatus).not.toHaveBeenCalled();
    expect(repo.close).not.toHaveBeenCalled();
  });
});
