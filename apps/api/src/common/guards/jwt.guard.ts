import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ApiKeyAuthService } from "../../infra/auth/api-key-auth.service";
import { TokenService } from "../../infra/auth/token.service";
import { IS_PUBLIC } from "../decorators/public.decorator";

@Injectable()
export class JwtGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly apiKeys: ApiKeyAuthService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const header = request.headers?.authorization ?? "";
    const [scheme, token] = header.split(" ");
    if (scheme !== "Bearer" || !token) {
      throw new UnauthorizedException("missing bearer token");
    }

    request.user = token.startsWith("pk_")
      ? await this.apiKeys.verify(token)
      : await this.tokens.verifyAccess(token);
    return true;
  }
}
