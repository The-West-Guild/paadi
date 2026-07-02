import { Injectable } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { $Enums, PrismaService } from "@paadi/db";

export interface CreatePotSplitInput {
  label: string;
  weight: number;
  shareKobo: number;
  phoneEnc?: string | null;
}

export interface CreatePotWithSplitsInput {
  creatorId: string;
  title: string;
  description?: string | null;
  totalKobo: number;
  targetKobo: number;
  settlementType: $Enums.SettlementType;
  completionRule: $Enums.CompletionRule;
  attributionMode: $Enums.AttributionMode;
  billerCategory?: $Enums.BillerCategory | null;
  billerProductCode?: string | null;
  billerCustomerId?: string | null;
  meterType?: $Enums.MeterType | null;
  payoutAccountId?: string | null;
  deadlineAt?: Date | null;
  splits: CreatePotSplitInput[];
}

export interface UpdatePotPatch {
  title?: string;
  description?: string;
  deadlineAt?: Date;
}

function newPayToken(): string {
  return randomBytes(16).toString("base64url");
}

@Injectable()
export class PotRepository {
  constructor(private readonly prisma: PrismaService) {}

  createPotWithSplits(input: CreatePotWithSplitsInput) {
    return this.prisma.$transaction((tx) =>
      tx.pot.create({
        data: {
          creatorId: input.creatorId,
          title: input.title,
          description: input.description ?? null,
          totalKobo: BigInt(input.totalKobo),
          targetKobo: BigInt(input.targetKobo),
          settlementType: input.settlementType,
          completionRule: input.completionRule,
          attributionMode: input.attributionMode,
          billerCategory: input.billerCategory ?? null,
          billerProductCode: input.billerProductCode ?? null,
          billerCustomerId: input.billerCustomerId ?? null,
          meterType: input.meterType ?? null,
          payoutAccountId: input.payoutAccountId ?? null,
          deadlineAt: input.deadlineAt ?? null,
          splits: {
            create: input.splits.map((s) => ({
              label: s.label,
              weight: s.weight,
              shareKobo: BigInt(s.shareKobo),
              payToken: newPayToken(),
              payerPhoneEnc: s.phoneEnc ?? null,
            })),
          },
        },
        include: { splits: { orderBy: { createdAt: "asc" } } },
      }),
    );
  }

  setCheckout(splitId: string, checkoutOrderRef: string, checkoutUrl: string) {
    return this.prisma.split.update({
      where: { id: splitId },
      data: { checkoutOrderRef, checkoutUrl }
    });
  }

  markOpen(potId: string) {
    return this.prisma.pot.update({
      where: { id: potId },
      data: { status: "OPEN" },
      include: { splits: { orderBy: { createdAt: "asc" } } }
    });
  }

  findByIdForCreator(potId: string, creatorId: string) {
    return this.prisma.pot.findFirst({
      where: { id: potId, creatorId },
      include: { splits: { orderBy: { createdAt: "asc" } } }
    });
  }

  async listForCreator(
    creatorId: string,
    cursor?: string,
    limit = 20,
    status?: $Enums.PotStatus
  ) {
    const rows = await this.prisma.pot.findMany({
      where: { creatorId, ...(status ? { status } : {}) },
      include: { splits: { orderBy: { createdAt: "asc" } } },
      orderBy: { createdAt: "desc" },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {})
    });
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? (items[items.length - 1]?.id ?? null) : null;
    return { items, nextCursor };
  }

  findByPayToken(token: string) {
    return this.prisma.split.findUnique({
      where: { payToken: token },
      include: {
        pot: {
          include: {
            splits: { select: { status: true } },
            creator: { select: { profile: { select: { displayName: true, firstName: true, username: true } } } }
          }
        }
      }
    });
  }

  update(potId: string, patch: UpdatePotPatch) {
    return this.prisma.pot.update({
      where: { id: potId },
      data: {
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.description !== undefined
          ? { description: patch.description }
          : {}),
        ...(patch.deadlineAt !== undefined
          ? { deadlineAt: patch.deadlineAt }
          : {})
      },
      include: { splits: { orderBy: { createdAt: "asc" } } }
    });
  }

  deleteIfNoPayments(potId: string): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const payments = await tx.payment.count({ where: { potId } });
      if (payments > 0) {
        return false;
      }
      await tx.split.deleteMany({ where: { potId } });
      await tx.pot.delete({ where: { id: potId } });
      return true;
    });
  }

  cancel(potId: string) {
    return this.prisma.pot.update({
      where: { id: potId },
      data: { status: "CANCELLED" },
      include: { splits: { orderBy: { createdAt: "asc" } } }
    });
  }

  async hasPayments(potId: string): Promise<boolean> {
    const count = await this.prisma.payment.count({ where: { potId } });
    return count > 0;
  }

  countPaidSplits(potId: string): Promise<number> {
    return this.prisma.split.count({
      where: { potId, status: { in: ["PAID", "OVERPAID"] } }
    });
  }

  async contributionsSummary(potId: string): Promise<{
    contributorCount: number;
    paidSplitCount: number;
    totalSplitCount: number;
    collectedKobo: number;
    targetKobo: number;
  }> {
    const [pot, totalSplitCount, paidSplits] = await Promise.all([
      this.prisma.pot.findUnique({
        where: { id: potId },
        select: { collectedKobo: true, targetKobo: true }
      }),
      this.prisma.split.count({ where: { potId } }),
      this.prisma.payment.findMany({
        where: { potId, status: "succeeded", splitId: { not: null } },
        select: { splitId: true },
        distinct: ["splitId"]
      })
    ]);
    const paidSplitCount = paidSplits.length;
    return {
      contributorCount: paidSplitCount,
      paidSplitCount,
      totalSplitCount,
      collectedKobo: pot ? Number(pot.collectedKobo) : 0,
      targetKobo: pot ? Number(pot.targetKobo) : 0
    };
  }
}
