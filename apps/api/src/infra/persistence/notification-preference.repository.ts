import { Injectable } from "@nestjs/common";
import {
  NotificationChannel,
  NotificationEvent,
  PrismaService,
} from "@paadi/db";

interface NotificationPreferenceItem {
  event: NotificationEvent;
  channel: NotificationChannel;
  enabled: boolean;
}

@Injectable()
export class NotificationPreferenceRepository {
  constructor(private readonly prisma: PrismaService) {}

  listForUser(userId: string) {
    return this.prisma.notificationPreference.findMany({ where: { userId } });
  }

  upsertMany(userId: string, items: NotificationPreferenceItem[]) {
    return this.prisma.$transaction(
      items.map((item) =>
        this.prisma.notificationPreference.upsert({
          where: {
            userId_event_channel: {
              userId,
              event: item.event,
              channel: item.channel,
            },
          },
          create: {
            userId,
            event: item.event,
            channel: item.channel,
            enabled: item.enabled,
          },
          update: { enabled: item.enabled },
        }),
      ),
    );
  }

  seedDefaults(userId: string, items: NotificationPreferenceItem[]) {
    return this.prisma.notificationPreference.createMany({
      data: items.map((item) => ({
        userId,
        event: item.event,
        channel: item.channel,
        enabled: item.enabled,
      })),
      skipDuplicates: true,
    });
  }
}
