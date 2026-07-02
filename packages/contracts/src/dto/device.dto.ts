import { z } from "zod";

export const registerDeviceSchema = z.object({
  deviceId: z.string().min(1),
  platform: z.enum(["IOS", "ANDROID", "WEB"]),
  pushToken: z.string().optional(),
  biometricEnabled: z.boolean().optional()
});

export const deviceBiometricSchema = z.object({
  biometricEnabled: z.boolean()
});

export type RegisterDeviceInput = z.infer<typeof registerDeviceSchema>;
export type DeviceBiometricInput = z.infer<typeof deviceBiometricSchema>;
