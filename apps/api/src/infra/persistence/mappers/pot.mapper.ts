import { Prisma, Split } from "@paadi/db";
import type {
  PayView,
  PotContributionsSummary,
  PotDetail,
  PotProgress,
  PotSummary,
  SplitDetail
} from "@paadi/contracts";

type PotWithSplits = Prisma.PotGetPayload<{ include: { splits: true } }>;

type SplitForPayView = Prisma.SplitGetPayload<{
  include: {
    pot: {
      include: {
        splits: { select: { status: true } };
        creator: { select: { profile: { select: { displayName: true; firstName: true; username: true } } } };
      };
    };
  };
}>;

function progressOf(input: {
  collectedKobo: bigint;
  targetKobo: bigint;
  splits: { status: string }[];
}): PotProgress {
  return {
    collectedKobo: Number(input.collectedKobo),
    targetKobo: Number(input.targetKobo),
    paidCount: input.splits.filter(
      (s) => s.status === "PAID" || s.status === "OVERPAID"
    ).length,
    splitCount: input.splits.length
  };
}

export function toSplitDetail(split: Split): SplitDetail {
  return {
    id: split.id,
    label: split.label,
    shareKobo: Number(split.shareKobo),
    paidKobo: Number(split.paidKobo),
    status: split.status.toLowerCase() as SplitDetail["status"],
    payToken: split.payToken,
    checkoutUrl: split.checkoutUrl,
    paidAt: split.paidAt ? split.paidAt.toISOString() : null
  };
}

export function toPotDetail(
  pot: PotWithSplits,
  contributions?: PotContributionsSummary
): PotDetail {
  return {
    id: pot.id,
    title: pot.title,
    description: pot.description,
    totalKobo: Number(pot.totalKobo),
    settlementType: pot.settlementType.toLowerCase() as PotDetail["settlementType"],
    completionRule: pot.completionRule.toLowerCase() as PotDetail["completionRule"],
    status: pot.status.toLowerCase() as PotDetail["status"],
    billerCategory: pot.billerCategory
      ? (pot.billerCategory.toLowerCase() as PotDetail["billerCategory"])
      : null,
    billerProductCode: pot.billerProductCode,
    billerCustomerId: pot.billerCustomerId,
    meterType: pot.meterType ?? null,
    deadlineAt: pot.deadlineAt ? pot.deadlineAt.toISOString() : null,
    settlement: null,
    createdAt: pot.createdAt.toISOString(),
    progress: progressOf(pot),
    splits: pot.splits.map(toSplitDetail),
    ...(contributions ? { contributions } : {})
  };
}

export function toPotSummary(pot: PotWithSplits): PotSummary {
  return {
    id: pot.id,
    title: pot.title,
    status: pot.status.toLowerCase() as PotSummary["status"],
    totalKobo: Number(pot.totalKobo),
    collectedKobo: Number(pot.collectedKobo),
    splitCount: pot.splits.length,
    paidCount: pot.splits.filter(
      (s) => s.status === "PAID" || s.status === "OVERPAID"
    ).length,
    deadlineAt: pot.deadlineAt ? pot.deadlineAt.toISOString() : null,
    createdAt: pot.createdAt.toISOString()
  };
}

export function toPayView(split: SplitForPayView): PayView {
  const profile = split.pot.creator.profile;
  const organizerName =
    profile?.displayName ?? profile?.firstName ?? profile?.username ?? "";
  const organizerHandle = profile?.username ?? "";
  return {
    potTitle: split.pot.title,
    organizerName,
    organizerHandle,
    splitLabel: split.label,
    shareKobo: Number(split.shareKobo),
    paidKobo: Number(split.paidKobo),
    shareStatus: split.status.toLowerCase() as PayView["shareStatus"],
    potStatus: split.pot.status.toLowerCase() as PayView["potStatus"],
    progress: progressOf({
      collectedKobo: split.pot.collectedKobo,
      targetKobo: split.pot.targetKobo,
      splits: split.pot.splits
    }),
    checkoutUrl: split.checkoutUrl
  };
}
