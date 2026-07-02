import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  LedgerAccountKind,
  LedgerRepository,
  PaymentProviderPort,
} from "@paadi/domain";
import type { ReconciliationReportResponse } from "@paadi/contracts";
import { PrismaService } from "@paadi/db";

const HOUSE = "house";

@Injectable()
export class ReconciliationReportService {
  private readonly logger = new Logger(ReconciliationReportService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(LedgerRepository) private readonly ledger: LedgerRepository,
    @Inject(PaymentProviderPort) private readonly provider: PaymentProviderPort,
  ) {}

  async build(): Promise<ReconciliationReportResponse> {
    const [
      pooledCashKobo,
      potLiabilityKobo,
      userWalletKobo,
      exceptionsSuspenseKobo,
      settlementPayoutKobo,
      platformFeeKobo,
      refundsPayableKobo,
      counts,
      external,
    ] = await Promise.all([
      this.ledger.accountBalanceKobo(LedgerAccountKind.PooledCash, HOUSE),
      this.sumKind(LedgerAccountKind.PotLiability),
      this.sumKind(LedgerAccountKind.UserWallet),
      this.sumKind(LedgerAccountKind.ExceptionsSuspense),
      this.sumKind(LedgerAccountKind.SettlementPayout),
      this.sumKind(LedgerAccountKind.PlatformFee),
      this.sumKind(LedgerAccountKind.RefundsPayable),
      this.loadCounts(),
      this.loadExternal(),
    ]);

    const sumLiabilitiesKobo =
      potLiabilityKobo +
      userWalletKobo +
      exceptionsSuspenseKobo +
      refundsPayableKobo -
      settlementPayoutKobo -
      platformFeeKobo;
    const internalDriftKobo = pooledCashKobo - sumLiabilitiesKobo;
    const balanced = internalDriftKobo === 0;

    if (!balanced) {
      this.logger.error(
        `reconciliation internal drift non-zero: drift=${internalDriftKobo} pooled=${pooledCashKobo} sumLiabilities=${sumLiabilitiesKobo}`,
      );
    }

    return {
      asOf: new Date().toISOString(),
      currency: "NGN",
      pooledCashKobo,
      sumLiabilitiesKobo,
      breakdown: {
        potLiabilityKobo,
        userWalletKobo,
        exceptionsSuspenseKobo,
        settlementPayoutKobo,
        platformFeeKobo,
        refundsPayableKobo,
      },
      internalDriftKobo,
      balanced,
      external:
        external === null
          ? "unavailable"
          : {
              nombaKobo: external,
              externalDriftKobo: pooledCashKobo - external,
            },
      counts,
    };
  }

  private async sumKind(kind: string): Promise<number> {
    const balances = await this.ledger.balancesByKind(kind);
    return balances.reduce((total, entry) => total + entry.balanceKobo, 0);
  }

  private async loadCounts(): Promise<ReconciliationReportResponse["counts"]> {
    const [pots, wallets, openExceptions] = await Promise.all([
      this.prisma.ledgerAccount.count({
        where: { kind: LedgerAccountKind.PotLiability },
      }),
      this.prisma.ledgerAccount.count({
        where: { kind: LedgerAccountKind.UserWallet },
      }),
      this.prisma.reconciliationException.count({ where: { status: "OPEN" } }),
    ]);
    return { pots, wallets, openExceptions };
  }

  private async loadExternal(): Promise<number | null> {
    try {
      const balance = await this.provider.fetchAccountBalance();
      return balance ? balance.availableKobo : null;
    } catch (error) {
      this.logger.warn(`nomba balance read unavailable: ${String(error)}`);
      return null;
    }
  }
}
