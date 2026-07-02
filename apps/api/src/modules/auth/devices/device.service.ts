import { Injectable } from "@nestjs/common";
import type { RegisterDeviceInput } from "@paadi/contracts";
import { DeviceRepository } from "../../../infra/persistence/device.repository";

@Injectable()
export class DeviceService {
  constructor(private readonly deviceRepo: DeviceRepository) {}

  register(userId: string, dto: RegisterDeviceInput) {
    return this.deviceRepo.upsert(userId, dto.deviceId, {
      platform: dto.platform,
      pushToken: dto.pushToken,
      biometricEnabled: dto.biometricEnabled
    });
  }

  setBiometric(userId: string, deviceId: string, enabled: boolean) {
    return this.deviceRepo.setBiometric(userId, deviceId, enabled);
  }

  list(userId: string) {
    return this.deviceRepo.listForUser(userId);
  }
}
