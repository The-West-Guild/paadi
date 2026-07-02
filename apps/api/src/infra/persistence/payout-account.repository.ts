import { Injectable } from "@nestjs/common";
import { PayoutAccount, Prisma, PrismaService } from "@paadi/db";

@Injectable()
export class PayoutAccountRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(
    input: Prisma.PayoutAccountUncheckedCreateInput,
  ): Promise<PayoutAccount> {
    return this.prisma.payoutAccount.create({ data: input });
  }

  listForUser(userId: string) {
    return this.prisma.payoutAccount.findMany({ where: { userId } });
  }

  findById(id: string) {
    return this.prisma.payoutAccount.findUnique({ where: { id } });
  }

  setPrimary(userId: string, id: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.payoutAccount.updateMany({
        where: { userId, id: { not: id } },
        data: { isPrimary: false },
      });
      return tx.payoutAccount.update({
        where: { id },
        data: { isPrimary: true },
      });
    });
  }

  remove(id: string): Promise<PayoutAccount> {
    return this.prisma.payoutAccount.delete({ where: { id } });
  }

  async hasAny(userId: string): Promise<boolean> {
    const count = await this.prisma.payoutAccount.count({ where: { userId } });
    return count > 0;
  }
}
