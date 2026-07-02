import { Injectable } from "@nestjs/common";
import { KycStatus, PrismaService, Tier, User } from "@paadi/db";

interface CreateUserWithProfileInput {
  phoneBlindIndex: string;
  phoneEncrypted: string;
  passwordHash: string;
  pinHash: string;
  username: string;
  usernameNormalized: string;
  firstName?: string;
  lastName?: string;
  displayName?: string;
}

interface UpdateKycInput {
  kycStatus: KycStatus;
  tier: Tier;
  bvnVerified: boolean;
  bvnVerifiedAt: Date;
  kycReference: string;
}

@Injectable()
export class UserRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string) {
    return this.prisma.user.findUnique({ where: { id } });
  }

  findByPhoneBlindIndex(blindIndex: string) {
    return this.prisma.user.findUnique({
      where: { phoneBlindIndex: blindIndex },
    });
  }

  findByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email } });
  }

  createWithProfile(input: CreateUserWithProfileInput) {
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          phoneBlindIndex: input.phoneBlindIndex,
          phoneEncrypted: input.phoneEncrypted,
          passwordHash: input.passwordHash,
          pinHash: input.pinHash,
        },
      });
      await tx.profile.create({
        data: {
          userId: user.id,
          username: input.username,
          usernameNormalized: input.usernameNormalized,
          firstName: input.firstName,
          lastName: input.lastName,
          displayName: input.displayName,
        },
      });
      return tx.user.findUnique({
        where: { id: user.id },
        include: { profile: true },
      });
    });
  }

  markPhoneVerified(userId: string): Promise<User> {
    return this.prisma.user.update({
      where: { id: userId },
      data: { phoneVerifiedAt: new Date() },
    });
  }

  setEmailVerified(userId: string, email: string): Promise<User> {
    return this.prisma.user.update({
      where: { id: userId },
      data: { email, emailVerifiedAt: new Date() },
    });
  }

  setPassword(userId: string, passwordHash: string): Promise<User> {
    return this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    });
  }

  setPin(userId: string, pinHash: string): Promise<User> {
    return this.prisma.user.update({
      where: { id: userId },
      data: { pinHash },
    });
  }

  updateKyc(userId: string, data: UpdateKycInput): Promise<User> {
    return this.prisma.user.update({ where: { id: userId }, data });
  }

  setKycPending(userId: string, reference: string): Promise<User> {
    return this.prisma.user.update({
      where: { id: userId },
      data: { kycStatus: KycStatus.PENDING, kycReference: reference },
    });
  }

  findByKycReference(reference: string) {
    return this.prisma.user.findFirst({ where: { kycReference: reference } });
  }
}
