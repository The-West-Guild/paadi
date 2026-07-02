import { Module } from "@nestjs/common";
import { EmailController } from "./email.controller";
import { EmailVerificationService } from "./email-verification.service";

@Module({
  controllers: [EmailController],
  providers: [EmailVerificationService]
})
export class EmailModule {}
