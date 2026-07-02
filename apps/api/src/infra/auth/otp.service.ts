import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { OtpChannel, OtpProvider } from "@paadi/domain";
import { CryptoService } from "../../common/crypto/crypto.service";
import { safeEqual } from "../../common/crypto/hmac";
import { RedisService } from "../redis/redis.service";
import { redisKeys } from "../redis/redis.keys";

interface IssueResult {
  expiresIn: number;
  resendIn: number;
}

@Injectable()
export class OtpService {
  constructor(
    private readonly redis: RedisService,
    private readonly crypto: CryptoService,
    private readonly otpProvider: OtpProvider,
    private readonly config: ConfigService
  ) {}

  async issue(purpose: string, target: string, channel: OtpChannel): Promise<IssueResult> {
    if (await this.redis.get(redisKeys.otpResend(purpose, target))) {
      throw new HttpException("resend too soon", HttpStatus.TOO_MANY_REQUESTS);
    }

    const ttlSeconds = this.ttlSeconds();
    const resendSeconds = this.resendSeconds();
    const code = this.crypto.randomOtp();

    await this.redis.setex(redisKeys.otp(purpose, target), ttlSeconds, this.crypto.hashOtp(code));
    await this.redis.del(redisKeys.otpAttempts(purpose, target));
    await this.redis.setex(redisKeys.otpResend(purpose, target), resendSeconds, "1");
    await this.otpProvider.send(channel, target, code);

    return { expiresIn: ttlSeconds, resendIn: resendSeconds };
  }

  async verify(purpose: string, target: string, code: string): Promise<boolean> {
    if (this.isDevBypass(code)) {
      return true;
    }

    const stored = await this.redis.get(redisKeys.otp(purpose, target));
    if (!stored) {
      return false;
    }

    if (safeEqual(stored, this.crypto.hashOtp(code))) {
      await this.redis.getdel(redisKeys.otp(purpose, target));
      await this.redis.del(redisKeys.otpAttempts(purpose, target));
      return true;
    }

    const attempts = await this.redis.incr(redisKeys.otpAttempts(purpose, target));
    await this.redis.expire(redisKeys.otpAttempts(purpose, target), this.ttlSeconds());
    if (attempts >= this.maxAttempts()) {
      await this.redis.del(redisKeys.otp(purpose, target));
      await this.redis.del(redisKeys.otpAttempts(purpose, target));
    }
    return false;
  }

  private ttlSeconds(): number {
    return this.config.get<number>("otp.ttlSeconds") ?? 300;
  }

  private resendSeconds(): number {
    return this.config.get<number>("otp.resendSeconds") ?? 60;
  }

  private maxAttempts(): number {
    return this.config.get<number>("otp.maxAttempts") ?? 3;
  }

  private isDevBypass(code: string): boolean {
    if ((this.config.get<string>("nodeEnv") ?? "development") === "production") {
      return false;
    }
    const bypassCode = this.config.get<string>("otp.devBypassCode");
    return Boolean(bypassCode) && code === bypassCode;
  }
}
