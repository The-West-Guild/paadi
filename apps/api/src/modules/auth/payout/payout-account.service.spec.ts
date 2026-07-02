import { ConfigService } from "@nestjs/config";
import { NotFoundException, UnauthorizedException } from "@nestjs/common";
import { PayoutAccount } from "@paadi/db";
import { CryptoService } from "../../../common/crypto/crypto.service";
import { PayoutAccountService } from "./payout-account.service";

function fakeProvider() {
  return {
    listBanks: jest.fn(async () => [
      { code: "044", name: "Access Bank" },
      { code: "058", name: "GTBank" }
    ]),
    lookupAccountName: jest.fn(async () => ({ accountName: "ADA OKEKE" }))
  };
}

function fakeRepo() {
  const rows = new Map<string, PayoutAccount>();
  let counter = 0;
  return {
    rows,
    create: jest.fn(async (input: Partial<PayoutAccount>) => {
      const id = `payout-${++counter}`;
      const row = {
        id,
        userId: input.userId!,
        bankCode: input.bankCode!,
        bankName: input.bankName!,
        accountNumberEnc: input.accountNumberEnc!,
        accountNumberLast4: input.accountNumberLast4!,
        accountName: input.accountName!,
        nameMatchVerified: input.nameMatchVerified ?? false,
        isPrimary: input.isPrimary ?? false,
        nombaRecipientRef: null,
        createdAt: new Date()
      } as PayoutAccount;
      rows.set(id, row);
      return row;
    }),
    listForUser: jest.fn(async (userId: string) =>
      [...rows.values()].filter((row) => row.userId === userId)
    ),
    findById: jest.fn(async (id: string) => rows.get(id) ?? null),
    setPrimary: jest.fn(async (userId: string, id: string) => {
      for (const row of rows.values()) {
        if (row.userId === userId) {
          row.isPrimary = row.id === id;
        }
      }
      return rows.get(id)!;
    }),
    remove: jest.fn(async (id: string) => {
      const row = rows.get(id)!;
      rows.delete(id);
      return row;
    }),
    hasAny: jest.fn(async (userId: string) =>
      [...rows.values()].some((row) => row.userId === userId)
    )
  };
}

function fakeProfileRepo() {
  return {
    findByUserId: jest.fn(async (userId: string) => ({
      userId,
      firstName: "Ada",
      lastName: "Okeke"
    }))
  };
}

function fakePin() {
  return {
    verify: jest.fn(async (_userId: string, pin: string) => {
      if (pin !== "1234") {
        throw new UnauthorizedException("invalid pin");
      }
      return { ok: true };
    })
  };
}

function buildService() {
  const provider = fakeProvider();
  const repo = fakeRepo();
  const profileRepo = fakeProfileRepo();
  const crypto = new CryptoService(new ConfigService({ nodeEnv: "test" }));
  const pin = fakePin();
  const service = new PayoutAccountService(
    provider as never,
    repo as never,
    profileRepo as never,
    crypto,
    pin as never
  );
  return { service, provider, repo, profileRepo, crypto, pin };
}

describe("PayoutAccountService", () => {
  it("rejects create with a wrong pin via step-up", async () => {
    const { service, repo } = buildService();
    await expect(service.create("user-1", "044", "0123456789", "0000")).rejects.toThrow(
      UnauthorizedException
    );
    expect(repo.create).not.toHaveBeenCalled();
  });

  it("returns a masked dto without the encrypted account number or full pan", async () => {
    const { service } = buildService();
    const dto = await service.create("user-1", "044", "0123456789", "1234");

    expect(dto.accountNumberLast4).toBe("6789");
    expect(dto.accountName).toBe("ADA OKEKE");
    expect(dto).not.toHaveProperty("accountNumberEnc");
    expect(dto).not.toHaveProperty("accountNumber");
    expect(JSON.stringify(dto)).not.toContain("0123456789");
  });

  it("marks the first account primary and subsequent accounts non-primary", async () => {
    const { service } = buildService();
    const first = await service.create("user-1", "044", "0123456789", "1234");
    const second = await service.create("user-1", "058", "9876543210", "1234");

    expect(first.isPrimary).toBe(true);
    expect(second.isPrimary).toBe(false);
  });

  it("does not let one user set another user's account as primary", async () => {
    const { service } = buildService();
    const owned = await service.create("user-1", "044", "0123456789", "1234");

    await expect(service.setPrimary("user-2", owned.id)).rejects.toThrow(NotFoundException);
  });

  it("does not let one user remove another user's account", async () => {
    const { service } = buildService();
    const owned = await service.create("user-1", "044", "0123456789", "1234");

    await expect(service.remove("user-2", owned.id, "1234")).rejects.toThrow(NotFoundException);
  });

  it("rejects remove with a wrong pin via step-up", async () => {
    const { service, repo } = buildService();
    const owned = await service.create("user-1", "044", "0123456789", "1234");

    await expect(service.remove("user-1", owned.id, "0000")).rejects.toThrow(UnauthorizedException);
    expect(repo.remove).not.toHaveBeenCalled();
  });
});
