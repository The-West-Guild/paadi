import { HttpException, HttpStatus } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NombaClient } from "./nomba.client";

interface FetchCall {
  url: string;
  init: { method: string; headers: Record<string, string>; body?: string };
}

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body
  } as unknown as Response;
}

function freshExpiry(): string {
  return new Date(Date.now() + 30 * 60 * 1000).toISOString();
}

function buildClient() {
  const config = new ConfigService({
    nomba: {
      baseUrl: "https://api.test",
      clientId: "client-id",
      clientSecret: "client-secret",
      accountId: "acct-1",
      checkoutCallbackUrl: "https://paadi.test/cb",
      checkoutEmail: "pay@paadi.test"
    }
  });
  return new NombaClient(config);
}

describe("NombaClient", () => {
  const realFetch = global.fetch;
  let issueCount: number;
  let business: jest.Mock<Promise<Response>, [string, FetchCall["init"]]>;
  let calls: FetchCall[];
  let tokenExpiry: () => string;

  beforeEach(() => {
    issueCount = 0;
    calls = [];
    tokenExpiry = freshExpiry;
    business = jest.fn(async (_url: string, _init: FetchCall["init"]) => jsonResponse({ code: "00", data: {} }));
    global.fetch = jest.fn(async (url: unknown, init: unknown) => {
      const u = String(url);
      const typedInit = init as FetchCall["init"];
      calls.push({ url: u, init: typedInit });
      if (u.includes("/v1/auth/token/issue")) {
        issueCount++;
        return jsonResponse({
          code: "00",
          data: { access_token: `tok-${issueCount}`, expiresAt: tokenExpiry() }
        });
      }
      return business(u, typedInit);
    }) as never;
  });

  afterAll(() => {
    global.fetch = realFetch;
  });

  it("issues a token once and reuses the cached token across calls", async () => {
    const client = buildClient();
    business.mockResolvedValue(jsonResponse({ code: "00", data: [] }));

    await client.listBanks();
    await client.listBanks();

    expect(issueCount).toBe(1);
  });

  it("issues exactly one token under a concurrent stampede", async () => {
    const client = buildClient();
    business.mockResolvedValue(jsonResponse({ code: "00", data: [] }));

    await Promise.all([
      client.listBanks(),
      client.listBanks(),
      client.listBanks(),
      client.listBanks(),
      client.listBanks()
    ]);

    expect(issueCount).toBe(1);
  });

  it("re-issues a token once the cached token is stale", async () => {
    const client = buildClient();
    tokenExpiry = () => new Date(Date.now()).toISOString();
    business.mockResolvedValue(jsonResponse({ code: "00", data: [] }));

    await client.listBanks();
    await client.listBanks();

    expect(issueCount).toBe(2);
  });

  it("caches with the fallback lifetime when expiresAt is unparseable", async () => {
    const client = buildClient();
    tokenExpiry = () => "not-a-date";
    business.mockResolvedValue(jsonResponse({ code: "00", data: [] }));

    await client.listBanks();
    await client.listBanks();

    expect(issueCount).toBe(1);
  });

  it("attaches Authorization and accountId headers to every business call", async () => {
    const client = buildClient();
    business.mockResolvedValue(jsonResponse({ code: "00", data: [] }));

    await client.listBanks();

    const businessCall = calls.find((call) => call.url.includes("/v1/transfers/banks"))!;
    expect(businessCall.init.headers.Authorization).toBe("Bearer tok-1");
    expect(businessCall.init.headers.accountId).toBe("acct-1");
  });

  it("maps a code 00 response to the result payload", async () => {
    const client = buildClient();
    business.mockResolvedValue(
      jsonResponse({ code: "00", data: [{ code: "044", name: "Access Bank" }] })
    );

    await expect(client.listBanks()).resolves.toEqual([{ code: "044", name: "Access Bank" }]);
  });

  it("throws a 502 when the response code is not 00", async () => {
    const client = buildClient();
    business.mockResolvedValue(jsonResponse({ code: "99", description: "denied" }));

    const error = await client.listBanks().catch((err: unknown) => err);
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(HttpStatus.BAD_GATEWAY);
  });

  it("treats an HTTP 201 pending transfer as success-pending, not an error", async () => {
    const client = buildClient();
    business.mockResolvedValue(
      jsonResponse({ data: { status: "PENDING_BILLING" } }, { ok: true, status: 201 })
    );

    await expect(
      client.transferToBank("0123456789", "ADA OKEKE", "044", 500000, "ref-1", "PAADI")
    ).resolves.toEqual({ status: "pending", reference: "ref-1", transferId: undefined });
  });

  it("surfaces the transfer's returned data.id as transferId for the payout-confirm requery", async () => {
    const client = buildClient();
    business.mockResolvedValue(
      jsonResponse({ data: { status: "PENDING_BILLING", id: "transfer-77" } }, { ok: true, status: 201 })
    );

    await expect(
      client.transferToBank("0123456789", "ADA OKEKE", "044", 500000, "ref-1", "PAADI")
    ).resolves.toEqual({ status: "pending", reference: "ref-1", transferId: "transfer-77" });
  });

  it("encodes checkout amounts as a decimal naira string", async () => {
    const client = buildClient();
    business.mockResolvedValue(
      jsonResponse({ code: "00", data: { orderReference: "ORD-1", checkoutLink: "https://link" } })
    );

    await client.createCheckoutOrder(1000000, "ORD-1");

    const checkoutCall = calls.find((call) => call.url.includes("/v1/checkout/order"))!;
    const sent = JSON.parse(checkoutCall.init.body ?? "{}");
    expect(sent.order.amount).toBe("10000.00");
  });

  it("encodes bill amounts as an integer and rejects non-whole-naira kobo", async () => {
    const client = buildClient();
    business.mockResolvedValue(
      jsonResponse({ code: "00", data: { meta: { phcnVendToken: "TK", phcnVendUnits: "5.0" } } })
    );

    await client.payElectricity("ikeja", "123", "PREPAID", 200000, "ref-1", "ADA OKEKE");
    const billCall = calls.find((call) => call.url.includes("/v1/bill/electricity") && call.init.method === "POST")!;
    const sent = JSON.parse(billCall.init.body ?? "{}");
    expect(sent.amount).toBe(2000);

    const error = await client
      .payElectricity("ikeja", "123", "PREPAID", 1, "ref-2", "ADA OKEKE")
      .catch((err: unknown) => err);
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(HttpStatus.BAD_REQUEST);
  });

  it("maps electricity discos data id to code", async () => {
    const client = buildClient();
    business.mockResolvedValue(
      jsonResponse({ code: "00", data: [{ id: "ikeja-electric", name: "Ikeja Electric" }] })
    );

    await expect(client.listElectricityDiscos()).resolves.toEqual([
      { code: "ikeja-electric", name: "Ikeja Electric" }
    ]);
  });

  it("maps a verifyTransaction response amount to kobo and recovers the reference", async () => {
    const client = buildClient();
    business.mockResolvedValue(
      jsonResponse({
        code: "00",
        data: { id: "txn-1", orderReference: "ORD-1", amount: 5000, status: "SUCCESS" }
      })
    );

    await expect(client.verifyTransaction("ORD-1")).resolves.toEqual({
      success: true,
      reference: "ORD-1",
      transactionId: "txn-1",
      amountKobo: 500000,
      status: "SUCCESS"
    });
  });
});
