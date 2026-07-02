import { ConfigService } from "@nestjs/config";
import { $Enums, NotificationChannel, NotificationEvent } from "@paadi/db";
import { OutboxMessage, PushProvider } from "@paadi/domain";
import { CryptoService } from "../../common/crypto/crypto.service";
import { NotificationPreferenceRepository } from "../../infra/persistence/notification-preference.repository";
import { DuePot, NudgeRepository } from "../../infra/persistence/nudge.repository";
import { TwilioClient } from "../../integrations/twilio/twilio.client";
import { NudgesService } from "./nudges.service";

type NudgeKind = $Enums.NudgeKind;
const CREATED_DELAY: NudgeKind = "CREATED_DELAY";

function crypto(): CryptoService {
  return new CryptoService(new ConfigService({ nodeEnv: "test" }));
}

function split(overrides: Partial<DuePot["splits"][number]> = {}) {
  return {
    id: overrides.id ?? "split-1",
    label: overrides.label ?? "Tobi",
    shareKobo: overrides.shareKobo ?? 100000n,
    paidKobo: overrides.paidKobo ?? 0n,
    status: overrides.status ?? "PENDING",
    checkoutUrl: overrides.checkoutUrl ?? "https://checkout.example/pay/1",
    payerPhoneEnc: overrides.payerPhoneEnc ?? null,
  };
}

function pot(overrides: Partial<DuePot> = {}): DuePot {
  const enc = crypto().encryptPhone("+2348011112222");
  return {
    id: overrides.id ?? "pot-1",
    title: overrides.title ?? "Friday Pizza",
    createdAt: overrides.createdAt ?? new Date("2026-07-01T00:00:00.000Z"),
    deadlineAt: overrides.deadlineAt ?? new Date("2026-07-02T00:00:00.000Z"),
    creatorId: overrides.creatorId ?? "user-1",
    creator: overrides.creator ?? {
      id: "user-1",
      phoneEncrypted: enc,
      profile: { displayName: "Orga Niser", firstName: "Orga", username: "organizer" },
      devices: [{ pushToken: "push-token-1" }],
    },
    splits: overrides.splits ?? [split()],
  };
}

function makeHarness(options: {
  pots?: DuePot[];
  prefs?: { event: NotificationEvent; channel: NotificationChannel; enabled: boolean }[];
  splitNudged?: Set<string>;
} = {}) {
  const outboxEvents: OutboxMessage[] = [];
  const pushCalls: { token: string; payload: { title: string; body: string; data?: Record<string, string> } }[] = [];
  const smsCalls: { target: string; message: string }[] = [];
  const whatsappCalls: { target: string; message: string }[] = [];
  const markedPots: { potId: string; kind: NudgeKind; recipientCount: number }[] = [];
  const markedSplits: { splitId: string; kind: NudgeKind }[] = [];
  const splitNudged = options.splitNudged ?? new Set<string>();
  const cryptoSvc = crypto();

  const repo = {
    findPotsDueForCreatedDelay: jest.fn(async () => options.pots ?? []),
    findPotsDueForDeadlineWindow: jest.fn(async () => options.pots ?? []),
    markPotNudged: jest.fn(async (potId: string, kind: NudgeKind, recipientCount: number) => {
      markedPots.push({ potId, kind, recipientCount });
    }),
    markSplitNudged: jest.fn(async (splitId: string, kind: NudgeKind) => {
      markedSplits.push({ splitId, kind });
      splitNudged.add(splitId);
    }),
    wasSplitNudged: jest.fn(async (splitId: string) => splitNudged.has(splitId)),
  } as unknown as NudgeRepository;

  const outbox = {
    enqueue: jest.fn(async (message: OutboxMessage) => {
      outboxEvents.push(message);
    }),
  } as unknown as import("@paadi/domain").OutboxRepository;

  const push = {
    send: jest.fn(async (token: string, payload: { title: string; body: string; data?: Record<string, string> }) => {
      pushCalls.push({ token, payload });
      return { delivered: true };
    }),
  } as unknown as PushProvider;

  const twilio = {
    sendSms: jest.fn(async (target: string, message: string) => {
      smsCalls.push({ target, message });
      return { delivered: true };
    }),
    sendWhatsapp: jest.fn(async (target: string, message: string) => {
      whatsappCalls.push({ target, message });
      return { delivered: true };
    }),
  } as unknown as TwilioClient;

  const prefs = {
    listForUser: jest.fn(async () =>
      options.prefs ?? [
        { event: NotificationEvent.ORGANIZER_REMINDER, channel: NotificationChannel.PUSH, enabled: true },
        { event: NotificationEvent.ORGANIZER_REMINDER, channel: NotificationChannel.SMS, enabled: true },
        { event: NotificationEvent.ORGANIZER_REMINDER, channel: NotificationChannel.WHATSAPP, enabled: true },
      ]
    ),
  } as unknown as NotificationPreferenceRepository;

  const service = new NudgesService(repo, outbox, push, twilio, cryptoSvc, prefs);
  return { service, repo, outboxEvents, pushCalls, smsCalls, whatsappCalls, markedPots, markedSplits, cryptoSvc };
}

describe("NudgesService", () => {
  it("respects disabled organizer reminder channels and still enqueues the organizer outbox event", async () => {
    const harness = makeHarness({
      pots: [pot()],
      prefs: [
        { event: NotificationEvent.ORGANIZER_REMINDER, channel: NotificationChannel.PUSH, enabled: true },
        { event: NotificationEvent.ORGANIZER_REMINDER, channel: NotificationChannel.SMS, enabled: false },
        { event: NotificationEvent.ORGANIZER_REMINDER, channel: NotificationChannel.WHATSAPP, enabled: false },
      ],
    });

    const processed = await harness.service.sweepCreatedDelay(1000);

    expect(processed).toBe(1);
    expect(harness.pushCalls).toHaveLength(1);
    expect(harness.smsCalls).toHaveLength(0);
    expect(harness.whatsappCalls).toHaveLength(0);
    expect(harness.outboxEvents).toEqual([
      expect.objectContaining({ event: { type: "nudge.organizer_sent", potId: "pot-1", recipientCount: 1 } }),
    ]);
    expect(harness.markedPots).toEqual([{ potId: "pot-1", kind: CREATED_DELAY, recipientCount: 1 }]);
  });

  it("skips payer SMS when payerPhoneEnc is null and only processes uncached unpaid splits", async () => {
    const enc = crypto().encryptPhone("+2348013334444");
    const harness = makeHarness({
      pots: [
        pot({
          splits: [
            split({ id: "split-skip", payerPhoneEnc: null }),
            split({ id: "split-send", payerPhoneEnc: enc }),
          ],
        }),
      ],
      prefs: [
        { event: NotificationEvent.ORGANIZER_REMINDER, channel: NotificationChannel.PUSH, enabled: true },
        { event: NotificationEvent.ORGANIZER_REMINDER, channel: NotificationChannel.SMS, enabled: false },
        { event: NotificationEvent.ORGANIZER_REMINDER, channel: NotificationChannel.WHATSAPP, enabled: false },
      ],
    });

    await harness.service.sweepDeadlineWindow(1000);

    expect(harness.smsCalls).toHaveLength(1);
    expect(harness.smsCalls[0].target).toBe("+2348013334444");
    expect(harness.markedSplits.map((row) => row.splitId)).toEqual(["split-send"]);
    expect(harness.outboxEvents.map((row) => row.event.type)).toEqual(["nudge.organizer_sent", "nudge.payer_sent"]);
  });

  it("does not double-send a payer already nudged for the same trigger kind", async () => {
    const enc = crypto().encryptPhone("+2348015556666");
    const harness = makeHarness({
      pots: [
        pot({
          splits: [split({ id: "split-done", payerPhoneEnc: enc })],
        }),
      ],
      splitNudged: new Set(["split-done"]),
      prefs: [
        { event: NotificationEvent.ORGANIZER_REMINDER, channel: NotificationChannel.PUSH, enabled: true },
        { event: NotificationEvent.ORGANIZER_REMINDER, channel: NotificationChannel.SMS, enabled: false },
        { event: NotificationEvent.ORGANIZER_REMINDER, channel: NotificationChannel.WHATSAPP, enabled: false },
      ],
    });

    await harness.service.sweepCreatedDelay(1000);

    expect(harness.smsCalls).toHaveLength(0);
    expect(harness.markedSplits).toHaveLength(0);
  });
});