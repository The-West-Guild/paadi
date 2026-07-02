import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHmac } from "node:crypto";
import { safeEqual } from "../common/crypto/hmac";

@Injectable()
export class DojahSignatureGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const provided = request.headers["x-dojah-signature"] as string | undefined;
    if (!provided) {
      throw new UnauthorizedException("missing signature");
    }
    const secret = this.config.get<string>("dojah.webhookSecret") ?? "";
    const raw = request.rawBody as Buffer | undefined;
    if (!raw) {
      throw new UnauthorizedException("missing raw body");
    }
    const expected = createHmac("sha256", secret).update(raw).digest("hex");
    if (!safeEqual(provided, expected)) {
      throw new UnauthorizedException("invalid signature");
    }
    return true;
  }
}
