import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException
} from "@nestjs/common";
import { Prisma } from "@paadi/db";
import { OtpService } from "../../../infra/auth/otp.service";
import { UserRepository } from "../../../infra/persistence/user.repository";
import { RedisService } from "../../../infra/redis/redis.service";

const EMAIL_PENDING_TTL_SECONDS = 1800;
const EMAIL_PURPOSE = "email_verify";

@Injectable()
export class EmailVerificationService {
  constructor(
    private readonly userRepo: UserRepository,
    private readonly otp: OtpService,
    private readonly redis: RedisService
  ) {}

  async start(userId: string, email: string): Promise<{ expiresIn: number }> {
    const normalized = email.toLowerCase();
    const existing = await this.userRepo.findByEmail(normalized);
    if (existing && existing.id !== userId) {
      throw new ConflictException("email already in use");
    }
    await this.redis.setex(`email:pending:${userId}`, EMAIL_PENDING_TTL_SECONDS, normalized);
    await this.otp.issue(EMAIL_PURPOSE, normalized, "email");
    return { expiresIn: EMAIL_PENDING_TTL_SECONDS };
  }

  async verify(userId: string, code: string): Promise<{ ok: boolean; email: string }> {
    const pending = await this.redis.get(`email:pending:${userId}`);
    if (!pending) {
      throw new BadRequestException("no pending email");
    }
    const ok = await this.otp.verify(EMAIL_PURPOSE, pending, code);
    if (!ok) {
      throw new UnauthorizedException("invalid code");
    }
    try {
      await this.userRepo.setEmailVerified(userId, pending);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException("email already in use");
      }
      throw error;
    }
    await this.redis.del(`email:pending:${userId}`);
    return { ok: true, email: pending };
  }
}
