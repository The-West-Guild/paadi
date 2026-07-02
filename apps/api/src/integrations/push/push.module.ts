import { Module } from "@nestjs/common";
import { PushProvider } from "@paadi/domain";
import { ConsolePushProvider } from "./console-push.provider";

@Module({
  providers: [
    {
      provide: PushProvider,
      useClass: ConsolePushProvider,
    },
  ],
  exports: [PushProvider],
})
export class PushModule {}