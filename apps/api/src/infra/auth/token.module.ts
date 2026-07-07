import { Global, Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { AuthPersistenceModule } from "../persistence/auth-persistence.module";
import { ApiKeyAuthService } from "./api-key-auth.service";
import { TokenService } from "./token.service";

@Global()
@Module({
  imports: [JwtModule.register({}), AuthPersistenceModule],
  providers: [TokenService, ApiKeyAuthService],
  exports: [TokenService, ApiKeyAuthService]
})
export class TokenModule {}
