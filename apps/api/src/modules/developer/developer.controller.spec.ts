import { NotFoundException } from "@nestjs/common";
import type {
  RegisterWebhookEndpointInput,
  WebhookEndpointCreatedDto,
  WebhookEndpointDto,
  WebhookEndpointsResponse
} from "@paadi/contracts";
import { webhookEndpointCreatedSchema, webhookEndpointsResponseSchema } from "@paadi/contracts";
import { PrismaService, WebhookEndpoint } from "@paadi/db";
import type { AccessClaims } from "../../infra/auth/token.service";
import { WebhookEndpointRepository } from "../../infra/persistence/webhook-endpoint.repository";
import { DeveloperController } from "./developer.controller";
import { DeveloperService } from "./developer.service";

const SECRET = "whsec_returned_once";

function claimsFor(sub: string): AccessClaims {
  return { sub, sid: "sid-1", tier: "TIER_1" } as AccessClaims;
}

function makeEndpointRow(overrides: Partial<WebhookEndpoint> = {}): WebhookEndpoint {
  return {
    id: overrides.id ?? "ep-1",
    userId: overrides.userId ?? "user-1",
    url: overrides.url ?? "https://tenant.example/hooks",
    secretHash: "hash",
    secretEnc: "enc",
    description: overrides.description ?? null,
    events: overrides.events ?? ["wallet.credited"],
    status: overrides.status ?? "ACTIVE",
    createdAt: overrides.createdAt ?? new Date("2026-07-01T00:00:00.000Z"),
    updatedAt: overrides.updatedAt ?? new Date("2026-07-01T00:00:00.000Z")
  } as WebhookEndpoint;
}

interface RepoOptions {
  rows?: WebhookEndpoint[];
}

function makeRepo(options: RepoOptions = {}) {
  const rows = new Map<string, WebhookEndpoint>((options.rows ?? []).map((r) => [r.id, r]));
  return {
    register: jest.fn(async (input: { userId: string; url: string; events: string[] }) => {
      const endpoint = makeEndpointRow({
        id: `ep-${rows.size + 1}`,
        userId: input.userId,
        url: input.url,
        events: input.events
      });
      rows.set(endpoint.id, endpoint);
      return { endpoint, secret: SECRET };
    }),
    listForUser: jest.fn(async (userId: string) =>
      [...rows.values()].filter((r) => r.userId === userId)
    ),
    findById: jest.fn(async (id: string) => rows.get(id) ?? null),
    disable: jest.fn(async (id: string) => {
      const row = makeEndpointRow({ ...rows.get(id), id, status: "DISABLED" });
      rows.set(id, row);
      return row;
    })
  } as unknown as WebhookEndpointRepository;
}

function makePrisma() {
  return {
    webhookDelivery: {
      findMany: jest.fn(async () => [])
    }
  } as unknown as PrismaService;
}

function build(options: RepoOptions = {}) {
  const repo = makeRepo(options);
  const prisma = makePrisma();
  const service = new DeveloperService(repo, prisma);
  const controller = new DeveloperController(service);
  return { controller, service, repo };
}

describe("DeveloperController.register", () => {
  it("returns the signing secret exactly once on create", async () => {
    const { controller } = build();

    const created: WebhookEndpointCreatedDto = await controller.register(claimsFor("user-1"), {
      url: "https://tenant.example/hooks",
      events: ["wallet.credited"]
    } as RegisterWebhookEndpointInput);

    expect(created.secret).toBe(SECRET);
    expect(webhookEndpointCreatedSchema.parse(created).secret).toBe(SECRET);
  });

  it("forwards the authenticated user id to the service, never a client-supplied owner", async () => {
    const { controller, repo } = build();

    await controller.register(claimsFor("user-1"), {
      url: "https://tenant.example/hooks",
      events: ["wallet.credited"]
    } as RegisterWebhookEndpointInput);

    expect(repo.register).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1", url: "https://tenant.example/hooks" })
    );
  });
});

describe("DeveloperController.list", () => {
  it("redacts the secret from every listed endpoint", async () => {
    const { controller } = build({
      rows: [
        makeEndpointRow({ id: "ep-1", userId: "user-1" }),
        makeEndpointRow({ id: "ep-2", userId: "user-1", events: ["wallet.debited"] })
      ]
    });

    const response: WebhookEndpointsResponse = await controller.list(claimsFor("user-1"));

    expect(response.endpoints).toHaveLength(2);
    for (const endpoint of response.endpoints) {
      expect(endpoint).not.toHaveProperty("secret");
      expect(endpoint).not.toHaveProperty("secretEnc");
      expect(endpoint).not.toHaveProperty("secretHash");
    }
    expect(() => webhookEndpointsResponseSchema.parse(response)).not.toThrow();
  });

  it("returns only the caller's own endpoints", async () => {
    const { controller } = build({
      rows: [
        makeEndpointRow({ id: "ep-mine", userId: "user-1" }),
        makeEndpointRow({ id: "ep-theirs", userId: "user-2" })
      ]
    });

    const response = await controller.list(claimsFor("user-1"));

    expect(response.endpoints.map((e) => e.id)).toEqual(["ep-mine"]);
  });
});

describe("DeveloperController cross-user access (no IDOR)", () => {
  it("returns 404 when disabling an endpoint owned by another user", async () => {
    const { controller, repo } = build({ rows: [makeEndpointRow({ id: "ep-1", userId: "owner" })] });

    await expect(
      controller.remove(claimsFor("attacker"), { id: "ep-1" })
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(repo.disable).not.toHaveBeenCalled();
  });

  it("returns 404 when reading deliveries for an endpoint owned by another user", async () => {
    const { controller } = build({ rows: [makeEndpointRow({ id: "ep-1", userId: "owner" })] });

    await expect(
      controller.deliveries(claimsFor("attacker"), { id: "ep-1" })
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("returns 404 for an unknown endpoint id rather than leaking existence", async () => {
    const { controller } = build();

    await expect(
      controller.remove(claimsFor("user-1"), { id: "does-not-exist" })
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("lets the owner disable their own endpoint", async () => {
    const { controller } = build({ rows: [makeEndpointRow({ id: "ep-1", userId: "user-1" })] });

    const disabled: WebhookEndpointDto = await controller.remove(claimsFor("user-1"), { id: "ep-1" });

    expect(disabled.status).toBe("DISABLED");
    expect(disabled).not.toHaveProperty("secret");
  });
});
