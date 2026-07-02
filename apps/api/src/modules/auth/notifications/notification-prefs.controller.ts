import { Body, Controller, Get, Put } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import {
  notificationPrefsResponseSchema,
  updateNotificationPrefsSchema,
  type UpdateNotificationPrefsInput
} from "@paadi/contracts";
import { CurrentUser } from "../../../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../../../common/pipes/zod-validation.pipe";
import { ApiZod, ApiZodResponse } from "../../../common/swagger/zod-api";
import type { AccessClaims } from "../../../infra/auth/token.service";
import { NotificationPrefsService } from "./notification-prefs.service";

@ApiTags("notifications")
@ApiBearerAuth()
@Controller("me/notification-preferences")
export class NotificationPrefsController {
  constructor(private readonly prefs: NotificationPrefsService) {}

  @Get("")
  @ApiZodResponse(200, notificationPrefsResponseSchema)
  list(@CurrentUser() claims: AccessClaims) {
    return this.prefs.list(claims.sub);
  }

  @Put("")
  @ApiZod({ body: updateNotificationPrefsSchema, response: notificationPrefsResponseSchema, status: 200 })
  update(@CurrentUser() claims: AccessClaims, @Body(new ZodValidationPipe(updateNotificationPrefsSchema)) body: UpdateNotificationPrefsInput) {
    return this.prefs.update(claims.sub, body.preferences);
  }
}
