import { ConflictException, Injectable, UnauthorizedException } from "@nestjs/common";
import type { AuthSession } from "@paadi/contracts";
import { AuthProvider, Prisma } from "@paadi/db";
import { GoogleVerifier } from "@paadi/domain";
import { AuthIdentityRepository } from "../../../infra/persistence/auth-identity.repository";
import { UserRepository } from "../../../infra/persistence/user.repository";
import { TokenService } from "../../../infra/auth/token.service";

@Injectable()
export class GoogleIdentityService {
  constructor(
    private readonly verifier: GoogleVerifier,
    private readonly authIdentityRepo: AuthIdentityRepository,
    private readonly userRepo: UserRepository,
    private readonly token: TokenService
  ) {}

  async signIn(idToken: string): Promise<AuthSession> {
    const claims = await this.verifier.verify(idToken);
    if (!claims.emailVerified) {
      throw new UnauthorizedException("google email not verified");
    }
    const identity = await this.authIdentityRepo.findByProviderAccount(AuthProvider.GOOGLE, claims.sub);
    if (identity) {
      await this.authIdentityRepo.touchLastSignIn(identity.id);
      const user = await this.userRepo.findById(identity.userId);
      if (!user) {
        throw new UnauthorizedException("user not found");
      }
      return this.token.issueSession({ id: user.id, tier: user.tier });
    }
    const existing = await this.userRepo.findByEmail(claims.email.toLowerCase());
    if (existing) {
      throw new ConflictException("account exists — sign in with phone and link Google in settings");
    }
    throw new ConflictException("google sign-up requires phone verification");
  }

  async link(userId: string, idToken: string) {
    const claims = await this.verifier.verify(idToken);
    if (!claims.emailVerified) {
      throw new UnauthorizedException("google email not verified");
    }
    const existing = await this.authIdentityRepo.findByProviderAccount(AuthProvider.GOOGLE, claims.sub);
    if (existing && existing.userId !== userId) {
      throw new ConflictException("google account already linked to another user");
    }
    if (existing && existing.userId === userId) {
      return { ok: true };
    }
    try {
      await this.authIdentityRepo.link({
        userId,
        provider: AuthProvider.GOOGLE,
        providerAccountId: claims.sub,
        email: claims.email,
        emailVerified: claims.emailVerified
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException("google account already linked to another user");
      }
      throw error;
    }
    return { ok: true };
  }
}
