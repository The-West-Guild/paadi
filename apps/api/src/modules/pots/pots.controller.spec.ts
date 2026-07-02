import { BadRequestException, NotFoundException } from "@nestjs/common";
import { payViewSchema, type CreatePotInput } from "@paadi/contracts";
import type {
  CreatePotWithSplitsInput,
  UpdatePotPatch,
} from "../../infra/persistence/pot.repository";
import type { AccessClaims } from "../../infra/auth/token.service";
import { PayController } from "./pay.controller";
import { PotsController } from "./pots.controller";
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

function build() {
  const repo = makeRepo();
  const provider = makeProvider();
  const idempotency = makeIdempotency();
  const payoutRepo = makePayoutRepo();
  const service = new PotsService(
    repo as never,
    provider as never,
    idempotency as never,
    payoutRepo as never,
  );
  const controller = new PotsController(service);
  const payController = new PayController(service);
  return {
    repo,
    provider,
    idempotency,
    payoutRepo,
    service,
    controller,
    payController,
  };
}

function claimsFor(sub: string): AccessClaims {
  return { sub } as AccessClaims;
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

describe("PotsController create", () => {
  it("creates an OPEN pot with N minted splits whose shares sum to totalKobo", async () => {
    const { controller, repo, provider } = build();
    const detail = await controller.create(
      claimsFor("user-1"),
      "idem-1",
      baseInput(),
    );

    expect(detail.status).toBe("open");
    expect(detail.splits).toHaveLength(3);
    expect(provider.createCheckoutOrder).toHaveBeenCalledTimes(3);
    for (const split of detail.splits) {
      expect(split.payToken).toBeTruthy();
      expect(repo.splitsById.get(split.id)!.checkoutOrderRef).toBe(
        `paadi-${split.id}`,
      );
      expect(split.checkoutUrl).not.toBeNull();
    }
    expect(detail.splits.reduce((sum, s) => sum + s.shareKobo, 0)).toBe(10000);
  });

  it("rejects a create with no Idempotency-Key header", async () => {
    const { controller } = build();
    expect(() =>
      controller.create(claimsFor("user-1"), undefined, baseInput()),
    ).toThrow(BadRequestException);
  });

  it("is idempotent for a replayed Idempotency-Key (single pot, cached replay)", async () => {
    const { controller, repo } = build();
    const claims = claimsFor("user-1");
    const input = baseInput();
    const first = await controller.create(claims, "idem-1", input);
    const second = await controller.create(claims, "idem-1", input);

    expect(repo.createPotWithSplits).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
  });
});

describe("PotsController owner scoping", () => {
  it("404s when a non-owner reads, updates, deletes, or cancels", async () => {
    const { controller } = build();
    const detail = await controller.create(
      claimsFor("user-1"),
      "idem-1",
      baseInput(),
    );
    const intruder = claimsFor("user-2");
    const params = { id: detail.id };

    await expect(controller.findOne(intruder, params)).rejects.toThrow(
      NotFoundException,
    );
    await expect(
      controller.update(intruder, params, { title: "Hijack" }),
    ).rejects.toThrow(NotFoundException);
    await expect(controller.remove(intruder, params)).rejects.toThrow(
      NotFoundException,
    );
    await expect(controller.cancel(intruder, params)).rejects.toThrow(
      NotFoundException,
    );
  });

  it("lists only the caller's own pots", async () => {
    const { controller } = build();
    await controller.create(claimsFor("user-1"), "idem-1", baseInput());

    const mine = await controller.list(claimsFor("user-1"), { limit: 20 } as never);
    const theirs = await controller.list(
      claimsFor("user-2"),
      { limit: 20 } as never,
    );
    expect(mine.items).toHaveLength(1);
    expect(theirs.items).toHaveLength(0);
  });
});

describe("PayController public view", () => {
  it("returns only the payViewSchema fields with no sibling splits or PII", async () => {
    const { controller, payController } = build();
    const detail = await controller.create(
      claimsFor("user-1"),
      "idem-1",
      baseInput(),
    );
    const token = detail.splits[0].payToken;

    const view = await payController.getPayerView({ token });

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
    const { payController } = build();
    await expect(payController.getPayerView({ token: "nope" })).rejects.toThrow(
      NotFoundException,
    );
  });
});
