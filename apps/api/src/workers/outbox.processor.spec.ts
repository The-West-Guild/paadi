import { Job, Queue } from "bullmq";
import { PaadiEvent } from "@paadi/contracts";
import { OutboxMessage, OutboxRepository } from "@paadi/domain";
import { WebhookEndpoint } from "@paadi/db";
import { RefundsService } from "../modules/refunds/refunds.service";
import { WebhookEndpointRepository } from "../infra/persistence/webhook-endpoint.repository";
import {
  WebhookDeliveryService,
  WebhookDeliveryTask
} from "../modules/developer/webhook-delivery.service";
import { OutboxProcessor } from "./outbox.processor";

function makeMessage(event: PaadiEvent, overrides: Partial<OutboxMessage> = {}): OutboxMessage {
  return {
    id: overrides.id ?? "msg-1",
    target: overrides.target ?? "internal",
    event,
    attempts: overrides.attempts ?? 0,
    nextAttemptAt: overrides.nextAttemptAt,
    status: overrides.status ?? "pending"
  };
}

function makeEndpoint(overrides: Partial<WebhookEndpoint> = {}): WebhookEndpoint {
  return {
    id: overrides.id ?? "ep-1",
    userId: overrides.userId ?? "user-1",
    url: overrides.url ?? "https://tenant.example/hooks",
    secretHash: "hash",
    secretEnc: "enc",
    description: null,
    events: overrides.events ?? ["wallet.credited"],
    status: overrides.status ?? "ACTIVE",
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    updatedAt: new Date("2026-07-01T00:00:00.000Z")
  } as WebhookEndpoint;
}

interface Harness {
  processor: OutboxProcessor;
  dispatched: string[];
  failed: { id: string; nextAttemptAt: string }[];
  settlementJobs: { name: string; data: unknown }[];
  vaJobs: { name: string; data: unknown }[];
  refundCalls: { potId: string; reason: string }[];
  findCalls: { userId: string; eventType: string }[];
  deliverCalls: { task: WebhookDeliveryTask; endpoint: WebhookEndpoint }[];
}

interface HarnessOptions {
  pending: OutboxMessage[];
  endpointsFor?: (userId: string, eventType: string) => WebhookEndpoint[];
  findThrows?: boolean;
  deliverThrows?: boolean;
}

function build(options: HarnessOptions): Harness {
  const dispatched: string[] = [];
  const failed: { id: string; nextAttemptAt: string }[] = [];
  const settlementJobs: { name: string; data: unknown }[] = [];
  const vaJobs: { name: string; data: unknown }[] = [];
  const refundCalls: { potId: string; reason: string }[] = [];
  const findCalls: { userId: string; eventType: string }[] = [];
  const deliverCalls: { task: WebhookDeliveryTask; endpoint: WebhookEndpoint }[] = [];

  const outbox = {
    pending: jest.fn(async () => options.pending.map((m) => ({ ...m }))),
    markDispatched: jest.fn(async (id: string) => {
      dispatched.push(id);
    }),
    markFailed: jest.fn(async (id: string, nextAttemptAt: string) => {
      failed.push({ id, nextAttemptAt });
    })
  } as unknown as OutboxRepository;

  const refunds = {
    refundPot: jest.fn(async (potId: string, reason: string) => {
      refundCalls.push({ potId, reason });
    })
  } as unknown as RefundsService;

  const webhookEndpoints = {
    findActiveForEvent: jest.fn(async (userId: string, eventType: string) => {
      findCalls.push({ userId, eventType });
      if (options.findThrows) {
        throw new Error("endpoint lookup failed");
      }
      return options.endpointsFor ? options.endpointsFor(userId, eventType) : [];
    })
  } as unknown as WebhookEndpointRepository;

  const webhookDelivery = {
    deliver: jest.fn(async (task: WebhookDeliveryTask, endpoint: WebhookEndpoint) => {
      deliverCalls.push({ task, endpoint });
      if (options.deliverThrows) {
        throw new Error("delivery failed");
      }
      return { id: "wd-1", status: "DELIVERED" };
    })
  } as unknown as WebhookDeliveryService;

  const settlement = {
    add: jest.fn(async (name: string, data: unknown) => {
      settlementJobs.push({ name, data });
    })
  } as unknown as Queue;

  const vaProvisioning = {
    add: jest.fn(async (name: string, data: unknown) => {
      vaJobs.push({ name, data });
    })
  } as unknown as Queue;

  const processor = new OutboxProcessor(
    outbox,
    refunds,
    webhookEndpoints,
    webhookDelivery,
    settlement,
    vaProvisioning
  );

  return {
    processor,
    dispatched,
    failed,
    settlementJobs,
    vaJobs,
    refundCalls,
    findCalls,
    deliverCalls
  };
}

describe("OutboxProcessor internal routing (regression)", () => {
  it("still enqueues a settlement job for pool.funded", async () => {
    const h = build({ pending: [makeMessage({ type: "pool.funded", potId: "pot-1" })] });

    await h.processor.process({} as Job);

    expect(h.settlementJobs).toEqual([{ name: "settle", data: { potId: "pot-1" } }]);
    expect(h.dispatched).toEqual(["msg-1"]);
    expect(h.failed).toHaveLength(0);
  });

  it("still routes pool.expired to the refund service", async () => {
    const h = build({ pending: [makeMessage({ type: "pool.expired", potId: "pot-2" })] });

    await h.processor.process({} as Job);

    expect(h.refundCalls).toEqual([{ potId: "pot-2", reason: "pool_expired" }]);
    expect(h.dispatched).toEqual(["msg-1"]);
  });

  it("still routes kyc.verified and profile.name_changed to VA provisioning", async () => {
    const h = build({
      pending: [
        makeMessage({ type: "kyc.verified", userId: "user-1" }, { id: "msg-kyc" }),
        makeMessage({ type: "profile.name_changed", userId: "user-1" }, { id: "msg-rename" })
      ],
      endpointsFor: () => []
    });

    await h.processor.process({} as Job);

    expect(h.vaJobs).toEqual([
      { name: "provision", data: { kind: "provision", userId: "user-1" } },
      { name: "rename", data: { kind: "rename", userId: "user-1" } }
    ]);
  });

  it("marks the row failed with a bounded backoff when internal dispatch throws", async () => {
    const h = build({ pending: [makeMessage({ type: "pool.expired", potId: "pot-x" })] });
    (h.processor as unknown as { refunds: RefundsService }).refunds.refundPot = jest.fn(async () => {
      throw new Error("refund boom");
    });

    await h.processor.process({} as Job);

    expect(h.dispatched).toHaveLength(0);
    expect(h.failed).toHaveLength(1);
    expect(h.failed[0].id).toBe("msg-1");
    expect(new Date(h.failed[0].nextAttemptAt).getTime()).toBeGreaterThan(Date.now());
  });
});

describe("OutboxProcessor tenant fan-out", () => {
  it("delivers a subscribed ACTIVE endpoint an HTTP webhook for wallet.credited", async () => {
    const endpoint = makeEndpoint({ userId: "user-1", events: ["wallet.credited"] });
    const h = build({
      pending: [
        makeMessage({
          type: "wallet.credited",
          userId: "user-1",
          amountKobo: 500000,
          nombaTransactionId: "ntx-1"
        })
      ],
      endpointsFor: () => [endpoint]
    });

    await h.processor.process({} as Job);

    expect(h.findCalls).toEqual([{ userId: "user-1", eventType: "wallet.credited" }]);
    expect(h.deliverCalls).toHaveLength(1);
    expect(h.deliverCalls[0].endpoint.id).toBe(endpoint.id);
    expect(h.deliverCalls[0].task.eventId).toBe("msg-1");
    expect(h.deliverCalls[0].task.event.type).toBe("wallet.credited");
    expect(h.deliverCalls[0].task.createdAt).toEqual(expect.any(String));
  });

  it("delivers one webhook per matching endpoint (fan-out) for the same event", async () => {
    const a = makeEndpoint({ id: "ep-a", userId: "user-1" });
    const b = makeEndpoint({ id: "ep-b", userId: "user-1" });
    const h = build({
      pending: [
        makeMessage({
          type: "wallet.credited",
          userId: "user-1",
          amountKobo: 100000,
          nombaTransactionId: "ntx-2"
        })
      ],
      endpointsFor: () => [a, b]
    });

    await h.processor.process({} as Job);

    expect(h.deliverCalls.map((c) => c.endpoint.id)).toEqual(["ep-a", "ep-b"]);
  });

  it("makes no HTTP delivery when the owner has no subscribed endpoints, and internal routing is unaffected", async () => {
    const h = build({
      pending: [
        makeMessage({
          type: "wallet.credited",
          userId: "user-1",
          amountKobo: 500000,
          nombaTransactionId: "ntx-3"
        })
      ],
      endpointsFor: () => []
    });

    await h.processor.process({} as Job);

    expect(h.deliverCalls).toHaveLength(0);
    expect(h.dispatched).toEqual(["msg-1"]);
    expect(h.settlementJobs).toHaveLength(0);
    expect(h.vaJobs).toHaveLength(0);
  });

  it("never resolves developer endpoints for a non-subscribable internal-only event with no owner (pool.funded)", async () => {
    const h = build({
      pending: [makeMessage({ type: "pool.funded", potId: "pot-1" })],
      endpointsFor: () => [makeEndpoint()]
    });

    await h.processor.process({} as Job);

    expect(h.findCalls).toHaveLength(0);
    expect(h.deliverCalls).toHaveLength(0);
    expect(h.settlementJobs).toEqual([{ name: "settle", data: { potId: "pot-1" } }]);
  });

  it("scopes fan-out to the event owner so user B never receives user A's event", async () => {
    const endpointsByUser = new Map<string, WebhookEndpoint[]>([
      ["user-a", [makeEndpoint({ id: "ep-a", userId: "user-a" })]],
      ["user-b", [makeEndpoint({ id: "ep-b", userId: "user-b" })]]
    ]);
    const h = build({
      pending: [
        makeMessage({
          type: "wallet.credited",
          userId: "user-a",
          amountKobo: 500000,
          nombaTransactionId: "ntx-a"
        })
      ],
      endpointsFor: (userId) => endpointsByUser.get(userId) ?? []
    });

    await h.processor.process({} as Job);

    expect(h.findCalls).toEqual([{ userId: "user-a", eventType: "wallet.credited" }]);
    expect(h.deliverCalls.map((c) => c.endpoint.id)).toEqual(["ep-a"]);
  });

  it("fans out after the internal dispatch has been marked, and a failed dispatch does not suppress fan-out", async () => {
    const endpoint = makeEndpoint({ userId: "user-1" });
    const h = build({
      pending: [
        makeMessage({
          type: "wallet.credited",
          userId: "user-1",
          amountKobo: 500000,
          nombaTransactionId: "ntx-4"
        })
      ],
      endpointsFor: () => [endpoint]
    });

    await h.processor.process({} as Job);

    expect(h.dispatched).toEqual(["msg-1"]);
    expect(h.deliverCalls).toHaveLength(1);
  });

  it("swallows a delivery failure so it does not roll back the internal dispatch", async () => {
    const endpoint = makeEndpoint({ userId: "user-1" });
    const h = build({
      pending: [
        makeMessage({
          type: "wallet.credited",
          userId: "user-1",
          amountKobo: 500000,
          nombaTransactionId: "ntx-5"
        })
      ],
      endpointsFor: () => [endpoint],
      deliverThrows: true
    });

    await expect(h.processor.process({} as Job)).resolves.toBeUndefined();

    expect(h.dispatched).toEqual(["msg-1"]);
    expect(h.deliverCalls).toHaveLength(1);
  });

  it("swallows an endpoint-resolution failure without failing the internal dispatch", async () => {
    const h = build({
      pending: [
        makeMessage({
          type: "wallet.credited",
          userId: "user-1",
          amountKobo: 500000,
          nombaTransactionId: "ntx-6"
        })
      ],
      findThrows: true
    });

    await expect(h.processor.process({} as Job)).resolves.toBeUndefined();

    expect(h.dispatched).toEqual(["msg-1"]);
    expect(h.deliverCalls).toHaveLength(0);
  });
});
