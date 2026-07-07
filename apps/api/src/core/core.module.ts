import { Global, Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_FILTER, APP_INTERCEPTOR } from "@nestjs/core";
import { AllExceptionsFilter } from "../common/filters/all-exceptions.filter";
import { LoggingInterceptor } from "../common/interceptors/logging.interceptor";
import { configuration } from "./config/configuration";

// Rate limiting lives in AppModule's guard chain (RateLimitGuard) so it runs
// after authentication and can key on the resolved principal.
@Global()
@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, load: [configuration] })],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor }
  ]
})
export class CoreModule {}
