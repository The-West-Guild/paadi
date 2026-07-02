import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { ReceiptResponse } from "@paadi/contracts";
import {
  PaymentMethod as DbPaymentMethod,
  PrismaService,
  SettlementType as DbSettlementType,
} from "@paadi/db";

const METHOD_MAP: Record<DbPaymentMethod, "card" | "transfer" | "ussd" | "wallet"> = {
  CARD: "card",
  TRANSFER: "transfer",
  USSD: "ussd",
  WALLET: "wallet",
};

const SETTLEMENT_TYPE_MAP: Record<
  DbSettlementType,
  "bill_payment" | "bank_payout" | "wallet"
> = {
  BILL_PAYMENT: "bill_payment",
  BANK_PAYOUT: "bank_payout",
  WALLET: "wallet",
};

@Injectable()
export class ReceiptsService {
  constructor(private readonly prisma: PrismaService) {}

  async getPaymentReceipt(
    paymentId: string,
    userId: string,
  ): Promise<ReceiptResponse> {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: {
        pot: { select: { id: true, title: true, creatorId: true } },
        split: { select: { label: true } },
      },
    });
    if (!payment) {
      throw new NotFoundException("receipt not found");
    }
    if (payment.pot.creatorId !== userId) {
      throw new ForbiddenException("not entitled to receipt");
    }
    return {
      kind: "contribution",
      reference: payment.nombaTransactionId,
      amountKobo: Number(payment.amountKobo),
      status: payment.status,
      paidAt: payment.createdAt.toISOString(),
      method: METHOD_MAP[payment.method],
      payer: {
        name: payment.senderName,
        bank: payment.senderBank,
        account: payment.senderAccount,
      },
      pot: { id: payment.pot.id, title: payment.pot.title },
      split: payment.split ? { label: payment.split.label } : null,
    };
  }

  async getSettlementReceipt(
    settlementId: string,
    userId: string,
  ): Promise<ReceiptResponse> {
    const settlement = await this.prisma.settlement.findUnique({
      where: { id: settlementId },
      include: {
        pot: {
          select: {
            id: true,
            title: true,
            creatorId: true,
            payoutAccount: {
              select: {
                bankName: true,
                accountName: true,
                accountNumberLast4: true,
              },
            },
          },
        },
      },
    });
    if (!settlement) {
      throw new NotFoundException("receipt not found");
    }
    if (settlement.pot.creatorId !== userId) {
      throw new ForbiddenException("not entitled to receipt");
    }
    const type = SETTLEMENT_TYPE_MAP[settlement.type];
    const vend =
      type === "bill_payment"
        ? { token: settlement.vendToken, units: settlement.vendUnits }
        : null;
    const payoutAccount = settlement.pot.payoutAccount;
    const destination =
      type === "bank_payout" && payoutAccount
        ? {
            bank: payoutAccount.bankName,
            accountName: payoutAccount.accountName,
            accountNumber: payoutAccount.accountNumberLast4,
          }
        : null;
    return {
      kind: "settlement",
      reference: settlement.merchantTxRef,
      nombaRef: settlement.nombaRef,
      amountKobo: Number(settlement.amountKobo),
      status: settlement.status,
      settledAt: (settlement.settledAt ?? settlement.createdAt).toISOString(),
      type,
      pot: { id: settlement.pot.id, title: settlement.pot.title },
      vend,
      destination,
    };
  }
}
