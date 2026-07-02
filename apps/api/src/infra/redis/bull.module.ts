import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";

@Module({
  imports: [
    BullModule.forRootAsync({
      useFactory: () => {
        const url = new URL(process.env.REDIS_URL ?? "redis://localhost:6379");
        return {
          connection: {
            host: url.hostname,
            port: Number(url.port || 6379)
          }
        };
      }
    })
  ],
  exports: [BullModule]
})
export class RedisBullModule {}
