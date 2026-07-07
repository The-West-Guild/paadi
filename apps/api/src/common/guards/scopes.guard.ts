import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { AccessClaims } from "../../infra/auth/token.service";
import { REQUIRED_SCOPES } from "../decorators/scopes.decorator";

/**
 * Scope enforcement for API-key principals. Sessions bypass entirely; an API
 * key may only reach routes explicitly annotated with @Scopes(...), and must
 * hold every listed scope. @Scopes() with no arguments admits any valid key.
 */
@Injectable()
export class ScopesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const claims = request.user as AccessClaims | undefined;
    if (!claims || claims.via !== "apikey") {
      return true;
    }

    const required = this.reflector.getAllAndOverride<string[] | undefined>(REQUIRED_SCOPES, [
      context.getHandler(),
      context.getClass()
    ]);
    if (!required) {
      throw new ForbiddenException("api key not permitted on this endpoint");
    }

    const held = new Set(claims.scopes ?? []);
    if (!required.every((scope) => held.has(scope))) {
      throw new ForbiddenException("insufficient scope");
    }
    return true;
  }
}
