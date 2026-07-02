import { Module } from "@nestjs/common";
import { DeviceController } from "./devices/device.controller";
import { DeviceService } from "./devices/device.service";
import { NotificationPrefsController } from "./notifications/notification-prefs.controller";
import { NotificationPrefsService } from "./notifications/notification-prefs.service";

@Module({
  controllers: [DeviceController, NotificationPrefsController],
  providers: [DeviceService, NotificationPrefsService]
})
export class AccountPrefsModule {}
