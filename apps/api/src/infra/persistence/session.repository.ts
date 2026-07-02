import { Injectable } from "@nestjs/common";
import { Prisma, PrismaService, Session } from "@paadi/db";

interface CreateSessionInput {
  userId: string;
  familyId: string;
  refreshTokenHash: string;
  parentId?: string;
  deviceInfo?: Prisma.InputJsonValue;
  ip?: string;
  userAgent?: string;
  expiresAt: Date;
}

interface RotateChildInput {
  refreshTokenHash: string;
  deviceInfo?: Prisma.InputJsonValue;
  ip?: string;
  userAgent?: string;
  expiresAt: Date;
}

@Injectable()
export class SessionRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(input: CreateSessionInput): Promise<Session> {
    return this.prisma.session.create({
      data: {
        userId: input.userId,
        familyId: input.familyId,
        refreshTokenHash: input.refreshTokenHash,
        parentId: input.parentId,
        deviceInfo: input.deviceInfo,
        ip: input.ip,
        userAgent: input.userAgent,
        expiresAt: input.expiresAt,
      },
    });
  }

  findByRefreshHash(hash: string) {
    return this.prisma.session.findUnique({
      where: { refreshTokenHash: hash },
    });
  }

  rotate(oldId: string, childInput: RotateChildInput) {
    return this.prisma.$transaction(async (tx) => {
      const old = await tx.session.update({
        where: { id: oldId },
        data: { rotatedAt: new Date() },
      });
      return tx.session.create({
        data: {
          userId: old.userId,
          familyId: old.familyId,
          parentId: old.id,
          refreshTokenHash: childInput.refreshTokenHash,
          deviceInfo: childInput.deviceInfo,
          ip: childInput.ip,
          userAgent: childInput.userAgent,
          expiresAt: childInput.expiresAt,
        },
      });
    });
  }

  revoke(id: string): Promise<Session> {
    return this.prisma.session.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
  }

  revokeFamily(familyId: string) {
    return this.prisma.session.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  revokeAllForUser(userId: string) {
    return this.prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  listActiveForUser(userId: string) {
    return this.prisma.session.findMany({ where: { userId, revokedAt: null } });
  }
}
