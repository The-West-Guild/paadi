import { Inject, Injectable } from "@nestjs/common";
import { LedgerAccountKind, LedgerRepository } from "@paadi/domain";
import { PrismaService } from "@paadi/db";
import { PrismaLedgerRepository } from "../../infra/persistence/ledger.repository";

export interface WalletBalance {
  balanceKobo: number;
}

@Injectable()
export class WalletService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(LedgerRepository) private readonly ledger: PrismaLedgerRepository
  ) {}

  async balanceOf(userId: string): Promise<WalletBalance> {
    const account = await this.prisma.ledgerAccount.findUnique({
      where: {
        kind_ownerRef: { kind: LedgerAccountKind.UserWallet, ownerRef: userId }
      }
    });
    if (!account) {
      return { balanceKobo: 0 };
    }
    const net = await this.ledger.balance(account.id);
    return { balanceKobo: Math.max(0, -net) };
  }
}
