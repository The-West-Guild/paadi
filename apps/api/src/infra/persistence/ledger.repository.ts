import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  KindBalance,
  LedgerAccountKind,
  LedgerDirection,
  LedgerEntryView,
  LedgerPosting,
  LedgerRepository,
  ListAccountEntriesArgs,
  ListAccountEntriesResult,
  assertBalanced
} from "@paadi/domain";
import { Prisma, PrismaService } from "@paadi/db";
import { toLedgerEntryView, encodeLedgerEntryCursor, LedgerEntryQueryRow } from "./mappers/ledger.mapper";

const DR_NORMAL_KINDS: ReadonlySet<string> = new Set([
  LedgerAccountKind.PooledCash,
  LedgerAccountKind.SettlementPayout,
  LedgerAccountKind.PlatformFee
]);

@Injectable()
export class PrismaLedgerRepository extends LedgerRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async record(posting: LedgerPosting, tx?: Prisma.TransactionClient): Promise<void> {
    assertBalanced(posting.entries);
    const client = tx ?? this.prisma;
    const accountIds: string[] = [];
    for (const entry of posting.entries) {
      accountIds.push(
        await this.resolveAccountId(client, entry.account.kind, entry.account.ownerRef)
      );
    }
    await client.ledgerTransaction.create({
      data: {
        kind: posting.kind,
        potId: posting.potId ?? null,
        entries: {
          create: posting.entries.map((entry, index) => ({
            accountId: accountIds[index],
            direction: entry.direction,
            amountKobo: BigInt(entry.amountKobo)
          }))
        }
      }
    });
  }

  async balance(accountId: string, tx?: Prisma.TransactionClient): Promise<number> {
    const client = tx ?? this.prisma;
    const entries = await client.ledgerEntry.findMany({
      where: { accountId },
      select: { direction: true, amountKobo: true }
    });
    const net = entries.reduce(
      (acc, entry) => acc + (entry.direction === LedgerDirection.Debit ? entry.amountKobo : -entry.amountKobo),
      0n
    );
    return Number(net);
  }

  async accountBalanceKobo(kind: string, ownerRef: string): Promise<number> {
    const account = await this.prisma.ledgerAccount.findUnique({
      where: { kind_ownerRef: { kind, ownerRef } },
      select: { id: true }
    });
    if (!account) {
      return 0;
    }
    const net = await this.balance(account.id);
    return this.applyNormalSign(kind, net);
  }

  async listAccountEntries(
    kind: string,
    ownerRef: string,
    args: ListAccountEntriesArgs
  ): Promise<ListAccountEntriesResult> {
    const account = await this.prisma.ledgerAccount.findUnique({
      where: { kind_ownerRef: { kind, ownerRef } },
      select: { id: true }
    });
    if (!account) {
      return { items: [], nextCursor: null };
    }

    const conditions: Prisma.Sql[] = [Prisma.sql`e."accountId" = ${account.id}`];
    if (args.direction) {
      conditions.push(Prisma.sql`e."direction"::text = ${args.direction}`);
    }
    if (args.from) {
      conditions.push(Prisma.sql`t."createdAt" >= ${args.from}`);
    }
    if (args.to) {
      conditions.push(Prisma.sql`t."createdAt" <= ${args.to}`);
    }
    if (args.cursor) {
      conditions.push(
        Prisma.sql`(t."createdAt", e."id") < (${args.cursor.occurredAt}, ${args.cursor.entryId})`
      );
    }

    const rows = await this.prisma.$queryRaw<LedgerEntryQueryRow[]>`
      SELECT
        e."id" AS "entryId",
        e."transactionId" AS "transactionId",
        e."direction" AS "direction",
        e."amountKobo" AS "amountKobo",
        t."kind" AS "kind",
        t."refType" AS "refType",
        t."refId" AS "refId",
        t."memo" AS "memo",
        t."potId" AS "potId",
        t."createdAt" AS "occurredAt"
      FROM "LedgerEntry" e
      JOIN "LedgerTransaction" t ON t."id" = e."transactionId"
      WHERE ${Prisma.join(conditions, " AND ")}
      ORDER BY t."createdAt" DESC, e."id" DESC
      LIMIT ${args.limit + 1}
    `;

    const hasMore = rows.length > args.limit;
    const page = hasMore ? rows.slice(0, args.limit) : rows;
    const items: LedgerEntryView[] = page.map((row) => toLedgerEntryView(row, ownerRef));
    const last = page.length > 0 ? page[page.length - 1] : null;
    const nextCursor =
      hasMore && last
        ? encodeLedgerEntryCursor({ occurredAt: last.occurredAt, entryId: last.entryId })
        : null;

    return { items, nextCursor };
  }

  async balancesByKind(kind: string): Promise<KindBalance[]> {
    const rows = await this.prisma.$queryRaw<{ ownerRef: string; net: bigint | null }[]>`
      SELECT
        a."ownerRef" AS "ownerRef",
        COALESCE(
          SUM(CASE WHEN e."direction" = 'DR' THEN e."amountKobo" ELSE -e."amountKobo" END),
          0
        ) AS "net"
      FROM "LedgerAccount" a
      LEFT JOIN "LedgerEntry" e ON e."accountId" = a."id"
      WHERE a."kind" = ${kind}
      GROUP BY a."ownerRef"
    `;
    return rows.map((row) => ({
      ownerRef: row.ownerRef,
      balanceKobo: this.applyNormalSign(kind, Number(row.net ?? 0n))
    }));
  }

  private applyNormalSign(kind: string, netDrMinusCr: number): number {
    return DR_NORMAL_KINDS.has(kind) ? netDrMinusCr : -netDrMinusCr;
  }

  private async resolveAccountId(
    client: Prisma.TransactionClient,
    kind: string,
    ownerRef: string
  ): Promise<string> {
    await client.$executeRaw`
      INSERT INTO "LedgerAccount" (id, kind, "ownerRef")
      VALUES (${randomUUID()}, ${kind}, ${ownerRef})
      ON CONFLICT (kind, "ownerRef") DO NOTHING
    `;
    const account = await client.ledgerAccount.findUniqueOrThrow({
      where: { kind_ownerRef: { kind, ownerRef } }
    });
    return account.id;
  }
}
