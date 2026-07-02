import { createHmac } from "node:crypto";
import { PaadiEvent } from "@paadi/contracts";
import {
  OutboundDeliveryPayload,
  WebhookDeliveryPort,
  WebhookDeliveryResult,
  buildOutboundSigningString
} from "@paadi/domain";
import {
  PrismaService,
  WebhookDelivery,
  WebhookDeliveryStatus as DbWebhookDeliveryStatus,
  WebhookEndpoint
} from "@paadi/db";
import { WebhookEndpointRepository } from "../../infra/persistence/webhook-endpoint.repository";
import { WebhookDeliveryService, WebhookDeliveryTask } from "./webhook-delivery.service";

const ENDPOINT_SECRET = "whsec_delivery_test";

function makeEndpoint(overrides: Partial<WebhookEndpoint> = {}): WebhookEndpoint {
  return {
    id: overrides.id ?? "ep-1",
    userId: overrides.userId ?? "user-1",
    url: overrides.url ?? "https://tenant.example/hooks",
    secretHash: overrides.secretHash ?? "hash",
    secretEnc: overrides.secretEnc ?? "enc",
    description: overrides.description ?? null,
    events: overrides.events ?? ["wallet.credited"],
    status: overrides.status ?? "ACTIVE",
    createdAt: overrides.createdAt ?? new Date("2026-07-01T00:00:00.000Z"),
    updatedAt: overrides.updatedAt ?? new Date("2026-07-01T00:00:00.000Z")
  } as WebhookEndpoint;
}

function makeTask(overrides: Partial<WebhookDeliveryTask> = {}): WebhookDeliveryTask {
  const event: PaadiEvent = overrides.event ?? {
    type: "wallet.credited",
    userId: "user-1",
    amountKobo: 500000,
    nombaTransactionId: "ntx-1"
  };
  return {
    eventId: overrides.eventId ?? "evt-1",
    event,
    createdAt: overrides.createdAt ?? "2026-07-01T10:00:00.000Z"
  };
}

function makeDeliveryRow(overrides: Partial<WebhookDelivery> = {}): WebhookDelivery {
  return {
    id: overrides.id ?? "wd-1",
    endpointId: overrides.endpointId ?? "ep-1",
    eventId: overrides.eventId ?? "evt-1",
    eventType: overrides.eventType ?? "wallet.credited",
    payload:
      overrides.payload ??
      ({
        event: {
          type: "wallet.credited",
          userId: "user-1",
          amountKobo: 500000,
          nombaTransactionId: "ntx-1"
        },
        createdAt: "2026-07-01T10:00:00.000Z"
      } as unknown as WebhookDelivery["payload"]),
    status: overrides.status ?? DbWebhookDeliveryStatus.PENDING,
    attempts: overrides.attempts ?? 0,
    nextAttemptAt: overrides.nextAttemptAt ?? null,
    lastResponseCode: overrides.lastResponseCode ?? null,
    lastError: overrides.lastError ?? null,
    createdAt: overrides.createdAt ?? new Date("2026-07-01T10:00:00.000Z"),
    updatedAt: overrides.updatedAt ?? new Date("2026-07-01T10:00:00.000Z")
  } as WebhookDelivery;
}

interface UpdateCall {
  where: { id: string };
  data: Record<string, unknown>;
}

function makePrisma(seedRows: WebhookDelivery[] = []) {
  const rows = new Map<string, WebhookDelivery>(seedRows.map((row) => [row.id, { ...row }]));
  const creates: WebhookDelivery[] = [];
  const updates: UpdateCall[] = [];
  let seq = seedRows.length;

  const webhookDelivery = {
    findFirst: jest.fn(async (args: { where: { endpointId: string; eventId: string } }) => {
      for (const row of rows.values()) {
        if (row.endpointId === args.where.endpointId && row.eventId === args.where.eventId) {
          return { ...row };
        }
      }
      return null;
    }),
    findMany: jest.fn(
      async (args: {
        where: {
          status: DbWebhookDeliveryStatus;
          attempts: { lt: number };
          nextAttemptAt: { not: null; lte: Date };
        };
        orderBy?: { nextAttemptAt: "asc" | "desc" };
        take?: number;
      }) => {
        const matched = [...rows.values()].filter(
          (row) =>
            row.status === args.where.status &&
            row.attempts < args.where.attempts.lt &&
            row.nextAttemptAt !== null &&
            row.nextAttemptAt.getTime() <= args.where.nextAttemptAt.lte.getTime()
        );
        matched.sort(
          (a, b) => (a.nextAttemptAt as Date).getTime() - (b.nextAttemptAt as Date).getTime()
        );
        const ordered = args.orderBy?.nextAttemptAt === "desc" ? matched.reverse() : matched;
        const limited = args.take ? ordered.slice(0, args.take) : ordered;
        return limited.map((row) => ({ ...row }));
      }
    ),
    create: jest.fn(async (args: { data: Partial<WebhookDelivery> }) => {
      seq += 1;
      const row = makeDeliveryRow({ ...args.data, id: `wd-${seq}` });
      rows.set(row.id, row);
      creates.push(row);
      return { ...row };
    }),
    update: jest.fn(async (args: UpdateCall) => {
      updates.push(args);
      const current = rows.get(args.where.id);
      if (!current) {
        throw new Error(`delivery ${args.where.id} not seeded`);
      }
      const next: WebhookDelivery = { ...current };
      for (const [key, value] of Object.entries(args.data)) {
        if (value !== null && typeof value === "object" && "increment" in (value as object)) {
          const inc = (value as { increment: number }).increment;
          (next as unknown as Record<string, number>)[key] =
            (current as unknown as Record<string, number>)[key] + inc;
        } else {
          (next as unknown as Record<string, unknown>)[key] = value;
        }
      }
      rows.set(args.where.id, next);
      return { ...next };
    })
  };

  return { prisma: { webhookDelivery } as unknown as PrismaService, creates, updates, rows };
}

function makeEndpoints(endpoints: WebhookEndpoint[] = []) {
  const byId = new Map(endpoints.map((endpoint) => [endpoint.id, endpoint]));
  return {
    revealSecret: jest.fn(() => ENDPOINT_SECRET),
    findById: jest.fn(async (id: string) => byId.get(id) ?? null)
  } as unknown as WebhookEndpointRepository;
}

function makeTransport(behaviour: (url: string, body: string) => Promise<WebhookDeliveryResult>) {
  const calls: { url: string; headers: Record<string, string>; body: string }[] = [];
  const transport: WebhookDeliveryPort = {
    deliver: jest.fn(async (url: string, headers: Record<string, string>, body: string) => {
      calls.push({ url, headers, body });
      return behaviour(url, body);
    })
  };
  return { transport, calls };
}

function ok(statusCode: number): (url: string, body: string) => Promise<WebhookDeliveryResult> {
  return async () => ({ statusCode, ok: true });
}

function notOk(statusCode: number): (url: string, body: string) => Promise<WebhookDeliveryResult> {
  return async () => ({ statusCode, ok: false });
}

function boom(message: string): (url: string, body: string) => Promise<WebhookDeliveryResult> {
  return async () => {
    throw new Error(message);
  };
}

describe("WebhookDeliveryService", () => {
  it("marks DELIVERED and clears retry state on a 2xx response", async () => {
    const { prisma, updates } = makePrisma();
    const { transport, calls } = makeTransport(ok(200));
    const service = new WebhookDeliveryService(prisma, makeEndpoints(), transport);

    const result = await service.deliver(makeTask(), makeEndpoint());

    expect(result.status).toBe(DbWebhookDeliveryStatus.DELIVERED);
    expect(calls).toHaveLength(1);
    const marked = updates.at(-1);
    expect(marked?.data.status).toBe(DbWebhookDeliveryStatus.DELIVERED);
    expect(marked?.data.nextAttemptAt).toBeNull();
    expect(marked?.data.lastResponseCode).toBe(200);
    expect((marked?.data.attempts as { increment: number }).increment).toBe(1);
  });

  it("signs the delivery so the receiver can verify with the endpoint secret", async () => {
    const { prisma } = makePrisma();
    const { transport, calls } = makeTransport(ok(200));
    const service = new WebhookDeliveryService(prisma, makeEndpoints(), transport);
    const task = makeTask();

    await service.deliver(task, makeEndpoint());

    const sent = calls[0];
    const signature = sent.headers["paadi-signature"];
    const timestamp = sent.headers["paadi-timestamp"];
    expect(sent.headers["paadi-event-type"]).toBe("wallet.credited");
    expect(sent.headers["paadi-delivery-id"]).toBe(task.eventId);

    const payload: OutboundDeliveryPayload = {
      id: task.eventId,
      type: task.event.type,
      createdAt: task.createdAt,
      data: task.event as unknown as Record<string, unknown>
    };
    const expected = createHmac("sha256", ENDPOINT_SECRET)
      .update(buildOutboundSigningString(payload, timestamp))
      .digest("base64");
    expect(signature).toBe(expected);
    expect(sent.body).toBe(JSON.stringify(payload));
  });

  it("marks FAILED and schedules a future backoff on a 5xx response", async () => {
    const { prisma, updates } = makePrisma();
    const { transport } = makeTransport(notOk(500));
    const service = new WebhookDeliveryService(prisma, makeEndpoints(), transport);
    const before = Date.now();

    const result = await service.deliver(makeTask(), makeEndpoint());

    expect(result.status).toBe(DbWebhookDeliveryStatus.FAILED);
    const marked = updates.at(-1);
    expect(marked?.data.status).toBe(DbWebhookDeliveryStatus.FAILED);
    expect((marked?.data.attempts as { increment: number }).increment).toBe(1);
    expect((marked?.data.nextAttemptAt as Date).getTime()).toBeGreaterThan(before);
    expect(marked?.data.lastResponseCode).toBe(500);
  });

  it("marks FAILED with the error text and no status code on a transport timeout", async () => {
    const { prisma, updates } = makePrisma();
    const { transport } = makeTransport(boom("socket hang up"));
    const service = new WebhookDeliveryService(prisma, makeEndpoints(), transport);

    const result = await service.deliver(makeTask(), makeEndpoint());

    expect(result.status).toBe(DbWebhookDeliveryStatus.FAILED);
    const marked = updates.at(-1);
    expect(marked?.data.lastResponseCode).toBeNull();
    expect(marked?.data.lastError).toBe("socket hang up");
    expect(marked?.data.nextAttemptAt).not.toBeNull();
  });

  it("escalates to DEAD (no further backoff) once the attempt ceiling is reached", async () => {
    const { prisma, updates } = makePrisma([makeDeliveryRow({ attempts: 9 })]);
    const { transport } = makeTransport(notOk(503));
    const service = new WebhookDeliveryService(prisma, makeEndpoints(), transport);

    const result = await service.deliver(makeTask(), makeEndpoint());

    expect(result.status).toBe(DbWebhookDeliveryStatus.DEAD);
    const marked = updates.at(-1);
    expect(marked?.data.status).toBe(DbWebhookDeliveryStatus.DEAD);
    expect(marked?.data.nextAttemptAt).toBeNull();
  });

  it("is idempotent per (endpointId, eventId): re-uses the existing delivery row, never creating a duplicate", async () => {
    const { prisma, creates } = makePrisma([makeDeliveryRow({ id: "wd-existing", attempts: 1 })]);
    const findFirst = prisma.webhookDelivery.findFirst as jest.Mock;
    const create = prisma.webhookDelivery.create as jest.Mock;
    const { transport } = makeTransport(ok(200));
    const service = new WebhookDeliveryService(prisma, makeEndpoints(), transport);

    await service.deliver(makeTask(), makeEndpoint());

    expect(findFirst).toHaveBeenCalledWith({ where: { endpointId: "ep-1", eventId: "evt-1" } });
    expect(create).not.toHaveBeenCalled();
    expect(creates).toHaveLength(0);
  });

  it("short-circuits an already-DELIVERED delivery without re-sending (at-least-once, not at-least-twice)", async () => {
    const { prisma } = makePrisma([
      makeDeliveryRow({ status: DbWebhookDeliveryStatus.DELIVERED, attempts: 1 })
    ]);
    const { transport, calls } = makeTransport(ok(200));
    const service = new WebhookDeliveryService(prisma, makeEndpoints(), transport);

    const result = await service.deliver(makeTask(), makeEndpoint());

    expect(result.status).toBe(DbWebhookDeliveryStatus.DELIVERED);
    expect(calls).toHaveLength(0);
    expect(transport.deliver).not.toHaveBeenCalled();
  });

  it("does not re-send a dead-lettered delivery", async () => {
    const { prisma } = makePrisma([
      makeDeliveryRow({ status: DbWebhookDeliveryStatus.DEAD, attempts: 10 })
    ]);
    const { transport, calls } = makeTransport(ok(200));
    const service = new WebhookDeliveryService(prisma, makeEndpoints(), transport);

    const result = await service.deliver(makeTask(), makeEndpoint());

    expect(result.status).toBe(DbWebhookDeliveryStatus.DEAD);
    expect(calls).toHaveLength(0);
  });
});

describe("WebhookDeliveryService redrivePending (automatic sweep)", () => {
  const PAST = new Date("2026-07-01T09:00:00.000Z");
  const NOW = new Date("2026-07-01T12:00:00.000Z");
  const FUTURE = new Date("2026-07-01T15:00:00.000Z");

  it("re-attempts a FAILED delivery whose backoff window has elapsed, with no manual re-enqueue", async () => {
    const { prisma, updates } = makePrisma([
      makeDeliveryRow({ status: DbWebhookDeliveryStatus.FAILED, attempts: 1, nextAttemptAt: PAST })
    ]);
    const { transport, calls } = makeTransport(notOk(503));
    const service = new WebhookDeliveryService(
      prisma,
      makeEndpoints([makeEndpoint()]),
      transport
    );
    const before = Date.now();

    const redriven = await service.redrivePending(NOW);

    expect(redriven).toBe(1);
    expect(calls).toHaveLength(1);
    const marked = updates.at(-1);
    expect(marked?.data.status).toBe(DbWebhookDeliveryStatus.FAILED);
    expect((marked?.data.attempts as { increment: number }).increment).toBe(1);
    expect((marked?.data.nextAttemptAt as Date).getTime()).toBeGreaterThan(before);
  });

  it("re-signs and re-POSTs the stored payload so no original outbox row is needed", async () => {
    const { prisma } = makePrisma([
      makeDeliveryRow({ status: DbWebhookDeliveryStatus.FAILED, attempts: 1, nextAttemptAt: PAST })
    ]);
    const { transport, calls } = makeTransport(ok(200));
    const service = new WebhookDeliveryService(
      prisma,
      makeEndpoints([makeEndpoint()]),
      transport
    );

    await service.redrivePending(NOW);

    const sent = calls[0];
    const timestamp = sent.headers["paadi-timestamp"];
    const payload: OutboundDeliveryPayload = {
      id: "evt-1",
      type: "wallet.credited",
      createdAt: "2026-07-01T10:00:00.000Z",
      data: {
        type: "wallet.credited",
        userId: "user-1",
        amountKobo: 500000,
        nombaTransactionId: "ntx-1"
      }
    };
    const expected = createHmac("sha256", ENDPOINT_SECRET)
      .update(buildOutboundSigningString(payload, timestamp))
      .digest("base64");
    expect(sent.headers["paadi-signature"]).toBe(expected);
    expect(sent.headers["paadi-delivery-id"]).toBe("evt-1");
    expect(sent.body).toBe(JSON.stringify(payload));
  });

  it("marks a re-driven delivery DELIVERED on success and POSTs exactly once (no double-delivery)", async () => {
    const { prisma, updates } = makePrisma([
      makeDeliveryRow({ status: DbWebhookDeliveryStatus.FAILED, attempts: 2, nextAttemptAt: PAST })
    ]);
    const { transport, calls } = makeTransport(ok(200));
    const service = new WebhookDeliveryService(
      prisma,
      makeEndpoints([makeEndpoint()]),
      transport
    );

    const redriven = await service.redrivePending(NOW);

    expect(redriven).toBe(1);
    expect(calls).toHaveLength(1);
    const marked = updates.at(-1);
    expect(marked?.data.status).toBe(DbWebhookDeliveryStatus.DELIVERED);
    expect(marked?.data.nextAttemptAt).toBeNull();
    expect(marked?.data.lastResponseCode).toBe(200);
  });

  it("escalates a re-driven delivery to DEAD once the attempt ceiling is reached", async () => {
    const { prisma, updates } = makePrisma([
      makeDeliveryRow({ status: DbWebhookDeliveryStatus.FAILED, attempts: 9, nextAttemptAt: PAST })
    ]);
    const { transport, calls } = makeTransport(notOk(500));
    const service = new WebhookDeliveryService(
      prisma,
      makeEndpoints([makeEndpoint()]),
      transport
    );

    await service.redrivePending(NOW);

    expect(calls).toHaveLength(1);
    const marked = updates.at(-1);
    expect(marked?.data.status).toBe(DbWebhookDeliveryStatus.DEAD);
    expect(marked?.data.nextAttemptAt).toBeNull();
  });

  it("does not re-send a delivery whose backoff window has not yet elapsed", async () => {
    const { prisma, updates } = makePrisma([
      makeDeliveryRow({ status: DbWebhookDeliveryStatus.FAILED, attempts: 1, nextAttemptAt: FUTURE })
    ]);
    const { transport, calls } = makeTransport(ok(200));
    const service = new WebhookDeliveryService(
      prisma,
      makeEndpoints([makeEndpoint()]),
      transport
    );

    const redriven = await service.redrivePending(NOW);

    expect(redriven).toBe(0);
    expect(calls).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });

  it("does not re-send a delivery that has already reached the attempt ceiling", async () => {
    const { prisma } = makePrisma([
      makeDeliveryRow({ status: DbWebhookDeliveryStatus.FAILED, attempts: 10, nextAttemptAt: PAST })
    ]);
    const { transport, calls } = makeTransport(ok(200));
    const service = new WebhookDeliveryService(
      prisma,
      makeEndpoints([makeEndpoint()]),
      transport
    );

    const redriven = await service.redrivePending(NOW);

    expect(redriven).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it("skips a FAILED delivery whose endpoint has been deleted without throwing", async () => {
    const { prisma, updates } = makePrisma([
      makeDeliveryRow({ status: DbWebhookDeliveryStatus.FAILED, attempts: 1, nextAttemptAt: PAST })
    ]);
    const { transport, calls } = makeTransport(ok(200));
    const service = new WebhookDeliveryService(prisma, makeEndpoints([]), transport);

    const redriven = await service.redrivePending(NOW);

    expect(redriven).toBe(1);
    expect(calls).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });
});
