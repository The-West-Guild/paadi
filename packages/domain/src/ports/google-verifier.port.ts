export interface GoogleClaims {
  sub: string;
  email: string;
  emailVerified: boolean;
  name?: string;
  picture?: string;
}

export abstract class GoogleVerifier {
  abstract verify(idToken: string): Promise<GoogleClaims>;
}
