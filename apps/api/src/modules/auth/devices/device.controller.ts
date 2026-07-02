import { Body, Controller, Param, Post, Put } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import {
  deviceBiometricSchema,
  registerDeviceSchema,
  type DeviceBiometricInput,
  type RegisterDeviceInput
} from "@paadi/contracts";
import { CurrentUser } from "../../../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../../../common/pipes/zod-validation.pipe";
import { ApiZod } from "../../../common/swagger/zod-api";
import type { AccessClaims } from "../../../infra/auth/token.service";
import { DeviceService } from "./device.service";

@ApiTags("devices")
@ApiBearerAuth()
@Controller("me/devices")
export class DeviceController {
  constructor(private readonly devices: DeviceService) {}

  @Post("")
  @ApiZod({ body: registerDeviceSchema, status: 201 })
  register(@CurrentUser() claims: AccessClaims, @Body(new ZodValidationPipe(registerDeviceSchema)) body: RegisterDeviceInput) {
    return this.devices.register(claims.sub, body);
  }

  @Put(":id/biometric")
  @ApiZod({ body: deviceBiometricSchema, status: 200 })
  setBiometric(
    @CurrentUser() claims: AccessClaims,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(deviceBiometricSchema)) body: DeviceBiometricInput
  ) {
    return this.devices.setBiometric(claims.sub, id, body.biometricEnabled);
  }
}
