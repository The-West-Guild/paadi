import { Global, Module } from "@nestjs/common";
import { ApiKeyRepository } from "./api-key.repository";
import { AuthIdentityRepository } from "./auth-identity.repository";
import { DeviceRepository } from "./device.repository";
import { NotificationPreferenceRepository } from "./notification-preference.repository";
import { PayoutAccountRepository } from "./payout-account.repository";
import { ProfileRepository } from "./profile.repository";
import { SessionRepository } from "./session.repository";
import { UserRepository } from "./user.repository";

@Global()
@Module({
  providers: [
    UserRepository,
    ProfileRepository,
    SessionRepository,
    AuthIdentityRepository,
    DeviceRepository,
    PayoutAccountRepository,
    NotificationPreferenceRepository,
    ApiKeyRepository,
  ],
  exports: [
    UserRepository,
    ProfileRepository,
    SessionRepository,
    AuthIdentityRepository,
    DeviceRepository,
    PayoutAccountRepository,
    NotificationPreferenceRepository,
    ApiKeyRepository,
  ],
})
export class AuthPersistenceModule {}
