import { Global, Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { AuthPersistenceModule } from "../persistence/auth-persistence.module";
import { TokenService } from "./token.service";

@Global()
@Module({
  imports: [JwtModule.register({}), AuthPersistenceModule],
  providers: [TokenService],
  exports: [TokenService]
})
export class TokenModule {}
