import { ExecutionContext, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ApiKeyAuthService } from "../../infra/auth/api-key-auth.service";
import { TokenService, type AccessClaims } from "../../infra/auth/token.service";
import { JwtGuard } from "./jwt.guard";

const SESSION_CLAIMS: AccessClaims = { sub: "user-1", sid: "sid-1", tier: "TIER_1", via: "session" };
const APIKEY_CLAIMS: AccessClaims = {
  sub: "user-1",
  sid: "apikey:key-1",
  tier: "TIER_1",
  via: "apikey",
  scopes: ["pots:read"],
  apiKeyId: "key-1"
};

function makeContext(options: { authorization?: string; isPublic?: boolean }) {
  const request: { headers: Record<string, string>; user?: AccessClaims } = {
    headers: options.authorization ? { authorization: options.authorization } : {}
  };
  const context = {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => request })
  } as unknown as ExecutionContext;
  const reflector = {
    getAllAndOverride: jest.fn(() => options.isPublic ?? false)
  } as unknown as Reflector;
  return { context, reflector, request };
}

function build(options: { authorization?: string; isPublic?: boolean } = {}) {
  const { context, reflector, request } = makeContext(options);
  const tokens = {
    verifyAccess: jest.fn(async () => SESSION_CLAIMS)
  } as unknown as TokenService;
  const apiKeys = {
    verify: jest.fn(async () => APIKEY_CLAIMS)
  } as unknown as ApiKeyAuthService;
  const guard = new JwtGuard(reflector, tokens, apiKeys);
  return { guard, context, request, tokens, apiKeys };
}

describe("JwtGuard", () => {
  it("bypasses public routes without touching either verifier", async () => {
    const { guard, context, tokens, apiKeys } = build({ isPublic: true });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(tokens.verifyAccess).not.toHaveBeenCalled();
    expect(apiKeys.verify).not.toHaveBeenCalled();
  });

  it("rejects a missing bearer token with 401", async () => {
    const { guard, context } = build();
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("routes pk_ tokens to the api-key verifier", async () => {
    const { guard, context, request, tokens, apiKeys } = build({
      authorization: "Bearer pk_test_abc123"
    });
    await guard.canActivate(context);
    expect(apiKeys.verify).toHaveBeenCalledWith("pk_test_abc123");
    expect(tokens.verifyAccess).not.toHaveBeenCalled();
    expect(request.user).toEqual(APIKEY_CLAIMS);
  });

  it("routes JWTs to the token service", async () => {
    const { guard, context, request, tokens, apiKeys } = build({
      authorization: "Bearer eyJ.some.jwt"
    });
    await guard.canActivate(context);
    expect(tokens.verifyAccess).toHaveBeenCalledWith("eyJ.some.jwt");
    expect(apiKeys.verify).not.toHaveBeenCalled();
    expect(request.user).toEqual(SESSION_CLAIMS);
  });
});
