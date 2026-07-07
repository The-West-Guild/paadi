import { ExecutionContext, ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { AccessClaims } from "../../infra/auth/token.service";
import { ScopesGuard } from "./scopes.guard";

function makeContext(user: AccessClaims | undefined, required: string[] | undefined) {
  const context = {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => ({ user }) })
  } as unknown as ExecutionContext;
  const reflector = {
    getAllAndOverride: jest.fn(() => required)
  } as unknown as Reflector;
  return { guard: new ScopesGuard(reflector), context };
}

function apiKeyClaims(scopes: string[]): AccessClaims {
  return {
    sub: "user-1",
    sid: "apikey:key-1",
    tier: "TIER_1",
    via: "apikey",
    scopes,
    apiKeyId: "key-1"
  };
}

describe("ScopesGuard", () => {
  it("bypasses session principals regardless of annotations", () => {
    const session: AccessClaims = { sub: "u", sid: "s", tier: "TIER_1", via: "session" };
    const { guard, context } = makeContext(session, undefined);
    expect(guard.canActivate(context)).toBe(true);
  });

  it("bypasses public routes (no principal)", () => {
    const { guard, context } = makeContext(undefined, undefined);
    expect(guard.canActivate(context)).toBe(true);
  });

  it("default-denies api keys on unannotated routes", () => {
    const { guard, context } = makeContext(apiKeyClaims(["pots:read"]), undefined);
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    expect(() => guard.canActivate(context)).toThrow("api key not permitted on this endpoint");
  });

  it("admits any api key on an empty @Scopes() annotation", () => {
    const { guard, context } = makeContext(apiKeyClaims([]), []);
    expect(guard.canActivate(context)).toBe(true);
  });

  it("passes an api key holding every required scope", () => {
    const { guard, context } = makeContext(apiKeyClaims(["pots:read", "pots:write"]), ["pots:write"]);
    expect(guard.canActivate(context)).toBe(true);
  });

  it("rejects an api key missing a required scope with 403 insufficient scope", () => {
    const { guard, context } = makeContext(apiKeyClaims(["pots:read"]), ["wallet:withdraw"]);
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    expect(() => guard.canActivate(context)).toThrow("insufficient scope");
  });
});
