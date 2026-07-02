import { Injectable } from "@nestjs/common";
import { IdempotencyRecord, IdempotencyStore } from "@paadi/domain";
import { Prisma, PrismaService } from "@paadi/db";

@Injectable()
export class PrismaIdempotencyStore extends IdempotencyStore {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async remember(record: IdempotencyRecord): Promise<boolean> {
    try {
      await this.prisma.idempotencyKey.create({
        data: {
          key: record.key,
          scope: record.scope,
          requestHash: record.requestHash,
          response:
            record.response === undefined
              ? undefined
              : (record.response as Prisma.InputJsonValue)
        }
      });
      return true;
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        if (record.response !== undefined) {
          await this.prisma.idempotencyKey.update({
            where: { key: record.key },
            data: { response: record.response as Prisma.InputJsonValue }
          });
        }
        return false;
      }
      throw err;
    }
  }

  async seen(key: string): Promise<boolean> {
    const count = await this.prisma.idempotencyKey.count({ where: { key } });
    return count > 0;
  }

  async getResult(
    key: string
  ): Promise<{ requestHash: string; response?: unknown } | null> {
    const row = await this.prisma.idempotencyKey.findUnique({ where: { key } });
    if (!row) {
      return null;
    }
    return {
      requestHash: row.requestHash,
      response: row.response === null ? undefined : row.response
    };
  }
}
