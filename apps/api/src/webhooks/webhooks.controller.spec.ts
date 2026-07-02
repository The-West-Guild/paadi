import { BadRequestException } from "@nestjs/common";
import { PrismaService, Prisma } from "@paadi/db";
import { KycService } from "../modules/auth/kyc/kyc.service";
import { Queue } from "bullmq";
import { WebhooksController } from "./webhooks.controller";
import { NombaWebhookBody } from "./nomba-webhook.types";

function p2002(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("duplicate", {
    code: "P2002",
    clientVersion: "test"
  });
}

function makeQueue() {
  return {
    add: jest.fn(async () => ({ id: "job-1" }))
  };
}

function makePrisma(createImpl: jest.Mock) {
  return {
    webhookEventIn: {
      create: createImpl
    }
  };
}

function buildController(opts: { create: jest.Mock; queue?: ReturnType<typeof makeQueue> }) {
  const queue = opts.queue ?? makeQueue();
  const prisma = makePrisma(opts.create);
  const kyc = {} as KycService;
  const controller = new WebhooksController(
    queue as unknown as Queue,
    prisma as unknown as PrismaService,
    kyc
  );
  return { controller, queue, prisma };
}

function body(overrides: Partial<NombaWebhookBody> = {}): NombaWebhookBody {
  return {
    event_type: "payment_success",
    requestId: "req-1",
    data: {
      transaction: { transactionId: "txn-1", type: "online_checkout" }
    },
    ...overrides
  };
}

describe("WebhooksController.handle (nomba)", () => {
  it("derives providerEventId from requestId, records the event, enqueues, and fast-acks", async () => {
    const create = jest.fn(async (_args: { data: { providerEventId: string } }) => ({ id: "evt-1" }));
    const { controller, queue } = buildController({ create });

    const result = await controller.handle(body());

    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0].data.providerEventId).toBe("req-1");
    expect(queue.add).toHaveBeenCalledWith("ingest", { webhookEventInId: "evt-1" });
    expect(result).toEqual({ received: true });
  });

  it("falls back to transaction.transactionId when requestId is absent", async () => {
    const create = jest.fn(async (_args: { data: { providerEventId: string } }) => ({ id: "evt-2" }));
    const { controller } = buildController({ create });
    const b = body();
    delete b.requestId;

    await controller.handle(b);

    expect(create.mock.calls[0][0].data.providerEventId).toBe("txn-1");
  });

  it("throws 400 when neither requestId nor transactionId is present", async () => {
    const create = jest.fn();
    const { controller, queue } = buildController({ create });
    const b: NombaWebhookBody = { event_type: "payment_success", data: { transaction: {} } };

    await expect(controller.handle(b)).rejects.toThrow(BadRequestException);
    expect(create).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it("treats a duplicate WebhookEventIn (P2002) as a 200 no-op without enqueue", async () => {
    const create = jest.fn(async () => {
      throw p2002();
    });
    const { controller, queue } = buildController({ create });

    const result = await controller.handle(body());

    expect(result).toEqual({ received: true });
    expect(queue.add).not.toHaveBeenCalled();
  });

  it("still acks 200 when enqueue fails after the row is recorded", async () => {
    const create = jest.fn(async () => ({ id: "evt-3" }));
    const queue = makeQueue();
    queue.add.mockRejectedValueOnce(new Error("redis down"));
    const { controller } = buildController({ create, queue });

    const result = await controller.handle(body());

    expect(result).toEqual({ received: true });
    expect(queue.add).toHaveBeenCalledTimes(1);
  });

  it("rethrows non-P2002 persistence errors", async () => {
    const create = jest.fn(async () => {
      throw new Error("connection reset");
    });
    const { controller } = buildController({ create });

    await expect(controller.handle(body())).rejects.toThrow("connection reset");
  });
});
