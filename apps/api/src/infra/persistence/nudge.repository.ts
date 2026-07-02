import { Injectable } from "@nestjs/common";
import { $Enums, Prisma, PrismaService, PotStatus, ShareStatus } from "@paadi/db";

type NudgeKind = $Enums.NudgeKind;
const NUDGE_CREATED_DELAY: NudgeKind = "CREATED_DELAY";
const NUDGE_DEADLINE_APPROACHING: NudgeKind = "DEADLINE_APPROACHING";

export interface DueSplit {
  id: string;
  label: string;
  shareKobo: bigint;
  paidKobo: bigint;
  status: ShareStatus;
  checkoutUrl: string | null;
  payerPhoneEnc: string | null;
}

export interface DuePotCreator {
  id: string;
  phoneEncrypted: string;
  profile: { displayName: string | null; firstName: string | null; username: string } | null;
  devices: { pushToken: string | null }[];
}

export interface DuePot {
  id: string;
  title: string;
  createdAt: Date;
  deadlineAt: Date | null;
  creatorId: string;
  creator: DuePotCreator;
  splits: DueSplit[];
}

const DUE_STATUSES: PotStatus[] = [PotStatus.OPEN, PotStatus.FUNDED];
const UNPAID_SPLIT_STATUSES: ShareStatus[] = [ShareStatus.PENDING, ShareStatus.PARTIALLY_PAID];

@Injectable()
export class NudgeRepository {
  constructor(private readonly prisma: PrismaService) {}

  findPotsDueForCreatedDelay(delayMs: number, limit: number): Promise<DuePot[]> {
    const cutoff = new Date(Date.now() - delayMs);
    return this.prisma.pot.findMany({
      where: {
        status: { in: DUE_STATUSES },
        createdAt: { lte: cutoff },
        splits: { some: { status: { in: UNPAID_SPLIT_STATUSES } } },
        potNudges: { none: { kind: NUDGE_CREATED_DELAY } },
      },
      take: limit,
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        title: true,
        createdAt: true,
        deadlineAt: true,
        creatorId: true,
        creator: {
          select: {
            id: true,
            phoneEncrypted: true,
            profile: { select: { displayName: true, firstName: true, username: true } },
            devices: { select: { pushToken: true } },
          },
        },
        splits: {
          select: {
            id: true,
            label: true,
            shareKobo: true,
            paidKobo: true,
            status: true,
            checkoutUrl: true,
            payerPhoneEnc: true,
          },
        },
      },
    });
  }

  findPotsDueForDeadlineWindow(windowMs: number, limit: number): Promise<DuePot[]> {
    const now = new Date();
    const windowEnd = new Date(now.getTime() + windowMs);
    return this.prisma.pot.findMany({
      where: {
        status: { in: DUE_STATUSES },
        deadlineAt: { gte: now, lte: windowEnd },
        splits: { some: { status: { in: UNPAID_SPLIT_STATUSES } } },
        potNudges: { none: { kind: NUDGE_DEADLINE_APPROACHING } },
      },
      take: limit,
      orderBy: { deadlineAt: "asc" },
      select: {
        id: true,
        title: true,
        createdAt: true,
        deadlineAt: true,
        creatorId: true,
        creator: {
          select: {
            id: true,
            phoneEncrypted: true,
            profile: { select: { displayName: true, firstName: true, username: true } },
            devices: { select: { pushToken: true } },
          },
        },
        splits: {
          select: {
            id: true,
            label: true,
            shareKobo: true,
            paidKobo: true,
            status: true,
            checkoutUrl: true,
            payerPhoneEnc: true,
          },
        },
      },
    });
  }

  async markPotNudged(potId: string, kind: NudgeKind, recipientCount: number): Promise<void> {
    try {
      await this.prisma.potNudge.create({ data: { potId, kind, recipientCount } });
    } catch (error) {
      if (this.isDuplicate(error)) {
        return;
      }
      throw error;
    }
  }

  async markSplitNudged(splitId: string, kind: NudgeKind): Promise<void> {
    try {
      await this.prisma.splitNudge.create({ data: { splitId, kind } });
    } catch (error) {
      if (this.isDuplicate(error)) {
        return;
      }
      throw error;
    }
  }

  async wasSplitNudged(splitId: string, kind: NudgeKind): Promise<boolean> {
    const count = await this.prisma.splitNudge.count({ where: { splitId, kind } });
    return count > 0;
  }

  private isDuplicate(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
  }
}