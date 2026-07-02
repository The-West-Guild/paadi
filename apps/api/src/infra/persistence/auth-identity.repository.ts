import { Injectable } from "@nestjs/common";
import { AuthIdentity, AuthProvider, PrismaService } from "@paadi/db";

interface LinkAuthIdentityInput {
  userId: string;
  provider: AuthProvider;
  providerAccountId: string;
  email?: string;
  emailVerified?: boolean;
}

@Injectable()
export class AuthIdentityRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByProviderAccount(provider: AuthProvider, providerAccountId: string) {
    return this.prisma.authIdentity.findUnique({
      where: { provider_providerAccountId: { provider, providerAccountId } },
    });
  }

  link(input: LinkAuthIdentityInput): Promise<AuthIdentity> {
    return this.prisma.authIdentity.create({
      data: {
        userId: input.userId,
        provider: input.provider,
        providerAccountId: input.providerAccountId,
        email: input.email,
        emailVerified: input.emailVerified,
      },
    });
  }

  touchLastSignIn(id: string): Promise<AuthIdentity> {
    return this.prisma.authIdentity.update({
      where: { id },
      data: { lastSignInAt: new Date() },
    });
  }

  listForUser(userId: string) {
    return this.prisma.authIdentity.findMany({ where: { userId } });
  }
}
