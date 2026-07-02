import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@paadi/db";
import type { AuthSession } from "@paadi/contracts";
import { parsePhoneNumberFromString } from "libphonenumber-js";
import { CryptoService } from "../../../common/crypto/crypto.service";
import { OtpService } from "../../../infra/auth/otp.service";
import { TokenService } from "../../../infra/auth/token.service";
import { NotificationPreferenceRepository } from "../../../infra/persistence/notification-preference.repository";
import { ProfileRepository } from "../../../infra/persistence/profile.repository";
import { UserRepository } from "../../../infra/persistence/user.repository";
import { RedisService } from "../../../infra/redis/redis.service";
import { redisKeys } from "../../../infra/redis/redis.keys";
import { DEFAULT_NOTIFICATION_PREFS } from "../notifications/notification-defaults";
import { validateUsername } from "../username/username.util";

const SIGNUP_TTL_SECONDS = 1800;
const SIGNUP_PURPOSE = "signup_phone";

interface SignupSession {
  phoneE164: string;
  phoneVerified: boolean;
  firstName?: string;
  lastName?: string;
  displayName?: string;
  username?: string;
  usernameNormalized?: string;
  passwordHash?: string;
}

@Injectable()
export class SignupService {
  constructor(
    private readonly otp: OtpService,
    private readonly token: TokenService,
    private readonly crypto: CryptoService,
    private readonly userRepo: UserRepository,
    private readonly profileRepo: ProfileRepository,
    private readonly notifRepo: NotificationPreferenceRepository,
    private readonly redis: RedisService,
    private readonly config: ConfigService
  ) {}

  async start(phone: string): Promise<{ onboardingToken: string; expiresIn: number; otpChannel: string }> {
    const parsed = parsePhoneNumberFromString(phone, "NG");
    if (!parsed || !parsed.isValid()) {
      throw new BadRequestException("invalid phone");
    }
    const phoneE164 = parsed.number;
    const onboardingToken = this.crypto.randomToken(24);
    await this.persist(onboardingToken, { phoneE164, phoneVerified: false });
    await this.otp.issue(SIGNUP_PURPOSE, phoneE164, "sms");
    return { onboardingToken, expiresIn: SIGNUP_TTL_SECONDS, otpChannel: "sms" };
  }

  async verifyPhone(token: string, code: string): Promise<{ verified: boolean }> {
    const session = await this.load(token);
    const ok = await this.otp.verify(SIGNUP_PURPOSE, session.phoneE164, code);
    if (!ok) {
      throw new UnauthorizedException("invalid code");
    }
    session.phoneVerified = true;
    await this.persist(token, session);
    return { verified: true };
  }

  async setProfile(token: string, firstName: string, lastName: string): Promise<{ ok: boolean }> {
    const session = await this.load(token);
    this.requirePhoneVerified(session);
    session.firstName = firstName;
    session.lastName = lastName;
    session.displayName = `${firstName} ${lastName}`;
    await this.persist(token, session);
    return { ok: true };
  }

  async usernameAvailable(u: string): Promise<{ available: boolean; normalized: string; reason?: string }> {
    const v = validateUsername(u);
    if (!v.ok) {
      return { available: false, normalized: v.normalized, reason: v.reason };
    }
    const taken = await this.profileRepo.isUsernameTaken(v.normalized);
    return { available: !taken, normalized: v.normalized, reason: taken ? "taken" : undefined };
  }

  async setUsername(token: string, username: string): Promise<{ ok: boolean }> {
    const session = await this.load(token);
    this.requirePhoneVerified(session);
    const v = validateUsername(username);
    if (!v.ok) {
      throw new BadRequestException(v.reason);
    }
    if (await this.profileRepo.isUsernameTaken(v.normalized)) {
      throw new ConflictException("username taken");
    }
    session.username = username;
    session.usernameNormalized = v.normalized;
    await this.persist(token, session);
    return { ok: true };
  }

  async setPassword(token: string, password: string): Promise<{ ok: boolean }> {
    const session = await this.load(token);
    this.requirePhoneVerified(session);
    session.passwordHash = await this.crypto.hashSecret(password);
    await this.persist(token, session);
    return { ok: true };
  }

  async setPin(token: string, pin: string): Promise<AuthSession> {
    const session = await this.load(token);
    if (
      !session.phoneVerified ||
      !session.username ||
      !session.usernameNormalized ||
      !session.passwordHash ||
      !session.firstName
    ) {
      throw new BadRequestException("incomplete signup");
    }
    const pinHash = await this.crypto.hashSecret(pin);
    const phoneEncrypted = this.crypto.encryptPhone(session.phoneE164);
    const phoneBlindIndex = this.crypto.phoneBlindIndex(session.phoneE164);

    let user: Awaited<ReturnType<UserRepository["createWithProfile"]>>;
    try {
      user = await this.userRepo.createWithProfile({
        phoneBlindIndex,
        phoneEncrypted,
        passwordHash: session.passwordHash,
        pinHash,
        username: session.username,
        usernameNormalized: session.usernameNormalized,
        firstName: session.firstName,
        lastName: session.lastName,
        displayName: session.displayName
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException("account already exists");
      }
      throw error;
    }

    if (!user) {
      throw new ConflictException("account already exists");
    }

    await this.userRepo.markPhoneVerified(user.id);
    await this.notifRepo.seedDefaults(user.id, DEFAULT_NOTIFICATION_PREFS);
    await this.redis.del(redisKeys.signup(token));
    return this.token.issueSession({ id: user.id, tier: user.tier });
  }

  private requirePhoneVerified(session: SignupSession): void {
    if (!session.phoneVerified) {
      throw new BadRequestException("phone not verified");
    }
  }

  private async load(token: string): Promise<SignupSession> {
    const raw = await this.redis.get(redisKeys.signup(token));
    if (!raw) {
      throw new BadRequestException("invalid onboarding token");
    }
    return JSON.parse(raw) as SignupSession;
  }

  private async persist(token: string, session: SignupSession): Promise<void> {
    await this.redis.setex(redisKeys.signup(token), SIGNUP_TTL_SECONDS, JSON.stringify(session));
  }
}
