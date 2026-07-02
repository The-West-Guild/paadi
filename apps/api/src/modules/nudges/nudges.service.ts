import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { $Enums, NotificationChannel, NotificationEvent } from "@paadi/db";
import { OutboxMessage, OutboxRepository, PushProvider } from "@paadi/domain";
import { CryptoService } from "../../common/crypto/crypto.service";
import { NotificationPreferenceRepository } from "../../infra/persistence/notification-preference.repository";
import {
  DuePot,
  NudgeRepository,
} from "../../infra/persistence/nudge.repository";
import { TwilioClient } from "../../integrations/twilio/twilio.client";

const OUTBOX_TARGET = "user";
const UNPAID_STATUSES = new Set(["PENDING", "PARTIALLY_PAID"]);
type NudgeKind = $Enums.NudgeKind;
const NUDGE_CREATED_DELAY: NudgeKind = "CREATED_DELAY";
const NUDGE_DEADLINE_APPROACHING: NudgeKind = "DEADLINE_APPROACHING";

@Injectable()
export class NudgesService {
  constructor(
    private readonly nudges: NudgeRepository,
    @Inject(OutboxRepository) private readonly outbox: OutboxRepository,
    @Inject(PushProvider) private readonly pushProvider: PushProvider,
    private readonly twilio: TwilioClient,
    private readonly crypto: CryptoService,
    private readonly notificationPrefs: NotificationPreferenceRepository,
  ) {}

  async sweepCreatedDelay(delayMs: number): Promise<number> {
    return this.sweep(
      await this.nudges.findPotsDueForCreatedDelay(delayMs, 100),
      NUDGE_CREATED_DELAY,
    );
  }

  async sweepDeadlineWindow(windowMs: number): Promise<number> {
    return this.sweep(
      await this.nudges.findPotsDueForDeadlineWindow(windowMs, 100),
      NUDGE_DEADLINE_APPROACHING,
    );
  }

  private async sweep(pots: DuePot[], kind: NudgeKind): Promise<number> {
    let processed = 0;
    for (const pot of pots) {
      await this.nudgeOrganizer(pot);
      await this.nudgePayers(pot, kind);
      await this.nudges.markPotNudged(pot.id, kind, this.unpaidCount(pot));
      processed += 1;
    }
    return processed;
  }

  private async nudgeOrganizer(pot: DuePot): Promise<void> {
    const prefs = await this.notificationPrefs.listForUser(pot.creatorId);
    const enabled = new Set(
      prefs
        .filter(
          (pref) =>
            pref.event === NotificationEvent.ORGANIZER_REMINDER && pref.enabled,
        )
        .map((pref) => pref.channel),
    );
    const unpaidCount = this.unpaidCount(pot);
    const unpaidTotalKobo = this.unpaidTotalKobo(pot);
    const message = `${unpaidCount} of ${pot.splits.length} people still owe ${this.formatNaira(unpaidTotalKobo)} for '${pot.title}'`;

    if (enabled.has(NotificationChannel.PUSH)) {
      const token = pot.creator.devices.find(
        (device) => device.pushToken,
      )?.pushToken;
      if (token) {
        await this.pushProvider.send(token, {
          title: "Payment reminder",
          body: message,
        });
      }
    }
    if (enabled.has(NotificationChannel.SMS)) {
      await this.twilio.sendSms(
        this.crypto.decryptPhone(pot.creator.phoneEncrypted),
        message,
      );
    }
    if (enabled.has(NotificationChannel.WHATSAPP)) {
      await this.twilio.sendWhatsapp(
        this.crypto.decryptPhone(pot.creator.phoneEncrypted),
        message,
      );
    }

    await this.outbox.enqueue(this.organizerEvent(pot.id, unpaidCount));
  }

  private async nudgePayers(pot: DuePot, kind: NudgeKind): Promise<void> {
    for (const split of pot.splits) {
      if (!this.isUnpaidSplit(split.status)) {
        continue;
      }
      if (await this.nudges.wasSplitNudged(split.id, kind)) {
        continue;
      }
      if (split.payerPhoneEnc == null) {
        continue;
      }
      const phone = this.crypto.decryptPhone(split.payerPhoneEnc);
      const outstandingKobo = Number(split.shareKobo - split.paidKobo);
      const message = `Reminder: you still owe ${this.formatNaira(outstandingKobo)} for '${pot.title}'. Pay here: ${split.checkoutUrl ?? ""}`;
      await this.twilio.sendSms(phone, message);
      await this.nudges.markSplitNudged(split.id, kind);
      await this.outbox.enqueue(this.payerEvent(pot.id, split.id));
    }
  }

  private unpaidCount(pot: DuePot): number {
    return pot.splits.filter((split) => this.isUnpaidSplit(split.status))
      .length;
  }

  private unpaidTotalKobo(pot: DuePot): number {
    return pot.splits
      .filter((split) => this.isUnpaidSplit(split.status))
      .reduce(
        (sum, split) => sum + Number(split.shareKobo - split.paidKobo),
        0,
      );
  }

  private isUnpaidSplit(status: string): boolean {
    return UNPAID_STATUSES.has(status);
  }

  private formatNaira(kobo: number): string {
    return `₦${(kobo / 100).toLocaleString("en-NG", { maximumFractionDigits: 2 })}`;
  }

  private organizerEvent(potId: string, recipientCount: number): OutboxMessage {
    return {
      id: randomUUID(),
      target: OUTBOX_TARGET,
      event: { type: "nudge.organizer_sent", potId, recipientCount },
      attempts: 0,
    };
  }

  private payerEvent(potId: string, splitId: string): OutboxMessage {
    return {
      id: randomUUID(),
      target: OUTBOX_TARGET,
      event: { type: "nudge.payer_sent", potId, splitId },
      attempts: 0,
    };
  }
}
