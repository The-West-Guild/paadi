import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { payViewSchema, type CreatePotInput } from "@paadi/contracts";
import { CryptoService } from "../../common/crypto/crypto.service";
import type {
  CreatePotWithSplitsInput,
  UpdatePotPatch,
} from "../../infra/persistence/pot.repository";
import { PotsService } from "./pots.service";

interface FakeProfile {
  username: string;
  usernameNormalized: string;
  displayName: string | null;
  firstName: string | null;
  lastName: string | null;
  phoneNumber: string | null;
}

interface FakeSplit {
  id: string;
  potId: string;
  label: string;
  weight: number;
  shareKobo: bigint;
  paidKobo: bigint;
  status: string;
  checkoutOrderRef: string | null;
  payToken: string;
  checkoutUrl: string | null;
  payerPhoneHash: string | null;
  payerPhoneEnc: string | null;
  paidAt: Date | null;
  createdAt: Date;
}

interface FakePot {
  id: string;
  creatorId: string;
  title: string;
  description: string | null;
  totalKobo: bigint;
  collectedKobo: bigint;
  targetKobo: bigint;
  settlementType: string;
  completionRule: string;
  attributionMode: string;
  status: string;
  billerCategory: string | null;
  billerProductCode: string | null;
  billerCustomerId: string | null;
  meterType: string | null;
  payoutAccountId: string | null;
  deadlineAt: Date | null;
  createdAt: Date;
  splits: FakeSplit[];
  creatorProfile: FakeProfile;
}

interface FakePayoutAccount {
  id: string;
  userId: string;
  isPrimary: boolean;
  nameMatchVerified: boolean;
}

function makeRepo() {
  const potsById = new Map<string, FakePot>();
  const splitsById = new Map<string, FakeSplit>();
  const splitsByToken = new Map<string, FakeSplit>();
  const paymentsByPot = new Map<string, number>();
  let potCounter = 0;
  let tokenCounter = 0;

  function buildPot(input: CreatePotWithSplitsInput, id: string) {
    const splits = input.splits.map((s, i) => {
      const splitId = `${id}-split-${i}`;
      tokenCounter += 1;
      const split: FakeSplit = {
        id: splitId,
        potId: id,
        label: s.label,
        weight: s.weight,
        shareKobo: BigInt(s.shareKobo),
        paidKobo: 0n,
        status: "PENDING",
        checkoutOrderRef: null,
        payToken: `tok-${tokenCounter}`,
        checkoutUrl: null,
        payerPhoneHash: null,
        payerPhoneEnc: s.phoneEnc ?? null,
        paidAt: null,
        createdAt: new Date(Date.now() + i),
      };
      splitsById.set(splitId, split);
      splitsByToken.set(split.payToken, split);
      return split;
    });
    const pot: FakePot = {
      id,
      creatorId: input.creatorId,
      title: input.title,
      description: input.description ?? null,
      totalKobo: BigInt(input.totalKobo),
      collectedKobo: 0n,
      targetKobo: BigInt(input.targetKobo),
      settlementType: input.settlementType,
      completionRule: input.completionRule,
      attributionMode: input.attributionMode,
      status: "DRAFT",
      billerCategory: input.billerCategory ?? null,
      billerProductCode: input.billerProductCode ?? null,
      billerCustomerId: input.billerCustomerId ?? null,
      meterType: input.meterType ?? null,
      payoutAccountId: input.payoutAccountId ?? null,
      deadlineAt: input.deadlineAt ?? null,
      createdAt: new Date(),
      splits,
      creatorProfile: {
        username: "organizer",
        usernameNormalized: "organizer",
        displayName: "Orga Niser",
        firstName: "Orga",
        lastName: "Niser",
        phoneNumber: "+2348011112222",
      },
    };
    potsById.set(id, pot);
    return pot;
  }

  return {
    potsById,
    splitsById,
    paymentsByPot,
    createPotWithSplits: jest.fn(async (input: CreatePotWithSplitsInput) =>
      buildPot(input, `pot-${++potCounter}`),
    ),
    setCheckout: jest.fn(async (splitId: string, ref: string, url: string) => {
      const split = splitsById.get(splitId)!;
      split.checkoutOrderRef = ref;
      split.checkoutUrl = url;
      return split;
    }),
    markOpen: jest.fn(async (potId: string) => {
      const pot = potsById.get(potId)!;
      pot.status = "OPEN";
      return pot;
    }),
    findByIdForCreator: jest.fn(async (potId: string, creatorId: string) => {
      const pot = potsById.get(potId);
      if (!pot || pot.creatorId !== creatorId) {
        return null;
      }
      return pot;
    }),
    listForCreator: jest.fn(
      async (
        creatorId: string,
        _cursor?: string,
        _limit = 20,
        status?: string,
      ) => {
        const items = [...potsById.values()].filter(
          (pot) =>
            pot.creatorId === creatorId && (!status || pot.status === status),
        );
        return { items, nextCursor: null };
      },
    ),
    findByPayToken: jest.fn(async (token: string) => {
      const split = splitsByToken.get(token);
      if (!split) {
        return null;
      }
      const pot = potsById.get(split.potId)!;
      return {
        ...split,
        pot: {
          ...pot,
          splits: pot.splits.map((s) => ({ status: s.status })),
          creator: { profile: pot.creatorProfile },
        },
      };
    }),
    update: jest.fn(async (potId: string, patch: UpdatePotPatch) => {
      const pot = potsById.get(potId)!;
      if (patch.title !== undefined) pot.title = patch.title;
      if (patch.description !== undefined) pot.description = patch.description;
      if (patch.deadlineAt !== undefined) pot.deadlineAt = patch.deadlineAt;
      return pot;
    }),
    deleteIfNoPayments: jest.fn(async (potId: string) => {
      if ((paymentsByPot.get(potId) ?? 0) > 0) {
        return false;
      }
      potsById.delete(potId);
      return true;
    }),
    cancel: jest.fn(async (potId: string) => {
      const pot = potsById.get(potId)!;
      pot.status = "CANCELLED";
      return pot;
    }),
    hasPayments: jest.fn(
      async (potId: string) => (paymentsByPot.get(potId) ?? 0) > 0,
    ),
    countPaidSplits: jest.fn(async () => 0),
  };
}

function makeProvider() {
  return {
    createCheckoutOrder: jest.fn(
      async (_amountKobo: number, reference: string) => ({
        reference,
        checkoutLink: `https://checkout.nomba.com/pay/${reference}`,
      }),
    ),
  };
}

function flakyProvider(failOnCall: number) {
  let n = 0;
  return {
    createCheckoutOrder: jest.fn(
      async (_amountKobo: number, reference: string) => {
        n += 1;
        if (n === failOnCall) {
          throw new Error("nomba down");
        }
        return {
          reference,
          checkoutLink: `https://checkout.nomba.com/pay/${reference}`,
        };
      },
    ),
  };
}

function makeIdempotency() {
  const records = new Map<
    string,
    { requestHash: string; response?: unknown }
  >();
  return {
    records,
    remember: jest.fn(
      async (rec: { key: string; requestHash: string; response?: unknown }) => {
        const existing = records.get(rec.key);
        if (!existing) {
          records.set(rec.key, {
            requestHash: rec.requestHash,
            response: rec.response,
          });
          return true;
        }
        if (rec.response !== undefined) {
          existing.response = rec.response;
        }
        return false;
      },
    ),
    seen: jest.fn(async (key: string) => records.has(key)),
    getResult: jest.fn(async (key: string) => {
      const row = records.get(key);
      return row
        ? { requestHash: row.requestHash, response: row.response }
        : null;
    }),
  };
}

function makePayoutRepo(accounts: FakePayoutAccount[] = []) {
  const rows = new Map(accounts.map((a) => [a.id, a]));
  return {
    findById: jest.fn(async (id: string) => rows.get(id) ?? null),
    listForUser: jest.fn(async (userId: string) =>
      [...rows.values()].filter((a) => a.userId === userId),
    ),
  };
}

function buildService(
  opts: {
    provider?: ReturnType<typeof makeProvider>;
    payoutRepo?: ReturnType<typeof makePayoutRepo>;
  } = {},
) {
  const repo = makeRepo();
  const provider = opts.provider ?? makeProvider();
  const idempotency = makeIdempotency();
  const payoutRepo = opts.payoutRepo ?? makePayoutRepo();
  const crypto = new CryptoService(new ConfigService({ nodeEnv: "test" }));
  const service = new PotsService(
    repo as never,
    provider as never,
    idempotency as never,
    payoutRepo as never,
    crypto as never,
  );
  return { service, repo, provider, idempotency, payoutRepo, crypto };
}

function baseInput(overrides: Partial<CreatePotInput> = {}): CreatePotInput {
  return {
    title: "June NEPA",
    totalKobo: 10000,
    settlementType: "bill_payment",
    completionRule: "progressive",
    attributionMode: "checkout_link",
    splitMode: "weight",
    billerCategory: "electricity",
    billerProductCode: "IKEDC",
    billerCustomerId: "0123456789",
    meterType: "PREPAID",
    splits: [
      { label: "Tobi", weight: 1 },
      { label: "Ada", weight: 1 },
      { label: "Kunle", weight: 1 },
    ],
    ...overrides,
  } as CreatePotInput;
}

describe("PotsService.create", () => {
  it("splits a weight pot exactly and persists sum-exact shares", async () => {
    const { service } = buildService();
    const detail = await service.create("user-1", baseInput(), "idem-1");

    const shares = detail.splits.map((s) => s.shareKobo);
    expect(shares).toEqual([3334, 3333, 3333]);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(10000);
    expect(detail.status).toBe("open");
  });

  it("uses explicit amounts as-is and stays sum-exact", async () => {
    const { service } = buildService();
    const detail = await service.create(
      "user-1",
      baseInput({
        splitMode: "amount",
        splits: [
          { label: "Tobi", amountKobo: 5000 },
          { label: "Ada", amountKobo: 3000 },
          { label: "Kunle", amountKobo: 2000 },
        ],
      }),
      "idem-1",
    );

    expect(detail.splits.map((s) => s.shareKobo)).toEqual([5000, 3000, 2000]);
    expect(detail.splits.reduce((a, s) => a + s.shareKobo, 0)).toBe(10000);
  });

  it("converts percents to sum-exact shares", async () => {
    const { service } = buildService();
    const detail = await service.create(
      "user-1",
      baseInput({
        splitMode: "percent",
        splits: [
          { label: "Tobi", percent: 50 },
          { label: "Ada", percent: 30 },
          { label: "Kunle", percent: 20 },
        ],
      }),
      "idem-1",
    );

    expect(detail.splits.map((s) => s.shareKobo)).toEqual([5000, 3000, 2000]);
  });

  it("rejects amount-mode that does not sum to total without any DB write", async () => {
    const { service, repo } = buildService();
    await expect(
      service.create(
        "user-1",
        baseInput({
          splitMode: "amount",
          splits: [
            { label: "Tobi", amountKobo: 5000 },
            { label: "Ada", amountKobo: 3000 },
            { label: "Kunle", amountKobo: 1000 },
          ],
        }),
        "idem-1",
      ),
    ).rejects.toThrow();
    expect(repo.createPotWithSplits).not.toHaveBeenCalled();
  });

  it("mints one deterministic checkout order per split with unique pay tokens", async () => {
    const { service, repo, provider } = buildService();
    const detail = await service.create("user-1", baseInput(), "idem-1");

    for (const split of detail.splits) {
      expect(provider.createCheckoutOrder).toHaveBeenCalledWith(
        split.shareKobo,
        `paadi-${split.id}`,
      );
      expect(repo.splitsById.get(split.id)!.checkoutOrderRef).toBe(
        `paadi-${split.id}`,
      );
      expect(split.checkoutUrl).not.toBeNull();
    }

    const tokens = detail.splits.map((s) => s.payToken);
    expect(new Set(tokens).size).toBe(tokens.length);
  });

  it("flips DRAFT to OPEN only after all N links are minted", async () => {
    const { service, repo, provider } = buildService();
    const detail = await service.create("user-1", baseInput(), "idem-1");

    expect(provider.createCheckoutOrder).toHaveBeenCalledTimes(3);
    expect(repo.markOpen).toHaveBeenCalledTimes(1);
    expect(detail.status).toBe("open");
  });

  it("keeps the pot DRAFT and returns 502 on mint failure, then resumes on retry", async () => {
    const { service, repo, provider } = buildService({
      provider: flakyProvider(2),
    });
    const input = baseInput();

    let status = 0;
    try {
      await service.create("user-1", input, "idem-1");
    } catch (err) {
      status = (err as HttpException).getStatus();
    }
    expect(status).toBe(502);

    const pot = [...repo.potsById.values()][0];
    expect(pot.status).toBe("DRAFT");
    expect(pot.splits[0].checkoutOrderRef).not.toBeNull();
    expect(pot.splits[1].checkoutOrderRef).toBeNull();
    expect(pot.splits[2].checkoutOrderRef).toBeNull();

    const detail = await service.create("user-1", input, "idem-1");
    expect(detail.status).toBe("open");
    expect(repo.createPotWithSplits).toHaveBeenCalledTimes(1);
    expect(provider.createCheckoutOrder).toHaveBeenCalledTimes(4);
    expect(provider.createCheckoutOrder).toHaveBeenLastCalledWith(
      expect.any(Number),
      `paadi-${pot.splits[2].id}`,
    );
  });

  it("is idempotent for the same key and body (single write, cached replay)", async () => {
    const { service, repo } = buildService();
    const input = baseInput();
    const first = await service.create("user-1", input, "idem-1");
    const second = await service.create("user-1", input, "idem-1");

    expect(repo.createPotWithSplits).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
  });

  it("rejects the same idempotency key with a different body", async () => {
    const { service } = buildService();
    await service.create("user-1", baseInput(), "idem-1");
    await expect(
      service.create("user-1", baseInput({ title: "July NEPA" }), "idem-1"),
    ).rejects.toThrow(ConflictException);
  });

  it("defaults the deadline to seven days out when omitted", async () => {
    const { service, repo } = buildService();
    const before = Date.now();
    await service.create("user-1", baseInput(), "idem-1");
    const arg = repo.createPotWithSplits.mock.calls[0][0];

    const expected = before + 7 * 86_400_000;
    expect(Math.abs(arg.deadlineAt!.getTime() - expected)).toBeLessThan(5000);
  });

  it("rejects a deadline in the past", async () => {
    const { service, repo } = buildService();
    await expect(
      service.create(
        "user-1",
        baseInput({ deadlineAt: new Date(Date.now() - 60_000).toISOString() }),
        "idem-1",
      ),
    ).rejects.toThrow(BadRequestException);
    expect(repo.createPotWithSplits).not.toHaveBeenCalled();
  });

  it("creates a wallet-settlement pot without requiring biller or payout fields", async () => {
    const { service, repo } = buildService();
    const pot = await service.create(
      "user-1",
      baseInput({
        settlementType: "wallet",
        billerCategory: undefined,
        billerProductCode: undefined,
        billerCustomerId: undefined,
        meterType: undefined,
      }),
      "idem-1",
    );

    expect(repo.createPotWithSplits).toHaveBeenCalledTimes(1);
    expect(repo.createPotWithSplits.mock.calls[0][0].settlementType).toBe(
      "WALLET",
    );
    expect(repo.createPotWithSplits.mock.calls[0][0].payoutAccountId).toBeNull();
    expect(pot.settlementType).toBe("wallet");
    expect(pot.status).toBe("open");
  });

  it("rejects a totalKobo too small to split across participants", async () => {
    const { service, repo } = buildService();
    await expect(
      service.create("user-1", baseInput({ totalKobo: 2 }), "idem-1"),
    ).rejects.toThrow("too small");
    expect(repo.createPotWithSplits).not.toHaveBeenCalled();
  });
});

describe("PotsService.create bank_payout destination", () => {
  it("defaults to the creator's verified primary payout account", async () => {
    const { service, repo } = buildService({
      payoutRepo: makePayoutRepo([
        {
          id: "pa-1",
          userId: "user-1",
          isPrimary: true,
          nameMatchVerified: true,
        },
      ]),
    });
    await service.create(
      "user-1",
      baseInput({
        settlementType: "bank_payout",
        billerCategory: undefined,
        billerProductCode: undefined,
        billerCustomerId: undefined,
        meterType: undefined,
      }),
      "idem-1",
    );
    const arg = repo.createPotWithSplits.mock.calls[0][0];
    expect(arg.payoutAccountId).toBe("pa-1");
  });

  it("rejects a primary payout account that is not name-verified (403)", async () => {
    const { service } = buildService({
      payoutRepo: makePayoutRepo([
        {
          id: "pa-1",
          userId: "user-1",
          isPrimary: true,
          nameMatchVerified: false,
        },
      ]),
    });
    await expect(
      service.create(
        "user-1",
        baseInput({ settlementType: "bank_payout" }),
        "idem-1",
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it("404s when payoutAccountId is not owned by the creator", async () => {
    const { service } = buildService({
      payoutRepo: makePayoutRepo([
        {
          id: "pa-9",
          userId: "user-2",
          isPrimary: true,
          nameMatchVerified: true,
        },
      ]),
    });
    await expect(
      service.create(
        "user-1",
        baseInput({ settlementType: "bank_payout", payoutAccountId: "pa-9" }),
        "idem-1",
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it("400s when bank_payout has no payout account on file", async () => {
    const { service } = buildService({ payoutRepo: makePayoutRepo([]) });
    await expect(
      service.create(
        "user-1",
        baseInput({ settlementType: "bank_payout" }),
        "idem-1",
      ),
    ).rejects.toThrow(BadRequestException);
  });
});

describe("PotsService reads and lifecycle", () => {
  it("treats every owner-scoped operation as 404 for a non-owner", async () => {
    const { service } = buildService();
    const detail = await service.create("user-1", baseInput(), "idem-1");

    await expect(service.findOne(detail.id, "user-2")).rejects.toThrow(
      NotFoundException,
    );
    await expect(
      service.update(detail.id, "user-2", { title: "Hijack" }),
    ).rejects.toThrow(NotFoundException);
    await expect(service.delete(detail.id, "user-2")).rejects.toThrow(
      NotFoundException,
    );
    await expect(service.cancel(detail.id, "user-2")).rejects.toThrow(
      NotFoundException,
    );
  });

  it("rejects edits once a payment exists", async () => {
    const { service, repo } = buildService();
    const detail = await service.create("user-1", baseInput(), "idem-1");
    repo.paymentsByPot.set(detail.id, 1);

    await expect(
      service.update(detail.id, "user-1", { title: "New Title" }),
    ).rejects.toThrow(ConflictException);
  });

  it("blocks delete with payments but allows cancel", async () => {
    const { service, repo } = buildService();
    const detail = await service.create("user-1", baseInput(), "idem-1");
    repo.paymentsByPot.set(detail.id, 1);

    await expect(service.delete(detail.id, "user-1")).rejects.toThrow(
      ConflictException,
    );
    const cancelled = await service.cancel(detail.id, "user-1");
    expect(cancelled.status).toBe("cancelled");
  });

  it("hard-deletes a zero-payment pot", async () => {
    const { service, repo } = buildService();
    const detail = await service.create("user-1", baseInput(), "idem-1");

    await expect(service.delete(detail.id, "user-1")).resolves.toEqual({
      ok: true,
    });
    expect(repo.potsById.has(detail.id)).toBe(false);
  });

  it("rejects cancel from an illegal status with a 400", async () => {
    const { service, repo } = buildService();
    const detail = await service.create("user-1", baseInput(), "idem-1");
    repo.potsById.get(detail.id)!.status = "FUNDED";

    await expect(service.cancel(detail.id, "user-1")).rejects.toThrow(
      "invalid pool transition funded -> cancelled",
    );
  });
});

describe("PotsService.getPayerView", () => {
  it("returns only the payViewSchema keys with no sibling splits or PII", async () => {
    const { service } = buildService();
    const detail = await service.create("user-1", baseInput(), "idem-1");
    const token = detail.splits[0].payToken;

    const view = await service.getPayerView(token);

    expect(Object.keys(view).sort()).toEqual(
      Object.keys(payViewSchema.shape).sort(),
    );
    expect(view.splitLabel).toBe("Tobi");

    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain("Ada");
    expect(serialized).not.toContain("Kunle");
    expect(serialized).not.toContain("+2348011112222");
    expect(serialized).not.toContain("payerPhoneHash");
  });

  it("404s for an unknown pay token", async () => {
    const { service } = buildService();
    await expect(service.getPayerView("nope")).rejects.toThrow(
      NotFoundException,
    );
  });
});

describe("PotsService.split phone capture", () => {
  it("does not fail pot creation when a split phone is invalid or missing", async () => {
    const { service, repo } = buildService();

    await expect(
      service.create(
        "user-1",
        baseInput({
          splits: [
            { label: "Tobi", weight: 1, phone: "not-a-phone" },
            { label: "Ada", weight: 1 },
            { label: "Kunle", weight: 1 },
          ],
        }),
        "idem-phone-1",
      ),
    ).resolves.toBeDefined();

    const arg = repo.createPotWithSplits.mock.calls[0][0];
    expect(arg.splits[0].phoneEnc).toBeNull();
    expect(arg.splits[1].phoneEnc).toBeNull();
  });

  it("encrypts a valid split phone before persistence and the ciphertext round-trips", async () => {
    const { service, repo, crypto } = buildService();

    await service.create(
      "user-1",
      baseInput({
        splits: [
          { label: "Tobi", weight: 1, phone: "08012345678" },
          { label: "Ada", weight: 1 },
          { label: "Kunle", weight: 1 },
        ],
      }),
      "idem-phone-2",
    );

    const arg = repo.createPotWithSplits.mock.calls[0][0];
    expect(arg.splits[0].phoneEnc).not.toBeNull();
    expect(crypto.decryptPhone(arg.splits[0].phoneEnc!)).toBe("+2348012345678");
  });
});
