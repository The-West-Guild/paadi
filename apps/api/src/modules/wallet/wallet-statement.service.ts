import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  LedgerAccountKind,
  LedgerDirection,
  LedgerEntryView,
  LedgerRepository,
} from "@paadi/domain";
import type {
  StatementQuery,
  WalletBalanceResponse,
  WalletStatementResponse,
  WalletTransactionItem,
} from "@paadi/contracts";
import { PrismaService } from "@paadi/db";
import { decodeStatementCursor } from "./statement-cursor";

type WalletItemKind = WalletTransactionItem["kind"];

type LedgerEntryWithPot = LedgerEntryView & { potId: string | null };

const KIND_TO_ITEM_KIND: Record<string, WalletItemKind> = {
  wallet_credit: "va_credit",
  exception_assignment: "exception_credit",
  wallet_settlement: "pot_settlement",
  wallet_contribution: "split_payment",
  withdrawal: "withdrawal",
  refund: "refund",
};

const DIRECTION_TO_FILTER: Record<"credit" | "debit", LedgerDirection> = {
  credit: LedgerDirection.Credit,
  debit: LedgerDirection.Debit,
};

interface EnrichmentContext {
  potTitles: Map<string, string>;
  walletCredits: Map<
    string,
    { senderName: string | null; senderBank: string | null }
  >;
  settlements: Map<
    string,
    { nombaRef: string | null; potTitle: string | null }
  >;
  exceptions: Map<string, { nombaTransactionId: string }>;
}

@Injectable()
export class WalletStatementService {
  private readonly logger = new Logger(WalletStatementService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(LedgerRepository) private readonly ledger: LedgerRepository,
  ) {}

  async getBalance(userId: string): Promise<WalletBalanceResponse> {
    const balanceKobo = await this.ledger.accountBalanceKobo(
      LedgerAccountKind.UserWallet,
      userId,
    );
    await this.assertDenormAgrees(userId, balanceKobo);
    const virtualAccount = await this.prisma.virtualAccount.findUnique({
      where: { userId },
      select: {
        accountNumber: true,
        providerBank: true,
        accountName: true,
        status: true,
      },
    });
    return {
      balanceKobo,
      currency: "NGN",
      asOf: new Date().toISOString(),
      virtualAccount: virtualAccount
        ? {
            accountNumber: virtualAccount.accountNumber,
            bankName: virtualAccount.providerBank,
            accountName: virtualAccount.accountName,
            status: virtualAccount.status,
          }
        : null,
    };
  }

  async getStatement(
    userId: string,
    query: StatementQuery,
  ): Promise<WalletStatementResponse> {
    const cursor = decodeStatementCursor(query.cursor);
    const [balanceKobo, page] = await Promise.all([
      this.ledger.accountBalanceKobo(LedgerAccountKind.UserWallet, userId),
      this.ledger.listAccountEntries(LedgerAccountKind.UserWallet, userId, {
        cursor,
        limit: query.limit,
        direction: query.direction
          ? DIRECTION_TO_FILTER[query.direction]
          : undefined,
        from: query.from ? new Date(query.from) : undefined,
        to: query.to ? new Date(query.to) : undefined,
      }),
    ]);
    const entries = page.items as LedgerEntryWithPot[];
    const context = await this.loadEnrichment(entries);
    return {
      items: entries.map((entry) => this.toItem(entry, context)),
      nextCursor: page.nextCursor,
      balanceKobo,
    };
  }

  private toItem(
    entry: LedgerEntryWithPot,
    context: EnrichmentContext,
  ): WalletTransactionItem {
    const itemKind = KIND_TO_ITEM_KIND[entry.kind] ?? "other";
    const direction: "credit" | "debit" =
      entry.direction === LedgerDirection.Credit ? "credit" : "debit";
    const signedAmount =
      direction === "credit" ? entry.amountKobo : -entry.amountKobo;
    const potTitle = entry.potId
      ? (context.potTitles.get(entry.potId) ?? null)
      : null;
    const enriched = this.describe(
      entry,
      itemKind,
      direction,
      potTitle,
      context,
    );
    return {
      id: entry.entryId,
      direction,
      amountKobo: signedAmount,
      kind: itemKind,
      occurredAt: entry.occurredAt.toISOString(),
      description: enriched.description,
      counterparty: enriched.counterparty,
      potId: entry.potId,
      potTitle: enriched.potTitle,
      nombaRef: enriched.nombaRef,
      status: enriched.status,
    };
  }

  private describe(
    entry: LedgerEntryWithPot,
    itemKind: WalletItemKind,
    direction: "credit" | "debit",
    potTitle: string | null,
    context: EnrichmentContext,
  ): {
    description: string;
    counterparty: string | null;
    potTitle: string | null;
    nombaRef: string | null;
    status: string;
  } {
    const credit = context.walletCredits.get(entry.refId ?? "");
    const settlement = context.settlements.get(entry.refId ?? "");
    const amount = formatNaira(entry.amountKobo);
    switch (itemKind) {
      case "va_credit": {
        const sender =
          entry.refType === "payment" || entry.refType === "va_credit"
            ? credit?.senderName
            : null;
        return {
          description: sender
            ? `Received ${amount} from ${sender}`
            : `Received ${amount}`,
          counterparty: sender ?? null,
          potTitle,
          nombaRef: null,
          status: "completed",
        };
      }
      case "exception_credit":
        return {
          description: `${amount} credited from review`,
          counterparty: null,
          potTitle,
          nombaRef: null,
          status: "completed",
        };
      case "split_payment":
        return {
          description: potTitle
            ? `Paid your ${amount} share of ${potTitle}`
            : `Paid ${amount} from wallet`,
          counterparty: null,
          potTitle,
          nombaRef: null,
          status: "completed",
        };
      case "pot_settlement":
        return {
          description: potTitle
            ? `${potTitle} settled to your wallet`
            : `Pot settled to your wallet`,
          counterparty: null,
          potTitle: settlement?.potTitle ?? potTitle,
          nombaRef: settlement?.nombaRef ?? null,
          status: "completed",
        };
      case "withdrawal":
        return {
          description: `Withdrew ${amount}`,
          counterparty: null,
          potTitle,
          nombaRef: settlement?.nombaRef ?? null,
          status: "completed",
        };
      case "refund":
        return {
          description: potTitle
            ? `Refund of ${amount} for ${potTitle}`
            : `Refund of ${amount}`,
          counterparty: null,
          potTitle,
          nombaRef: null,
          status: "completed",
        };
      default:
        return {
          description:
            direction === "credit" ? `Wallet credit` : `Wallet debit`,
          counterparty: null,
          potTitle,
          nombaRef: null,
          status: "completed",
        };
    }
  }

  private async loadEnrichment(
    entries: LedgerEntryWithPot[],
  ): Promise<EnrichmentContext> {
    const potIds = new Set<string>();
    const creditIds = new Set<string>();
    const settlementIds = new Set<string>();
    const exceptionIds = new Set<string>();
    for (const entry of entries) {
      if (entry.potId) {
        potIds.add(entry.potId);
      }
      if (!entry.refId) {
        continue;
      }
      if (entry.refType === "va_credit" || entry.refType === "payment") {
        creditIds.add(entry.refId);
      } else if (entry.refType === "settlement") {
        settlementIds.add(entry.refId);
      } else if (entry.refType === "reconciliation_exception") {
        exceptionIds.add(entry.refId);
      }
    }
    const [pots, credits, settlements, exceptions] = await Promise.all([
      potIds.size > 0
        ? this.prisma.pot.findMany({
            where: { id: { in: [...potIds] } },
            select: { id: true, title: true },
          })
        : Promise.resolve([]),
      creditIds.size > 0
        ? this.prisma.walletCredit.findMany({
            where: { id: { in: [...creditIds] } },
            select: { id: true, senderName: true, senderBank: true },
          })
        : Promise.resolve([]),
      settlementIds.size > 0
        ? this.prisma.settlement.findMany({
            where: { id: { in: [...settlementIds] } },
            select: {
              id: true,
              nombaRef: true,
              pot: { select: { title: true } },
            },
          })
        : Promise.resolve([]),
      exceptionIds.size > 0
        ? this.prisma.reconciliationException.findMany({
            where: { id: { in: [...exceptionIds] } },
            select: { id: true, nombaTransactionId: true },
          })
        : Promise.resolve([]),
    ]);
    return {
      potTitles: new Map(pots.map((pot) => [pot.id, pot.title])),
      walletCredits: new Map(
        credits.map((credit) => [
          credit.id,
          { senderName: credit.senderName, senderBank: credit.senderBank },
        ]),
      ),
      settlements: new Map(
        settlements.map((settlement) => [
          settlement.id,
          {
            nombaRef: settlement.nombaRef,
            potTitle: settlement.pot?.title ?? null,
          },
        ]),
      ),
      exceptions: new Map(
        exceptions.map((exception) => [
          exception.id,
          { nombaTransactionId: exception.nombaTransactionId },
        ]),
      ),
    };
  }

  private async assertDenormAgrees(
    userId: string,
    ledgerBalanceKobo: number,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { walletBalanceKobo: true },
    });
    if (!user) {
      return;
    }
    const denorm = Number(user.walletBalanceKobo);
    if (denorm !== ledgerBalanceKobo) {
      this.logger.warn(
        `wallet balance denorm drift for user ${userId}: ledger=${ledgerBalanceKobo} denorm=${denorm}`,
      );
    }
  }
}

function formatNaira(kobo: number): string {
  const naira = Math.abs(kobo) / 100;
  const formatted = naira.toLocaleString("en-NG", {
    minimumFractionDigits: naira % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
  return `₦${formatted}`;
}
