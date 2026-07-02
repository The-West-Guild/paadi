import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { GoogleClaims, GoogleVerifier } from "@paadi/domain";
import { OAuth2Client } from "google-auth-library";

@Injectable()
export class GoogleRealVerifier extends GoogleVerifier {
  private readonly client = new OAuth2Client();

  constructor(private readonly config: ConfigService) {
    super();
  }

  async verify(idToken: string): Promise<GoogleClaims> {
    const audience = this.config.get<string[]>("google.clientIds") ?? [];
    if (audience.length === 0) {
      throw new UnauthorizedException("google client ids not configured");
    }
    const ticket = await this.client.verifyIdToken({ idToken, audience });
    const payload = ticket.getPayload();
    if (!payload || !payload.email) {
      throw new UnauthorizedException("invalid google token");
    }
    return {
      sub: payload.sub,
      email: payload.email,
      emailVerified: payload.email_verified ?? false,
      name: payload.name,
      picture: payload.picture
    };
  }
}
