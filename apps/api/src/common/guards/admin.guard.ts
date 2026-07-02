import { CanActivate, ExecutionContext, ForbiddenException, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Reflector } from "@nestjs/core";
import type { AccessClaims } from "../../infra/auth/token.service";
import { IS_ADMIN_ONLY } from "../decorators/admin-only.decorator";

@Injectable()
export class AdminGuard implements CanActivate {
  private readonly logger = new Logger(AdminGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly config: ConfigService
  ) {
    if (this.allowlist().length === 0) {
      this.logger.warn("PAADI_ADMIN_USER_IDS is empty; admin endpoints are fail-closed and will deny all callers");
    }
  }

  canActivate(context: ExecutionContext): boolean {
    const adminOnly = this.reflector.getAllAndOverride<boolean>(IS_ADMIN_ONLY, [
      context.getHandler(),
      context.getClass()
    ]);
    if (!adminOnly) {
      return true;
    }

    const allowlist = this.allowlist();
    if (allowlist.length === 0) {
      throw new ForbiddenException("admin only");
    }

    const claims = context.switchToHttp().getRequest().user as AccessClaims | undefined;
    if (!claims?.sub || !allowlist.includes(claims.sub)) {
      throw new ForbiddenException("admin only");
    }

    return true;
  }

  private allowlist(): string[] {
    return this.config.get<string[]>("admin.userIds") ?? [];
  }
}
