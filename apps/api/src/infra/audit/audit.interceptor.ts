import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Observable, tap } from "rxjs";
import type { AccessClaims } from "../auth/token.service";
import { AUDITED_EVENT } from "./audited.decorator";
import { AuditService } from "./audit.service";

/**
 * Records an AuditEvent after a successful @Audited() route call made by an
 * API-key principal. The payload carries call metadata only — never the
 * request body (wallet routes carry PINs) and never key material.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const eventType = this.reflector.getAllAndOverride<string | undefined>(AUDITED_EVENT, [
      context.getHandler(),
      context.getClass()
    ]);
    if (!eventType) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest();
    const claims = request.user as AccessClaims | undefined;
    if (!claims || claims.via !== "apikey") {
      return next.handle();
    }

    return next.handle().pipe(
      tap(() => {
        void this.audit.recordSafe({
          eventType,
          actorId: claims.sub,
          targetId: request.params?.id ?? request.body?.potId,
          payload: {
            apiKeyId: claims.apiKeyId,
            method: request.method,
            path: request.url
          }
        });
      })
    );
  }
}
