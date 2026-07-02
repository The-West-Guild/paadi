import { BadRequestException, ConflictException, ExecutionContext, ForbiddenException, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Reflector } from "@nestjs/core";
import {
  ExceptionResolutionAction,
  type ExceptionDto,
  type ListExceptionsResponse,
  type ResolveExceptionInput
} from "@paadi/contracts";
import { AdminOnly } from "../../common/decorators/admin-only.decorator";
import { AdminGuard } from "../../common/guards/admin.guard";
import type { AccessClaims } from "../../infra/auth/token.service";
import { ReconciliationController } from "./reconciliation.controller";
import type { ReconciliationService } from "./reconciliation.service";

function makeExceptionDto(overrides: Partial<ExceptionDto> = {}): ExceptionDto {
  return {
    id: overrides.id ?? "11111111-1111-1111-1111-111111111111",
    nombaTransactionId: overrides.nombaTransactionId ?? "ntx-1",
    amountKobo: overrides.amountKobo ?? 400000,
    reason: overrides.reason ?? "UNKNOWN_ACCOUNT",
    status: overrides.status ?? "OPEN",
    senderName: overrides.senderName ?? "Ada Lovelace",
    senderAccount: overrides.senderAccount ?? "0123456789",
    senderBank: overrides.senderBank ?? "GTBank",
    vaAccountNumber: overrides.vaAccountNumber ?? null,
    matchedUserId: overrides.matchedUserId ?? null,
    resolvedBy: overrides.resolvedBy ?? null,
    resolvedAt: overrides.resolvedAt ?? null,
    note: overrides.note ?? null,
    refundStatus: overrides.refundStatus ?? null,
    createdAt: overrides.createdAt ?? "2026-07-01T00:00:00.000Z"
  };
}

interface ServiceOverrides {
  listExceptions?: (query: unknown) => Promise<ListExceptionsResponse>;
  resolve?: (
    id: string,
    action: string,
    resolvedBy: string,
    body: ResolveExceptionInput
  ) => Promise<ExceptionDto>;
}

function makeService(overrides: ServiceOverrides = {}) {
  const service = {
    listExceptions: jest.fn(
      overrides.listExceptions ??
        (async () => ({
          items: [makeExceptionDto()],
          nextCursor: null,
          totals: { openCount: 1, openAmountKobo: 400000 }
        }))
    ),
    resolve: jest.fn(
      overrides.resolve ??
        (async (id: string) => makeExceptionDto({ id, status: "RESOLVED" }))
    )
  };
  return service;
}

function makeController(service: ReturnType<typeof makeService>): ReconciliationController {
  return new ReconciliationController(service as unknown as ReconciliationService);
}

function claimsFor(sub: string): AccessClaims {
  return { sub, sid: "sid-1", tier: "TIER_1" } as AccessClaims;
}

function guardContextFor(sub: string): ExecutionContext {
  class Guarded {
    @AdminOnly()
    handler(): void {}
  }
  return {
    getHandler: () => Guarded.prototype.handler,
    getClass: () => Guarded,
    switchToHttp: () => ({ getRequest: () => ({ user: { sub, sid: "sid-1", tier: "TIER_1" } }) })
  } as unknown as ExecutionContext;
}

function makeGuard(): AdminGuard {
  const config = { get: () => ["admin-allowed"] } as unknown as ConfigService;
  return new AdminGuard(new Reflector(), config);
}

describe("ReconciliationController admin gate", () => {
  it("denies a non-allowlisted caller with 403", () => {
    const guard = makeGuard();
    expect(() => guard.canActivate(guardContextFor("not-admin"))).toThrow(ForbiddenException);
  });

  it("admits an allowlisted caller with 200", () => {
    const guard = makeGuard();
    expect(guard.canActivate(guardContextFor("admin-allowed"))).toBe(true);
  });
});

describe("ReconciliationController.resolve error contract", () => {
  it("surfaces a 404 when the exception is not found", async () => {
    const service = makeService({
      resolve: async () => {
        throw new NotFoundException("exception not found");
      }
    });
    const controller = makeController(service);

    await expect(
      controller.resolve(
        claimsFor("admin-allowed"),
        { id: "11111111-1111-1111-1111-111111111111" },
        { action: "hold" } as ResolveExceptionInput
      )
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("surfaces a 409 when the exception is already resolved", async () => {
    const service = makeService({
      resolve: async () => {
        throw new ConflictException("exception already resolved");
      }
    });
    const controller = makeController(service);

    await expect(
      controller.resolve(
        claimsFor("admin-allowed"),
        { id: "11111111-1111-1111-1111-111111111111" },
        { action: "assign", userId: "22222222-2222-2222-2222-222222222222" } as ResolveExceptionInput
      )
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("surfaces a 400 when assign is requested without a userId", async () => {
    const service = makeService({
      resolve: async () => {
        throw new BadRequestException("userId required to assign");
      }
    });
    const controller = makeController(service);

    await expect(
      controller.resolve(
        claimsFor("admin-allowed"),
        { id: "11111111-1111-1111-1111-111111111111" },
        { action: "assign" } as ResolveExceptionInput
      )
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("passes the resolving admin (claims.sub) and the action through to the service", async () => {
    const service = makeService();
    const controller = makeController(service);

    const dto = await controller.resolve(
      claimsFor("admin-allowed"),
      { id: "33333333-3333-3333-3333-333333333333" },
      { action: "assign", userId: "22222222-2222-2222-2222-222222222222" } as ResolveExceptionInput
    );

    expect(service.resolve).toHaveBeenCalledWith(
      "33333333-3333-3333-3333-333333333333",
      ExceptionResolutionAction.Assign,
      "admin-allowed",
      { action: "assign", userId: "22222222-2222-2222-2222-222222222222" }
    );
    expect(dto.status).toBe("RESOLVED");
  });
});

describe("ReconciliationController.list", () => {
  it("returns the paginated items, nextCursor, and totals shape from the service", async () => {
    const service = makeService({
      listExceptions: async () => ({
        items: [makeExceptionDto({ id: "exc-a" }), makeExceptionDto({ id: "exc-b" })],
        nextCursor: "exc-b",
        totals: { openCount: 2, openAmountKobo: 800000 }
      })
    });
    const controller = makeController(service);

    const result = await controller.list({ status: "OPEN", limit: 50 } as never);

    expect(service.listExceptions).toHaveBeenCalledWith({ status: "OPEN", limit: 50 });
    expect(result.items.map((i) => i.id)).toEqual(["exc-a", "exc-b"]);
    expect(result.nextCursor).toBe("exc-b");
    expect(result.totals).toEqual({ openCount: 2, openAmountKobo: 800000 });
  });
});
