import { PaymentMethod, PaymentRecordStatus } from "@paadi/contracts";
import { PaymentProviderPort } from "@paadi/domain";
import { PrismaService } from "@paadi/db";
import { NombaWebhookBody } from "../../webhooks/nomba-webhook.types";
import { PaymentRequery } from "../../infra/persistence/mappers/payment.mapper";
import {
  IngestPaymentInput,
  IngestPaymentResult,
  PaymentIngestionRepository
} from "../../infra/persistence/payment-ingestion.repository";
import { VirtualAccount } from "@paadi/db";
import {
  CreditWalletInput,
  RecordUnmatchedInput,
  WalletCreditRepository
} from "../../infra/persistence/wallet-credit.repository";
import { VirtualAccountRepository } from "../../infra/persistence/virtual-account.repository";
import { CheckoutPaymentHandler } from "./checkout-payment.handler";
import { NombaWebhookRouter } from "./nomba-webhook.router";
import { RecordContributionInput, RecordContributionService } from "./record-contribution.service";
import { VirtualAccountCreditHandler } from "./virtual-account-credit.handler";

interface FakeSplit {
  id: string;
  potId: string;
}

function makeResult(overrides: Partial<IngestPaymentResult> = {}): IngestPaymentResult {
  return {
    status: PaymentRecordStatus.Succeeded,
    paymentId: "pay-1",
    potId: "pot-1",
    splitId: "split-1",
    attributedKobo: 0,
    excessKobo: 0,
    funded: false,
    alreadyProcessed: false,
    ...overrides
  };
}

function makePrisma(splitsByRef: Map<string, FakeSplit>) {
  return {
    split: {
      findUnique: jest.fn(async (args: { where: { checkoutOrderRef: string } }) => {
        return splitsByRef.get(args.where.checkoutOrderRef) ?? null;
      })
    },
    webhookEventIn: {
      update: jest.fn(async () => ({}))
    }
  };
}

function requery(overrides: Partial<PaymentRequery> = {}): PaymentRequery {
  return {
    success: true,
    reference: "ref-1",
    transactionId: "txn-1",
    amountKobo: 0,
    status: "SUCCESS",
    transferDetails: null,
    ...overrides
  };
}

function makeProvider() {
  return {
    verifyTransaction: jest.fn(
      async (reference: string): Promise<PaymentRequery> => requery({ reference })
    ),
    verifyTransactionById: jest.fn(
      async (transactionId: string): Promise<PaymentRequery> =>
        requery({ transactionId, reference: "ref-recovered" })
    )
  };
}

function makeContributions() {
  const calls: RecordContributionInput[] = [];
  const recordContribution = jest.fn(async (input: RecordContributionInput) => {
    calls.push(input);
    return makeResult();
  });
  return { recordContribution, calls };
}

function makeIngestion() {
  const calls: IngestPaymentInput[] = [];
  const ingest = jest.fn(async (input: IngestPaymentInput) => {
    calls.push(input);
    return makeResult({ status: PaymentRecordStatus.Unmatched, splitId: null, potId: null });
  });
  const suspenseCalls: { input: IngestPaymentInput; status: PaymentRecordStatus }[] = [];
  const ingestSuspense = jest.fn(async (input: IngestPaymentInput, status: PaymentRecordStatus) => {
    suspenseCalls.push({ input, status });
    return makeResult({ status, splitId: null });
  });
  return { ingest, ingestSuspense, calls, suspenseCalls };
}

function makeWalletCredit() {
  const creditCalls: CreditWalletInput[] = [];
  const creditWallet = jest.fn(async (input: CreditWalletInput) => {
    creditCalls.push(input);
    return {
      walletCreditId: "wc-1",
      userId: input.userId,
      amountKobo: input.amountKobo,
      alreadyProcessed: false
    };
  });
  const unmatchedCalls: RecordUnmatchedInput[] = [];
  const recordUnmatched = jest.fn(async (input: RecordUnmatchedInput) => {
    unmatchedCalls.push(input);
    return {
      reason: input.reason,
      accountNumber: input.accountNumber,
      nombaTransactionId: input.nombaTransactionId,
      amountKobo: input.amountKobo
    };
  });
  return { creditWallet, recordUnmatched, creditCalls, unmatchedCalls };
}

function makeVirtualAccounts(byNumber: Map<string, VirtualAccount> = new Map()) {
  const findByAccountNumber = jest.fn(
    async (accountNumber: string) => byNumber.get(accountNumber) ?? null
  );
  return { findByAccountNumber, byNumber };
}

function buildRouter(
  opts: {
    splitsByRef?: Map<string, FakeSplit>;
    provider?: ReturnType<typeof makeProvider>;
    contributions?: ReturnType<typeof makeContributions>;
    ingestion?: ReturnType<typeof makeIngestion>;
    walletCredit?: ReturnType<typeof makeWalletCredit>;
    virtualAccounts?: ReturnType<typeof makeVirtualAccounts>;
  } = {}
) {
  const splitsByRef = opts.splitsByRef ?? new Map<string, FakeSplit>();
  const prisma = makePrisma(splitsByRef);
  const provider = opts.provider ?? makeProvider();
  const contributions = opts.contributions ?? makeContributions();
  const ingestion = opts.ingestion ?? makeIngestion();
  const walletCredit = opts.walletCredit ?? makeWalletCredit();
  const virtualAccounts = opts.virtualAccounts ?? makeVirtualAccounts();
  const checkout = new CheckoutPaymentHandler(
    prisma as unknown as PrismaService,
    provider as unknown as PaymentProviderPort,
    contributions as unknown as RecordContributionService,
    ingestion as unknown as PaymentIngestionRepository
  );
  const virtualAccount = new VirtualAccountCreditHandler(
    provider as unknown as PaymentProviderPort,
    prisma as unknown as PrismaService,
    walletCredit as unknown as WalletCreditRepository,
    virtualAccounts as unknown as VirtualAccountRepository
  );
  const router = new NombaWebhookRouter(
    checkout,
    virtualAccount,
    ingestion as unknown as PaymentIngestionRepository
  );
  return { router, prisma, provider, contributions, ingestion, walletCredit, virtualAccounts, splitsByRef };
}

function checkoutBody(overrides: Partial<NonNullable<NombaWebhookBody["data"]>> = {}): NombaWebhookBody {
  return {
    event_type: "payment_success",
    requestId: "req-1",
    data: {
      merchant: { userId: "u", walletId: "w" },
      order: {
        orderReference: "ref-1",
        amount: "3000.00",
        paymentMethod: "card_payment",
        currency: "NGN"
      },
      transaction: {
        transactionId: "txn-1",
        type: "online_checkout",
        transactionAmount: "3000.00"
      },
      customer: { billerId: "biller-x", productId: "prod-y" },
      ...overrides
    }
  };
}

describe("NombaWebhookRouter dispatch", () => {
  it("routes online_checkout to the checkout handler and records a contribution", async () => {
    const splitsByRef = new Map<string, FakeSplit>([["ref-1", { id: "split-1", potId: "pot-1" }]]);
    const { router, contributions, ingestion } = buildRouter({ splitsByRef });

    await router.route({ id: "evt-1" }, checkoutBody());

    expect(contributions.recordContribution).toHaveBeenCalledTimes(1);
    expect(ingestion.ingest).not.toHaveBeenCalled();
  });

  it("routes vact_transfer to the virtual-account handler, unknown account parks unmatched", async () => {
    const { router, ingestion, contributions, walletCredit } = buildRouter();
    const body = checkoutBody();
    body.data!.transaction!.type = "vact_transfer";
    body.data!.transaction!.aliasAccountType = "VIRTUAL";

    await router.route({ id: "evt-2" }, body);

    expect(contributions.recordContribution).not.toHaveBeenCalled();
    expect(ingestion.ingest).not.toHaveBeenCalled();
    expect(walletCredit.creditWallet).not.toHaveBeenCalled();
    expect(walletCredit.recordUnmatched).toHaveBeenCalledTimes(1);
    expect(walletCredit.unmatchedCalls[0].reason).toBe("UNKNOWN_ACCOUNT");
  });

  it("routes vact_transfer for an ACTIVE virtual account to a wallet credit", async () => {
    const byNumber = new Map<string, VirtualAccount>([
      ["9999999999", { id: "va-1", userId: "user-1", status: "ACTIVE" } as VirtualAccount]
    ]);
    const virtualAccounts = makeVirtualAccounts(byNumber);
    const { router, walletCredit } = buildRouter({ virtualAccounts });
    const body = checkoutBody();
    body.data!.transaction!.type = "vact_transfer";
    body.data!.transaction!.aliasAccountType = "VIRTUAL";
    body.data!.transaction!.aliasAccountNumber = "9999999999";

    await router.route({ id: "evt-4" }, body);

    expect(walletCredit.recordUnmatched).not.toHaveBeenCalled();
    expect(walletCredit.creditWallet).toHaveBeenCalledTimes(1);
    expect(walletCredit.creditCalls[0].userId).toBe("user-1");
    expect(walletCredit.creditCalls[0].virtualAccountId).toBe("va-1");
  });

  it("parks an unknown transaction type to house suspense (splitId & potId null)", async () => {
    const { router, ingestion } = buildRouter();
    const body = checkoutBody();
    body.data!.transaction!.type = "mystery_rail";

    await router.route({ id: "evt-3" }, body);

    expect(ingestion.ingest).toHaveBeenCalledTimes(1);
    expect(ingestion.calls[0].splitId).toBeNull();
    expect(ingestion.calls[0].potId).toBeNull();
    expect(ingestion.calls[0].nombaTransactionId).toBe("txn-1");
  });
});

describe("CheckoutPaymentHandler attribution & mapping", () => {
  it("attributes shape 1 by data.order.orderReference via verifyTransaction", async () => {
    const splitsByRef = new Map<string, FakeSplit>([["ref-1", { id: "split-1", potId: "pot-1" }]]);
    const { router, provider, contributions } = buildRouter({ splitsByRef });

    await router.route({ id: "evt-1" }, checkoutBody());

    expect(provider.verifyTransaction).toHaveBeenCalledWith("ref-1");
    expect(provider.verifyTransactionById).not.toHaveBeenCalled();
    expect(contributions.calls[0].splitId).toBe("split-1");
    expect(contributions.calls[0].potId).toBe("pot-1");
  });

  it("falls back to verifyTransactionById and resolves the recovered reference when data.order is absent", async () => {
    const splitsByRef = new Map<string, FakeSplit>([
      ["ref-recovered", { id: "split-9", potId: "pot-9" }]
    ]);
    const { router, provider, contributions } = buildRouter({ splitsByRef });
    const body = checkoutBody();
    delete body.data!.order;

    await router.route({ id: "evt-1" }, body);

    expect(provider.verifyTransactionById).toHaveBeenCalledWith("txn-1");
    expect(provider.verifyTransaction).not.toHaveBeenCalled();
    expect(contributions.calls[0].splitId).toBe("split-9");
    expect(contributions.calls[0].potId).toBe("pot-9");
  });

  it("routes an unmatched order reference to suspense (splitId & potId null)", async () => {
    const { router, contributions } = buildRouter({ splitsByRef: new Map() });

    await router.route({ id: "evt-1" }, checkoutBody());

    expect(contributions.calls[0].splitId).toBeNull();
    expect(contributions.calls[0].potId).toBeNull();
  });

  it("maps method from data.order.paymentMethod (card_payment -> card)", async () => {
    const splitsByRef = new Map<string, FakeSplit>([["ref-1", { id: "split-1", potId: "pot-1" }]]);
    const { router, contributions } = buildRouter({ splitsByRef });

    await router.route({ id: "evt-1" }, checkoutBody());

    expect(contributions.calls[0].method).toBe(PaymentMethod.Card);
  });

  it("converts data.order.amount Naira to kobo at the edge", async () => {
    const splitsByRef = new Map<string, FakeSplit>([["ref-1", { id: "split-1", potId: "pot-1" }]]);
    const { router, contributions } = buildRouter({ splitsByRef });

    await router.route({ id: "evt-1" }, checkoutBody());

    expect(contributions.calls[0].amountKobo).toBe(300000);
  });

  it("falls back to transaction.transactionAmount when data.order.amount is absent", async () => {
    const splitsByRef = new Map<string, FakeSplit>([["ref-1", { id: "split-1", potId: "pot-1" }]]);
    const { router, contributions } = buildRouter({ splitsByRef });
    const body = checkoutBody();
    delete body.data!.order!.amount;
    body.data!.transaction!.transactionAmount = "4500.00";

    await router.route({ id: "evt-1" }, body);

    expect(contributions.calls[0].amountKobo).toBe(450000);
  });

  it("sources sender identity from requery transferDetails, not data.customer", async () => {
    const splitsByRef = new Map<string, FakeSplit>([["ref-1", { id: "split-1", potId: "pot-1" }]]);
    const provider = makeProvider();
    provider.verifyTransaction.mockResolvedValue(
      requery({
        transferDetails: {
          originatorAccountName: "Ada Lovelace",
          originatorAccountNumber: "0123456789",
          bankName: "GTBank"
        }
      })
    );
    const { router, contributions } = buildRouter({ splitsByRef, provider });

    await router.route({ id: "evt-1" }, checkoutBody());

    expect(contributions.calls[0].sender).toEqual({
      senderName: "Ada Lovelace",
      senderAccount: "0123456789",
      senderBank: "GTBank"
    });
  });

  it("leaves sender null for the card case with no transferDetails", async () => {
    const splitsByRef = new Map<string, FakeSplit>([["ref-1", { id: "split-1", potId: "pot-1" }]]);
    const { router, contributions } = buildRouter({ splitsByRef });

    await router.route({ id: "evt-1" }, checkoutBody());

    expect(contributions.calls[0].sender).toEqual({
      senderName: null,
      senderAccount: null,
      senderBank: null
    });
  });

  it("does not credit when requery denies success and marks the event processed", async () => {
    const splitsByRef = new Map<string, FakeSplit>([["ref-1", { id: "split-1", potId: "pot-1" }]]);
    const provider = makeProvider();
    provider.verifyTransaction.mockResolvedValue(requery({ success: false, status: "FAILED" }));
    const { router, contributions, prisma } = buildRouter({ splitsByRef, provider });

    const result = await router.route({ id: "evt-1" }, checkoutBody());

    expect(contributions.recordContribution).not.toHaveBeenCalled();
    expect(prisma.webhookEventIn.update).toHaveBeenCalledTimes(1);
    expect(result.status).toBe(PaymentRecordStatus.Unconfirmed);
  });
});
