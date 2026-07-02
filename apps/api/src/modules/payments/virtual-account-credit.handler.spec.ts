import { PaymentRecordStatus } from "@paadi/contracts";
import { PaymentProviderPort, TransactionStatus } from "@paadi/domain";
import { PrismaService, VirtualAccount } from "@paadi/db";
import { NombaWebhookBody } from "../../webhooks/nomba-webhook.types";
import {
  CreditWalletInput,
  RecordUnmatchedInput,
  WalletCreditRepository
} from "../../infra/persistence/wallet-credit.repository";
import { VirtualAccountRepository } from "../../infra/persistence/virtual-account.repository";
import { IngestionEvent } from "./checkout-payment.handler";
import { VirtualAccountCreditHandler } from "./virtual-account-credit.handler";

function requery(overrides: Partial<TransactionStatus> = {}): TransactionStatus {
  return {
    success: true,
    reference: "ref-1",
    transactionId: "txn-1",
    amountKobo: 0,
    status: "SUCCESS",
    ...overrides
  };
}

function makeProvider(status: TransactionStatus = requery()) {
  const verifyTransactionById = jest.fn(async (transactionId: string) => ({
    ...status,
    transactionId
  }));
  return { verifyTransaction: jest.fn(), verifyTransactionById };
}

function makePrisma() {
  const update = jest.fn(async () => ({}));
  return { prisma: { webhookEventIn: { update } }, update };
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

function buildHandler(
  opts: {
    provider?: ReturnType<typeof makeProvider>;
    walletCredit?: ReturnType<typeof makeWalletCredit>;
    virtualAccounts?: ReturnType<typeof makeVirtualAccounts>;
  } = {}
) {
  const provider = opts.provider ?? makeProvider();
  const { prisma, update } = makePrisma();
  const walletCredit = opts.walletCredit ?? makeWalletCredit();
  const virtualAccounts = opts.virtualAccounts ?? makeVirtualAccounts();
  const handler = new VirtualAccountCreditHandler(
    provider as unknown as PaymentProviderPort,
    prisma as unknown as PrismaService,
    walletCredit as unknown as WalletCreditRepository,
    virtualAccounts as unknown as VirtualAccountRepository
  );
  return { handler, provider, walletCredit, virtualAccounts, prismaUpdate: update };
}

function vactBody(overrides: Partial<NonNullable<NombaWebhookBody["data"]>["transaction"]> = {}): NombaWebhookBody {
  return {
    event_type: "payment_success",
    requestId: "req-1",
    data: {
      transaction: {
        transactionId: "txn-1",
        type: "vact_transfer",
        aliasAccountType: "VIRTUAL",
        aliasAccountNumber: "9999999999",
        transactionAmount: "5000.00",
        ...overrides
      },
      customer: {
        senderName: "Ada Lovelace",
        accountNumber: "0123456789",
        bankName: "GTBank",
        bankCode: "058"
      }
    }
  };
}

function activeAccount(overrides: Partial<VirtualAccount> = {}): VirtualAccount {
  return {
    id: "va-1",
    userId: "user-1",
    status: "ACTIVE",
    accountNumber: "9999999999",
    ...overrides
  } as VirtualAccount;
}

const event: IngestionEvent = { id: "evt-1" };

describe("VirtualAccountCreditHandler attribution", () => {
  it("credits an ACTIVE virtual account to its owning userId", async () => {
    const byNumber = new Map<string, VirtualAccount>([["9999999999", activeAccount()]]);
    const { handler, walletCredit } = buildHandler({
      virtualAccounts: makeVirtualAccounts(byNumber)
    });

    const result = await handler.handle(event, vactBody());

    expect(walletCredit.recordUnmatched).not.toHaveBeenCalled();
    expect(walletCredit.creditWallet).toHaveBeenCalledTimes(1);
    expect(walletCredit.creditCalls[0].userId).toBe("user-1");
    expect(walletCredit.creditCalls[0].virtualAccountId).toBe("va-1");
    expect(walletCredit.creditCalls[0].nombaTransactionId).toBe("txn-1");
    expect(walletCredit.creditCalls[0].rawEventId).toBe("evt-1");
    expect(result.status).toBe(PaymentRecordStatus.Succeeded);
    expect(result.alreadyProcessed).toBe(false);
  });

  it("captures the originator sender fields (incl. bankCode) on the credit", async () => {
    const byNumber = new Map<string, VirtualAccount>([["9999999999", activeAccount()]]);
    const { handler, walletCredit } = buildHandler({
      virtualAccounts: makeVirtualAccounts(byNumber)
    });

    await handler.handle(event, vactBody());

    expect(walletCredit.creditCalls[0].senderName).toBe("Ada Lovelace");
    expect(walletCredit.creditCalls[0].senderAccount).toBe("0123456789");
    expect(walletCredit.creditCalls[0].senderBank).toBe("GTBank");
    expect(walletCredit.creditCalls[0].senderBankCode).toBe("058");
  });

  it("parks an unknown account number to suspense with UNKNOWN_ACCOUNT and writes no credit", async () => {
    const { handler, walletCredit } = buildHandler();

    const result = await handler.handle(event, vactBody());

    expect(walletCredit.creditWallet).not.toHaveBeenCalled();
    expect(walletCredit.recordUnmatched).toHaveBeenCalledTimes(1);
    expect(walletCredit.unmatchedCalls[0].reason).toBe("UNKNOWN_ACCOUNT");
    expect(walletCredit.unmatchedCalls[0].accountNumber).toBe("9999999999");
    expect(walletCredit.unmatchedCalls[0].nombaTransactionId).toBe("txn-1");
    expect(result.paymentId).toBeNull();
  });

  it("parks a CLOSED virtual account to suspense with CLOSED_ACCOUNT and writes no credit", async () => {
    const byNumber = new Map<string, VirtualAccount>([
      ["9999999999", activeAccount({ status: "CLOSED" } as Partial<VirtualAccount>)]
    ]);
    const { handler, walletCredit } = buildHandler({
      virtualAccounts: makeVirtualAccounts(byNumber)
    });

    const result = await handler.handle(event, vactBody());

    expect(walletCredit.creditWallet).not.toHaveBeenCalled();
    expect(walletCredit.recordUnmatched).toHaveBeenCalledTimes(1);
    expect(walletCredit.unmatchedCalls[0].reason).toBe("CLOSED_ACCOUNT");
    expect(result.paymentId).toBeNull();
  });

  it("parks a SUSPENDED virtual account to suspense with CLOSED_ACCOUNT", async () => {
    const byNumber = new Map<string, VirtualAccount>([
      ["9999999999", activeAccount({ status: "SUSPENDED" } as Partial<VirtualAccount>)]
    ]);
    const { handler, walletCredit } = buildHandler({
      virtualAccounts: makeVirtualAccounts(byNumber)
    });

    await handler.handle(event, vactBody());

    expect(walletCredit.creditWallet).not.toHaveBeenCalled();
    expect(walletCredit.unmatchedCalls[0].reason).toBe("CLOSED_ACCOUNT");
  });

  it("parks to house suspense (null account) when the account number field is absent", async () => {
    const { handler, walletCredit, virtualAccounts } = buildHandler();

    await handler.handle(event, vactBody({ aliasAccountNumber: undefined }));

    expect(virtualAccounts.findByAccountNumber).not.toHaveBeenCalled();
    expect(walletCredit.creditWallet).not.toHaveBeenCalled();
    expect(walletCredit.unmatchedCalls[0].reason).toBe("UNKNOWN_ACCOUNT");
    expect(walletCredit.unmatchedCalls[0].accountNumber).toBeNull();
  });
});

describe("VirtualAccountCreditHandler requery backstop", () => {
  it("does not credit when requery success is false and marks the event processed", async () => {
    const byNumber = new Map<string, VirtualAccount>([["9999999999", activeAccount()]]);
    const provider = makeProvider(requery({ success: false, status: "FAILED" }));
    const { handler, walletCredit, prismaUpdate } = buildHandler({
      provider,
      virtualAccounts: makeVirtualAccounts(byNumber)
    });

    const result = await handler.handle(event, vactBody());

    expect(walletCredit.creditWallet).not.toHaveBeenCalled();
    expect(walletCredit.recordUnmatched).not.toHaveBeenCalled();
    expect(provider.verifyTransactionById).not.toHaveBeenCalledTimes(0);
    expect(prismaUpdate).toHaveBeenCalledTimes(1);
    expect(result.status).toBe(PaymentRecordStatus.Unconfirmed);
  });

  it("requeries by transactionId before touching the account map", async () => {
    const byNumber = new Map<string, VirtualAccount>([["9999999999", activeAccount()]]);
    const provider = makeProvider();
    const { handler } = buildHandler({
      provider,
      virtualAccounts: makeVirtualAccounts(byNumber)
    });

    await handler.handle(event, vactBody());

    expect(provider.verifyTransactionById).toHaveBeenCalledWith("txn-1");
  });

  it("parks amount_mismatch to suspense when requery amount disagrees (requery > 0)", async () => {
    const byNumber = new Map<string, VirtualAccount>([["9999999999", activeAccount()]]);
    const provider = makeProvider(requery({ amountKobo: 999999 }));
    const { handler, walletCredit } = buildHandler({
      provider,
      virtualAccounts: makeVirtualAccounts(byNumber)
    });

    const result = await handler.handle(event, vactBody());

    expect(walletCredit.creditWallet).not.toHaveBeenCalled();
    expect(walletCredit.recordUnmatched).toHaveBeenCalledTimes(1);
    expect(walletCredit.unmatchedCalls[0].reason).toBe("amount_mismatch");
    expect(result.status).toBe(PaymentRecordStatus.AmountMismatch);
  });

  it("trusts the webhook amount when requery amount is 0 (mock provider)", async () => {
    const byNumber = new Map<string, VirtualAccount>([["9999999999", activeAccount()]]);
    const provider = makeProvider(requery({ amountKobo: 0 }));
    const { handler, walletCredit } = buildHandler({
      provider,
      virtualAccounts: makeVirtualAccounts(byNumber)
    });

    await handler.handle(event, vactBody());

    expect(walletCredit.recordUnmatched).not.toHaveBeenCalled();
    expect(walletCredit.creditCalls[0].amountKobo).toBe(500000);
  });
});

describe("VirtualAccountCreditHandler amount extraction", () => {
  it("converts transactionAmount naira to kobo at the edge", async () => {
    const byNumber = new Map<string, VirtualAccount>([["9999999999", activeAccount()]]);
    const { handler, walletCredit } = buildHandler({
      virtualAccounts: makeVirtualAccounts(byNumber)
    });

    await handler.handle(event, vactBody({ transactionAmount: "5000.00" }));

    expect(walletCredit.creditCalls[0].amountKobo).toBe(500000);
  });

  it("throws (no credit) when the amount is missing", async () => {
    const byNumber = new Map<string, VirtualAccount>([["9999999999", activeAccount()]]);
    const { handler, walletCredit, provider } = buildHandler({
      virtualAccounts: makeVirtualAccounts(byNumber)
    });

    await expect(handler.handle(event, vactBody({ transactionAmount: undefined }))).rejects.toThrow();

    expect(walletCredit.creditWallet).not.toHaveBeenCalled();
    expect(walletCredit.recordUnmatched).not.toHaveBeenCalled();
    expect(provider.verifyTransactionById).not.toHaveBeenCalled();
  });

  it("throws (no credit) when the amount is zero", async () => {
    const byNumber = new Map<string, VirtualAccount>([["9999999999", activeAccount()]]);
    const { handler, walletCredit } = buildHandler({
      virtualAccounts: makeVirtualAccounts(byNumber)
    });

    await expect(handler.handle(event, vactBody({ transactionAmount: "0" }))).rejects.toThrow();

    expect(walletCredit.creditWallet).not.toHaveBeenCalled();
  });
});
