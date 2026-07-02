import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { computeNombaSignature, safeEqual } from "../common/crypto/hmac";

interface NombaWebhookSignatureFields {
  event_type?: string;
  requestId?: string;
  data?: {
    merchant?: { userId?: string; walletId?: string };
    transaction?: { transactionId?: string; type?: string; time?: string; responseCode?: string };
  };
}

@Injectable()
export class NombaSignatureGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const provided = request.headers["nomba-signature"] as string | undefined;
    const timestamp = request.headers["nomba-timestamp"] as string | undefined;
    if (!provided || !timestamp) {
      throw new UnauthorizedException("missing signature");
    }
    const secret = this.config.get<string>("nomba.webhookSigningKey") ?? "";
    if (secret.length === 0) {
      throw new UnauthorizedException("nomba webhook signing key not configured");
    }
    const body = this.parseBody(request);
    const responseCode = body.data?.transaction?.responseCode;
    const signingString = [
      body.event_type ?? "",
      body.requestId ?? "",
      body.data?.merchant?.userId ?? "",
      body.data?.merchant?.walletId ?? "",
      body.data?.transaction?.transactionId ?? "",
      body.data?.transaction?.type ?? "",
      body.data?.transaction?.time ?? "",
      responseCode === "null" || responseCode === undefined ? "" : responseCode,
      timestamp
    ].join(":");
    const expected = computeNombaSignature(signingString, secret);
    if (!safeEqual(provided.toLowerCase(), expected.toLowerCase())) {
      throw new UnauthorizedException("invalid signature");
    }
    return true;
  }

  private parseBody(request: { rawBody?: Buffer; body?: unknown }): NombaWebhookSignatureFields {
    try {
      if (request.rawBody) {
        return JSON.parse(request.rawBody.toString("utf8")) as NombaWebhookSignatureFields;
      }
      if (request.body !== undefined && request.body !== null) {
        return request.body as NombaWebhookSignatureFields;
      }
    } catch {
      throw new UnauthorizedException("invalid signature");
    }
    throw new UnauthorizedException("missing raw body");
  }
}
