import { Module } from "@nestjs/common";
import { PersistenceModule } from "../../infra/persistence/persistence.module";
import { PrismaModule } from "../../infra/persistence/prisma.module";
import { ActivityController } from "./activity.controller";
import { ActivityFeedService } from "./activity-feed.service";

@Module({
  imports: [PersistenceModule, PrismaModule],
  controllers: [ActivityController],
  providers: [ActivityFeedService],
  exports: [ActivityFeedService]
})
export class ActivityModule {}
