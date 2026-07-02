import { Injectable, UnauthorizedException } from "@nestjs/common";
import { GoogleClaims, GoogleVerifier } from "@paadi/domain";

@Injectable()
export class MockGoogleVerifier extends GoogleVerifier {
  async verify(idToken: string): Promise<GoogleClaims> {
    if (!idToken.startsWith("mock:")) {
      throw new UnauthorizedException("invalid google token");
    }
    const [, sub, email, verified] = idToken.split(":");
    return {
      sub,
      email,
      emailVerified: verified === "true"
    };
  }
}
