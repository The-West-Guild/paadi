import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { OutboxMessage, OutboxRepository } from "@paadi/domain";
import {
  Prisma,
  PrismaService,
  VirtualAccount,
  VirtualAccountKind as DbVirtualAccountKind,
  VirtualAccountStatus as DbVirtualAccountStatus
} from "@paadi/db";
import { PrismaOutboxRepository } from "./outbox.repository";

const OUTBOX_TARGET = "user";

export interface PersistVirtualAccountInput {
  userId: string;
  accountNumber: string;
  accountName: string;
  providerBank: string;
  nombaAccountRef: string;
}

export interface ProvisionVirtualAccountResult {
  virtualAccount: VirtualAccount;
  created: boolean;
}

@Injectable()
export class VirtualAccountRepository {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(OutboxRepository) private readonly outbox: PrismaOutboxRepository
  ) {}

  findByUserId(userId: string): Promise<VirtualAccount | null> {
    return this.prisma.virtualAccount.findUnique({ where: { userId } });
  }

  findByAccountNumber(accountNumber: string): Promise<VirtualAccount | null> {
    return this.prisma.virtualAccount.findUnique({ where: { accountNumber } });
  }

  async provisionVirtualAccount(
    input: PersistVirtualAccountInput
  ): Promise<ProvisionVirtualAccountResult> {
    try {
      const virtualAccount = await this.prisma.$transaction(async (tx) => {
        const created = await tx.virtualAccount.create({
          data: {
            userId: input.userId,
            accountNumber: input.accountNumber,
            accountName: input.accountName,
            providerBank: input.providerBank,
            nombaAccountRef: input.nombaAccountRef,
            status: DbVirtualAccountStatus.ACTIVE,
            kind: DbVirtualAccountKind.STATIC
          }
        });
        await this.outbox.enqueue(
          this.provisioned(created.userId, created.accountNumber),
          tx
        );
        return created;
      });
      return { virtualAccount, created: true };
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        const existing = await this.findByUserId(input.userId);
        if (existing) {
          return { virtualAccount: existing, created: false };
        }
      }
      throw error;
    }
  }

  async updateName(userId: string, accountName: string): Promise<VirtualAccount> {
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.virtualAccount.update({
        where: { userId },
        data: { accountName }
      });
      await this.outbox.enqueue(this.renamed(updated.userId, updated.accountNumber), tx);
      return updated;
    });
  }

  setStatus(userId: string, status: DbVirtualAccountStatus): Promise<VirtualAccount> {
    return this.prisma.virtualAccount.update({
      where: { userId },
      data: { status }
    });
  }

  async close(userId: string): Promise<VirtualAccount> {
    return this.prisma.$transaction(async (tx) => {
      const closed = await tx.virtualAccount.update({
        where: { userId },
        data: { status: DbVirtualAccountStatus.CLOSED, closedAt: new Date() }
      });
      await this.outbox.enqueue(this.closedEvent(closed.userId, closed.accountNumber), tx);
      return closed;
    });
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
    );
  }

  private provisioned(userId: string, accountNumber: string): OutboxMessage {
    return {
      id: randomUUID(),
      target: OUTBOX_TARGET,
      event: { type: "virtual_account.provisioned", userId, accountNumber },
      attempts: 0
    };
  }

  private renamed(userId: string, accountNumber: string): OutboxMessage {
    return {
      id: randomUUID(),
      target: OUTBOX_TARGET,
      event: { type: "virtual_account.renamed", userId, accountNumber },
      attempts: 0
    };
  }

  private closedEvent(userId: string, accountNumber: string): OutboxMessage {
    return {
      id: randomUUID(),
      target: OUTBOX_TARGET,
      event: { type: "virtual_account.closed", userId, accountNumber },
      attempts: 0
    };
  }
}
