import { Module } from "@nestjs/common";
import { AuthSessionController } from "./session/auth-session.controller";
import { AuthSessionService } from "./session/auth-session.service";
import { PinController } from "./pin/pin.controller";
import { PinService } from "./pin/pin.service";

@Module({
  controllers: [AuthSessionController, PinController],
  providers: [AuthSessionService, PinService],
  exports: [PinService]
})
export class AuthModule {}
