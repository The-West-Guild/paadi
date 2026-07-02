import { Inject, Injectable } from "@nestjs/common";
import { LedgerAccountKind, LedgerRepository } from "@paadi/domain";
import type {
  ActivityFeedResponse,
  PaginationQuery,
  PotActivityResponse,
  PotContributionsSummary,
} from "@paadi/contracts";
import { PrismaService } from "@paadi/db";
import {
  ActivityCursor,
  ActivityRow,
  LedgerEntryWithPot,
  compareRowsDesc,
  decodeActivityCursor,
  encodeActivityCursor,
  isBeforeCursor,
  paymentToRow,
  potCreatedRow,
  potExpiredRow,
  potFundedRow,
  potNudgedRow,
  rowToItem,
  settlementToRow,
  walletEntryToRow,
} from "./activity.mappers";

const SUCCEEDED_STATUS = "succeeded";

@Injectable()
export class ActivityFeedService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(LedgerRepository) private readonly ledger: LedgerRepository,
  ) {}

  async getPotActivity(
    potId: string,
    query: PaginationQuery,
  ): Promise<PotActivityResponse> {
    const cursor = decodeActivityCursor(query.cursor);
    const [rows, contributions] = await Promise.all([
      this.collectPotRows(potId),
      this.getContributionsSummary(potId),
    ]);
    const page = this.paginate(rows, cursor, query.limit);
    return {
      items: page.rows.map(rowToItem),
      nextCursor: page.nextCursor,
      contributions,
    };
  }

  async getGlobalActivity(
    userId: string,
    query: PaginationQuery,
  ): Promise<ActivityFeedResponse> {
    const cursor = decodeActivityCursor(query.cursor);
    const potIds = await this.potIdsForUser(userId);
    const [potRows, walletRows] = await Promise.all([
      this.collectRowsForPots(potIds),
      this.collectWalletRows(userId),
    ]);
    const page = this.paginate(
      [...potRows, ...walletRows],
      cursor,
      query.limit,
    );
    return {
      items: page.rows.map(rowToItem),
      nextCursor: page.nextCursor,
    };
  }

  async getContributionsSummary(
    potId: string,
  ): Promise<PotContributionsSummary> {
    const [pot, splits, paidSplits] = await Promise.all([
      this.prisma.pot.findUnique({
        where: { id: potId },
        select: { collectedKobo: true, targetKobo: true },
      }),
      this.prisma.split.count({ where: { potId } }),
      this.prisma.payment.findMany({
        where: { potId, status: SUCCEEDED_STATUS, splitId: { not: null } },
        select: { splitId: true },
        distinct: ["splitId"],
      }),
    ]);
    const paidSplitCount = paidSplits.length;
    return {
      contributorCount: paidSplitCount,
      paidSplitCount,
      totalSplitCount: splits,
      collectedKobo: pot ? Number(pot.collectedKobo) : 0,
      targetKobo: pot ? Number(pot.targetKobo) : 0,
    };
  }

  private async collectPotRows(potId: string): Promise<ActivityRow[]> {
    return this.collectRowsForPots([potId]);
  }

  private async collectRowsForPots(potIds: string[]): Promise<ActivityRow[]> {
    if (potIds.length === 0) {
      return [];
    }
    const [pots, payments, settlements, nudges] = await Promise.all([
      this.prisma.pot.findMany({
        where: { id: { in: potIds } },
        select: {
          id: true,
          title: true,
          status: true,
          collectedKobo: true,
          targetKobo: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      this.prisma.payment.findMany({
        where: { potId: { in: potIds } },
        select: {
          id: true,
          potId: true,
          amountKobo: true,
          senderName: true,
          status: true,
          splitId: true,
          createdAt: true,
        },
      }),
      this.prisma.settlement.findMany({
        where: { potId: { in: potIds } },
        select: {
          id: true,
          potId: true,
          type: true,
          amountKobo: true,
          vendToken: true,
          nombaRef: true,
          settledAt: true,
          createdAt: true,
        },
      }),
      this.prisma.potNudge.findMany({
        where: { potId: { in: potIds } },
        select: {
          potId: true,
          sentAt: true,
          recipientCount: true,
        },
      }),
    ]);
    const titles = new Map(pots.map((pot) => [pot.id, pot.title]));
    const rows: ActivityRow[] = [];
    for (const pot of pots) {
      rows.push(potCreatedRow(pot));
      if (
        pot.status === "FUNDED" ||
        pot.status === "SETTLING" ||
        pot.status === "SETTLED"
      ) {
        rows.push(potFundedRow(pot));
      }
      if (pot.status === "EXPIRED") {
        rows.push(potExpiredRow(pot));
      }
    }
    for (const payment of payments) {
      rows.push(paymentToRow(payment, titles.get(payment.potId) ?? "your pot"));
    }
    for (const settlement of settlements) {
      rows.push(
        settlementToRow(settlement, titles.get(settlement.potId) ?? "your pot"),
      );
    }
    for (const nudge of nudges) {
      rows.push(
        potNudgedRow(
          nudge,
          titles.get(nudge.potId) ?? "your pot",
          nudge.recipientCount,
        ),
      );
    }
    return rows;
  }

  private async collectWalletRows(userId: string): Promise<ActivityRow[]> {
    const entries = await this.loadWalletEntries(userId);
    if (entries.length === 0) {
      return [];
    }
    const potIds = new Set<string>();
    for (const entry of entries) {
      if (entry.potId) {
        potIds.add(entry.potId);
      }
    }
    const pots =
      potIds.size > 0
        ? await this.prisma.pot.findMany({
            where: { id: { in: [...potIds] } },
            select: { id: true, title: true },
          })
        : [];
    const titles = new Map(pots.map((pot) => [pot.id, pot.title]));
    return entries.map((entry) =>
      walletEntryToRow(
        entry,
        entry.potId ? (titles.get(entry.potId) ?? null) : null,
      ),
    );
  }

  private async loadWalletEntries(
    userId: string,
  ): Promise<LedgerEntryWithPot[]> {
    const collected: LedgerEntryWithPot[] = [];
    let ledgerCursor: { occurredAt: Date; entryId: string } | undefined;
    for (let batch = 0; batch < MAX_WALLET_BATCHES; batch += 1) {
      const page = await this.ledger.listAccountEntries(
        LedgerAccountKind.UserWallet,
        userId,
        {
          cursor: ledgerCursor,
          limit: WALLET_BATCH_SIZE,
        },
      );
      collected.push(...(page.items as LedgerEntryWithPot[]));
      if (!page.nextCursor || page.items.length === 0) {
        break;
      }
      const last = page.items[page.items.length - 1];
      ledgerCursor = { occurredAt: last.occurredAt, entryId: last.entryId };
    }
    return collected;
  }

  private async potIdsForUser(userId: string): Promise<string[]> {
    const pots = await this.prisma.pot.findMany({
      where: { creatorId: userId },
      select: { id: true },
    });
    return pots.map((pot) => pot.id);
  }

  private paginate(
    rows: ActivityRow[],
    cursor: ActivityCursor | undefined,
    limit: number,
  ): { rows: ActivityRow[]; nextCursor: string | null } {
    const filtered = cursor
      ? rows.filter((row) => isBeforeCursor(row, cursor))
      : rows;
    filtered.sort(compareRowsDesc);
    const hasMore = filtered.length > limit;
    const pageRows = hasMore ? filtered.slice(0, limit) : filtered;
    const last = pageRows.length > 0 ? pageRows[pageRows.length - 1] : null;
    const nextCursor =
      hasMore && last
        ? encodeActivityCursor({
            occurredAt: last.occurredAt,
            sourceTag: last.sourceTag,
            sourceId: last.sourceId,
          })
        : null;
    return { rows: pageRows, nextCursor };
  }
}

const WALLET_BATCH_SIZE = 100;
const MAX_WALLET_BATCHES = 20;
