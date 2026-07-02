import { Injectable, UnauthorizedException } from "@nestjs/common";
import type { AuthSession, LoginResponse } from "@paadi/contracts";
import { CryptoService } from "../../../common/crypto/crypto.service";
import { OtpService } from "../../../infra/auth/otp.service";
import { TokenService } from "../../../infra/auth/token.service";
import { ProfileRepository } from "../../../infra/persistence/profile.repository";
import { UserRepository } from "../../../infra/persistence/user.repository";
import { classifyIdentifier } from "./identifier.util";

interface DeviceInfo {
  deviceId?: string;
  userAgent?: string;
  ip?: string;
}

@Injectable()
export class AuthSessionService {
  constructor(
    private readonly userRepo: UserRepository,
    private readonly profileRepo: ProfileRepository,
    private readonly crypto: CryptoService,
    private readonly token: TokenService,
    private readonly otp: OtpService
  ) {}

  async login(identifier: string, password: string, deviceInfo?: DeviceInfo): Promise<LoginResponse> {
    const user = await this.resolveUser(identifier);
    if (!user || !user.passwordHash) {
      await this.crypto.hashSecret(password);
      throw new UnauthorizedException("invalid credentials");
    }
    const ok = await this.crypto.verifySecret(user.passwordHash, password);
    if (!ok) {
      throw new UnauthorizedException("invalid credentials");
    }
    const tokens = await this.token.issueSession({ id: user.id, tier: user.tier }, deviceInfo);
    return { ...tokens, stepUpRequired: false };
  }

  refresh(refreshToken: string): Promise<AuthSession> {
    return this.token.rotate(refreshToken);
  }

  async logout(sessionId: string): Promise<{ ok: boolean }> {
    await this.token.revoke(sessionId);
    return { ok: true };
  }

  async logoutAll(userId: string): Promise<{ ok: boolean }> {
    await this.token.revokeAllForUser(userId);
    return { ok: true };
  }

  async forgotPassword(identifier: string): Promise<{ message: string }> {
    const user = await this.resolveUser(identifier);
    if (user) {
      const phone = this.crypto.decryptPhone(user.phoneEncrypted);
      await this.otp.issue("reset", phone, "sms");
    }
    return { message: "if the account exists, a reset code has been sent" };
  }

  async resetPassword(identifier: string, code: string, newPassword: string): Promise<{ ok: boolean }> {
    const user = await this.resolveUser(identifier);
    if (!user) {
      await this.otp.verify("reset", "+0000000000", code);
      throw new UnauthorizedException("invalid reset");
    }
    const phone = this.crypto.decryptPhone(user.phoneEncrypted);
    const ok = await this.otp.verify("reset", phone, code);
    if (!ok) {
      throw new UnauthorizedException("invalid reset");
    }
    await this.userRepo.setPassword(user.id, await this.crypto.hashSecret(newPassword));
    await this.token.revokeAllForUser(user.id);
    return { ok: true };
  }

  private async resolveUser(identifier: string) {
    const resolved = classifyIdentifier(identifier);
    if (resolved.kind === "email") {
      return this.userRepo.findByEmail(resolved.value);
    }
    if (resolved.kind === "phone") {
      return this.userRepo.findByPhoneBlindIndex(this.crypto.phoneBlindIndex(resolved.value));
    }
    const profile = await this.profileRepo.findByUsernameNormalized(resolved.value);
    return profile ? this.userRepo.findById(profile.userId) : null;
  }
}
