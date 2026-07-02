import { Injectable } from "@nestjs/common";
import type { NotificationPreferenceInput } from "@paadi/contracts";
import { NotificationChannel, NotificationEvent } from "@paadi/db";
import { NotificationPreferenceRepository } from "../../../infra/persistence/notification-preference.repository";

@Injectable()
export class NotificationPrefsService {
  constructor(private readonly repo: NotificationPreferenceRepository) {}

  async list(userId: string) {
    return { preferences: await this.repo.listForUser(userId) };
  }

  async update(userId: string, preferences: NotificationPreferenceInput[]) {
    await this.repo.upsertMany(
      userId,
      preferences.map((preference) => ({
        event: preference.event as NotificationEvent,
        channel: preference.channel as NotificationChannel,
        enabled: preference.enabled
      }))
    );
    return this.list(userId);
  }
}
