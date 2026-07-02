import { Injectable } from "@nestjs/common";
import { DevicePlatform, PrismaService, UserDevice } from "@paadi/db";

interface UpsertDeviceInput {
  platform: DevicePlatform;
  pushToken?: string;
  biometricEnabled?: boolean;
}

@Injectable()
export class DeviceRepository {
  constructor(private readonly prisma: PrismaService) {}

  upsert(
    userId: string,
    deviceId: string,
    data: UpsertDeviceInput,
  ): Promise<UserDevice> {
    return this.prisma.userDevice.upsert({
      where: { userId_deviceId: { userId, deviceId } },
      create: {
        userId,
        deviceId,
        platform: data.platform,
        pushToken: data.pushToken,
        biometricEnabled: data.biometricEnabled,
      },
      update: {
        platform: data.platform,
        pushToken: data.pushToken,
        biometricEnabled: data.biometricEnabled,
      },
    });
  }

  setBiometric(
    userId: string,
    deviceId: string,
    enabled: boolean,
  ): Promise<UserDevice> {
    return this.prisma.userDevice.update({
      where: { userId_deviceId: { userId, deviceId } },
      data: { biometricEnabled: enabled },
    });
  }

  clearPushToken(id: string): Promise<UserDevice> {
    return this.prisma.userDevice.update({
      where: { id },
      data: { pushToken: null },
    });
  }

  listForUser(userId: string) {
    return this.prisma.userDevice.findMany({ where: { userId } });
  }

  async isKnownDevice(userId: string, deviceId: string): Promise<boolean> {
    const count = await this.prisma.userDevice.count({
      where: { userId, deviceId },
    });
    return count > 0;
  }
}
