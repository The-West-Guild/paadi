const http = require("node:http");
const { execFileSync } = require("node:child_process");
const { createHmac, timingSafeEqual } = require("node:crypto");
const {
  buildOutboundSigningString
} = require("/Users/feranmialabi/Developer/projects/nomba-paadi/packages/domain/dist/webhooks/outbound-signer.js");
const {
  buildSignedNombaWebhook
} = require("/Users/feranmialabi/Developer/projects/nomba-paadi/apps/api/dist/integrations/nomba/dev/sign-nomba-webhook.js");

const BASE = process.env.BASE_URL || "http://localhost:3010";
const KEY = process.env.NOMBA_WEBHOOK_SIGNING_KEY || "devsecret";
const DATABASE_URL =
  process.env.DATABASE_URL || "postgresql://paadi:paadi@localhost:5433/paadi";
const PSQL = process.env.PSQL_BIN || "psql";
const RECEIVER_HOST = process.env.RECEIVER_HOST || "127.0.0.1";

const CREDIT_KOBO = 500000;
const CREDIT_NAIRA = (CREDIT_KOBO / 100).toFixed(2);
const PROCESS_TIMEOUT_MS = Number(process.env.PROCESS_TIMEOUT_MS || 45_000);
const POLL_EVERY_MS = 2_000;
const DELIVERY_DEAD_CEILING = Number(process.env.DELIVERY_DEAD_CEILING || 10);

let failures = 0;

function pass(name, extra) {
  console.log(`PASS  ${name}${extra ? `  (${extra})` : ""}`);
}
function fail(name, detail) {
  failures += 1;
  console.error(`FAIL  ${name}${detail ? `  ${detail}` : ""}`);
}
function assertEqual(name, got, want) {
  if (String(got) === String(want)) {
    pass(name, String(got));
  } else {
    fail(name, `expected[${want}] got[${got}]`);
  }
}
function assertMatch(name, got, pattern) {
  if (pattern.test(String(got))) {
    pass(name, String(got));
  } else {
    fail(name, `got[${got}] did not match ${pattern}`);
  }
}
function assertTrue(name, cond, detail) {
  if (cond) {
    pass(name, detail);
  } else {
    fail(name, detail);
  }
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function call(method, path, body, token) {
  const headers = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, body: json };
}

async function callOk(method, path, body, token) {
  const res = await call(method, path, body, token);
  if (res.status >= 400) {
    throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body;
}

function sql(query) {
  const out = execFileSync(
    PSQL,
    [DATABASE_URL, "-At", "-F", "|", "-v", "ON_ERROR_STOP=1", "-c", query],
    { encoding: "utf8" }
  );
  return out.trim();
}

function sqlRows(query) {
  const out = sql(query);
  if (out.length === 0) return [];
  return out.split("\n").map((line) => line.split("|"));
}

function sqlScalar(query) {
  const rows = sqlRows(query);
  return rows.length > 0 ? rows[0][0] : "";
}

async function poll(label, predicate, timeoutMs) {
  const started = Date.now();
  let last = { value: "" };
  while (Date.now() - started < timeoutMs) {
    last = predicate();
    if (last.done) return last.value;
    await sleep(POLL_EVERY_MS);
  }
  throw new Error(`timeout waiting for ${label} (last=${last.value})`);
}

function verifyPaadiSignature(secret, parsedBody, headers) {
  const timestamp = headers["paadi-timestamp"];
  const provided = headers["paadi-signature"];
  if (!timestamp || !provided) {
    return { ok: false, reason: "missing paadi-signature/paadi-timestamp header" };
  }
  const signingString = buildOutboundSigningString(
    {
      id: parsedBody.id,
      type: parsedBody.type,
      createdAt: parsedBody.createdAt,
      data: parsedBody.data
    },
    timestamp
  );
  const expected = createHmac("sha256", secret).update(signingString).digest("base64");
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  const ok = left.length === right.length && timingSafeEqual(left, right);
  return { ok, expected, provided };
}

function startReceiver(behavior) {
  const state = { requests: [], responseStatus: 200 };
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = raw;
      }
      state.requests.push({ headers: req.headers, body: parsed, raw });
      const status = typeof behavior === "function" ? behavior(state) : state.responseStatus;
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: status < 400 }));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, RECEIVER_HOST, () => {
      const port = server.address().port;
      resolve({
        server,
        state,
        url: `http://${RECEIVER_HOST}:${port}/hook`,
        close: () => new Promise((done) => server.close(done))
      });
    });
  });
}

async function signupTier1(role) {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const phone = `+23480${String(Math.floor(Math.random() * 1e8))
    .padStart(8, "0")
    .slice(0, 8)}`;
  const start = await callOk("POST", "/auth/signup/start", { phone });
  const onb = start.onboardingToken;
  await callOk("POST", "/auth/signup/verify-phone", {
    onboardingToken: onb,
    code: "000000"
  });
  await callOk("POST", "/auth/signup/profile", {
    onboardingToken: onb,
    firstName: "Ada",
    lastName: "Okeke"
  });
  await callOk("POST", "/auth/signup/username", {
    onboardingToken: onb,
    username: `${role}${stamp}`
  });
  await callOk("POST", "/auth/signup/password", {
    onboardingToken: onb,
    password: `Sup3rSecret!${stamp}`
  });
  const pinResp = await callOk("POST", "/auth/signup/pin", {
    onboardingToken: onb,
    pin: "1357"
  });
  const access = pinResp.accessToken;
  const userId = sqlScalar(`SELECT id FROM "User" WHERE username = '${role}${stamp}'`);
  assertMatch(`[setup:${role}] userId resolved`, userId, /.+/);
  return { access, stamp, userId };
}

function grantTier1(userId) {
  sql(
    `UPDATE "User" SET tier = 'TIER_1', "kycStatus" = 'VERIFIED', "bvnVerified" = true, "bvnVerifiedAt" = now() WHERE id = '${userId}'`
  );
  assertEqual(
    `[setup] psql tier-set applied (bypasses mock KYC 500)`,
    sqlScalar(`SELECT tier || '/' || "kycStatus" FROM "User" WHERE id = '${userId}'`),
    "TIER_1/VERIFIED"
  );
}

async function provisionVirtualAccount(access) {
  const res = await call("POST", "/me/virtual-account", {}, access);
  if (res.status !== 201 && res.status !== 200) {
    throw new Error(`provision VA -> ${res.status} ${JSON.stringify(res.body)}`);
  }
  assertMatch("[setup] NUBAN is 10-digit numeric", res.body.accountNumber, /^\d{10}$/);
  assertEqual("[setup] VA status ACTIVE", res.body.status, "ACTIVE");
  return res.body.accountNumber;
}

function buildVactBody(accountNumber, transactionId, timestamp) {
  return {
    event_type: "payment_success",
    requestId: `vact-req-${transactionId}`,
    data: {
      merchant: { userId: "mock-user", walletId: "mock-wallet" },
      transaction: {
        transactionId,
        type: "vact_transfer",
        time: timestamp,
        responseCode: "00",
        transactionAmount: CREDIT_NAIRA,
        merchantTxRef: `paadi-vact-${transactionId}`,
        aliasAccountType: "VIRTUAL",
        aliasAccountNumber: accountNumber,
        aliasAccountName: "Nomba/ADA OKEKE",
        aliasAccountReference: `nomba-alias-${transactionId}`
      },
      customer: {
        senderName: "JOHN SENDER",
        accountNumber: "0111111111",
        bankName: "Guaranty Trust Bank",
        bankCode: "058"
      }
    }
  };
}

async function postVact(accountNumber, transactionId) {
  const ts = new Date().toISOString();
  const payload = buildVactBody(accountNumber, transactionId, ts);
  const { body, signature } = buildSignedNombaWebhook(payload, ts, KEY);
  const res = await fetch(`${BASE}/webhooks/nomba`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "nomba-signature": signature,
      "nomba-timestamp": ts
    },
    body
  });
  return { status: res.status };
}

async function registerEndpoint(access, url) {
  const res = await call(
    "POST",
    "/developer/webhooks",
    { url, events: ["wallet.credited"], description: "e2e receiver" },
    access
  );
  if (res.status !== 201 && res.status !== 200) {
    throw new Error(`register webhook -> ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body;
}

async function scenarioSignedDeliveryVerifies() {
  console.log(
    "\n== scenario 1: register endpoint -> vact credit -> receiver gets POST with a verifiable paadi-signature =="
  );
  const receiver = await startReceiver(() => 200);
  const { access, userId } = await signupTier1("whorg");
  grantTier1(userId);
  const accountNumber = await provisionVirtualAccount(access);

  const created = await registerEndpoint(access, receiver.url);
  assertMatch("[deliver] create response returns secret once", created.secret, /.+/);
  assertEqual("[deliver] endpoint status ACTIVE", created.status, "ACTIVE");
  assertTrue(
    "[deliver] events include wallet.credited",
    Array.isArray(created.events) && created.events.includes("wallet.credited"),
    JSON.stringify(created.events)
  );
  const secret = created.secret;
  const endpointId = created.id;

  const listed = await callOk("GET", "/developer/webhooks", undefined, access);
  const listedEndpoint = (listed.endpoints || []).find((e) => e.id === endpointId);
  assertTrue("[deliver] endpoint appears in list", Boolean(listedEndpoint), endpointId);
  assertEqual(
    "[deliver] secret omitted from list response",
    listedEndpoint && "secret" in listedEndpoint ? "present" : "absent",
    "absent"
  );

  const txnId = `wh-txn-${accountNumber}`;
  const posted = await postVact(accountNumber, txnId);
  assertEqual("[deliver] vact webhook accepted (fast-ack 201)", posted.status, 201);

  await poll(
    "wallet.credited outbox row",
    () => {
      const value = sqlScalar(
        `SELECT COUNT(*) FROM "WebhookEventOut" WHERE "eventType" = 'wallet.credited' AND payload->>'nombaTransactionId' = '${txnId}'`
      );
      return { done: value === "1", value };
    },
    PROCESS_TIMEOUT_MS
  );

  await poll(
    "receiver got at least one POST",
    () => {
      const value = String(receiver.state.requests.length);
      return { done: receiver.state.requests.length >= 1, value };
    },
    PROCESS_TIMEOUT_MS
  );

  const req = receiver.state.requests[0];
  assertEqual(
    "[deliver] paadi-event-type header is wallet.credited",
    req.headers["paadi-event-type"],
    "wallet.credited"
  );
  assertMatch(
    "[deliver] paadi-delivery-id header present",
    req.headers["paadi-delivery-id"],
    /.+/
  );
  assertMatch("[deliver] paadi-timestamp header present", req.headers["paadi-timestamp"], /.+/);
  assertEqual("[deliver] body.type is wallet.credited", req.body.type, "wallet.credited");
  assertEqual(
    "[deliver] body.data.amountKobo == 500000",
    req.body.data && req.body.data.amountKobo,
    "500000"
  );

  const verified = verifyPaadiSignature(secret, req.body, req.headers);
  assertTrue(
    "[deliver] paadi-signature VERIFIES with captured secret (tenant can verify as we sign)",
    verified.ok,
    verified.ok ? "match" : `expected[${verified.expected}] provided[${verified.provided}]`
  );

  const tampered = verifyPaadiSignature(`${secret}x`, req.body, req.headers);
  assertTrue(
    "[deliver] paadi-signature FAILS under a wrong secret (forgery-resistant)",
    !tampered.ok,
    "mismatch as expected"
  );

  await poll(
    "delivery row marked DELIVERED",
    () => {
      const value = sqlScalar(
        `SELECT status FROM "WebhookDelivery" WHERE "endpointId" = '${endpointId}'`
      );
      return { done: value === "DELIVERED", value };
    },
    PROCESS_TIMEOUT_MS
  );
  assertEqual(
    "[deliver] WebhookDelivery.lastResponseCode == 200",
    sqlScalar(
      `SELECT "lastResponseCode" FROM "WebhookDelivery" WHERE "endpointId" = '${endpointId}'`
    ),
    "200"
  );

  await receiver.close();
  return { access, userId, accountNumber };
}

async function scenarioDisabledEndpointReceivesNothing() {
  console.log(
    "\n== scenario 2: DISABLED endpoint receives nothing (fan-out filters it out) =="
  );
  const receiver = await startReceiver(() => 200);
  const { access, userId } = await signupTier1("disabledorg");
  grantTier1(userId);
  const accountNumber = await provisionVirtualAccount(access);

  const created = await registerEndpoint(access, receiver.url);
  const endpointId = created.id;
  const disabled = await callOk("DELETE", `/developer/webhooks/${endpointId}`, undefined, access);
  assertEqual("[disabled] endpoint soft-disabled", disabled.status, "DISABLED");

  const txnId = `wh-disabled-${accountNumber}`;
  const posted = await postVact(accountNumber, txnId);
  assertEqual("[disabled] vact webhook accepted (fast-ack 201)", posted.status, 201);

  await poll(
    "wallet.credited outbox row (disabled owner)",
    () => {
      const value = sqlScalar(
        `SELECT COUNT(*) FROM "WebhookEventOut" WHERE "eventType" = 'wallet.credited' AND payload->>'nombaTransactionId' = '${txnId}'`
      );
      return { done: value === "1", value };
    },
    PROCESS_TIMEOUT_MS
  );

  await sleep(PROCESS_TIMEOUT_MS / 3);

  assertEqual(
    "[disabled] no WebhookDelivery row created for a disabled endpoint",
    sqlScalar(`SELECT COUNT(*) FROM "WebhookDelivery" WHERE "endpointId" = '${endpointId}'`),
    "0"
  );
  assertEqual(
    "[disabled] receiver got zero POSTs",
    String(receiver.state.requests.length),
    "0"
  );

  await receiver.close();
}

async function scenarioRetryThenDead() {
  console.log(
    "\n== scenario 3: 500-returning receiver -> FAILED with bounded backoff -> DEAD at attempt ceiling =="
  );
  const receiver = await startReceiver(() => 500);
  const { access, userId } = await signupTier1("deadorg");
  grantTier1(userId);
  const accountNumber = await provisionVirtualAccount(access);

  const created = await registerEndpoint(access, receiver.url);
  const endpointId = created.id;

  const txnId = `wh-dead-${accountNumber}`;
  const posted = await postVact(accountNumber, txnId);
  assertEqual("[dead] vact webhook accepted (fast-ack 201)", posted.status, 201);

  await poll(
    "first failed delivery attempt",
    () => {
      const value = sqlScalar(
        `SELECT status FROM "WebhookDelivery" WHERE "endpointId" = '${endpointId}'`
      );
      return { done: value === "FAILED", value };
    },
    PROCESS_TIMEOUT_MS
  );

  const afterFirst = sqlRows(`
    SELECT status, attempts, "lastResponseCode",
           CASE WHEN "nextAttemptAt" IS NULL THEN 'null' ELSE 'set' END,
           CASE WHEN "nextAttemptAt" > now() THEN 'future' ELSE 'past' END
    FROM "WebhookDelivery" WHERE "endpointId" = '${endpointId}'
  `)[0];
  assertEqual("[dead] first attempt status FAILED", afterFirst[0], "FAILED");
  assertTrue(
    "[dead] attempts incremented (>= 1)",
    Number(afterFirst[1]) >= 1,
    `attempts=${afterFirst[1]}`
  );
  assertEqual("[dead] lastResponseCode captured 500", afterFirst[2], "500");
  assertEqual("[dead] nextAttemptAt scheduled (bounded backoff, not immediate)", afterFirst[3], "set");
  assertEqual("[dead] nextAttemptAt is in the future (no hot-loop retry)", afterFirst[4], "future");
  assertTrue(
    "[dead] receiver was actually hit (>= 1 POST, all 500s)",
    receiver.state.requests.length >= 1,
    `posts=${receiver.state.requests.length}`
  );

  sql(`
    UPDATE "WebhookDelivery"
    SET attempts = ${DELIVERY_DEAD_CEILING - 1}, "nextAttemptAt" = now() - interval '1 second'
    WHERE "endpointId" = '${endpointId}'
  `);

  const deadStatus = await poll(
    "delivery reaches DEAD at ceiling",
    () => {
      const value = sqlScalar(
        `SELECT status FROM "WebhookDelivery" WHERE "endpointId" = '${endpointId}'`
      );
      return { done: value === "DEAD", value };
    },
    PROCESS_TIMEOUT_MS
  );
  assertEqual("[dead] delivery dead-lettered after ceiling", deadStatus, "DEAD");
  assertEqual(
    "[dead] DEAD row stops retrying (nextAttemptAt cleared)",
    sqlScalar(
      `SELECT CASE WHEN "nextAttemptAt" IS NULL THEN 'null' ELSE 'set' END FROM "WebhookDelivery" WHERE "endpointId" = '${endpointId}'`
    ),
    "null"
  );
  assertEqual(
    "[dead] DEAD attempts == ceiling",
    sqlScalar(`SELECT attempts FROM "WebhookDelivery" WHERE "endpointId" = '${endpointId}'`),
    String(DELIVERY_DEAD_CEILING)
  );

  const deliveries = await callOk(
    "GET",
    `/developer/webhooks/${endpointId}/deliveries`,
    undefined,
    access
  );
  const row = (deliveries.deliveries || [])[0];
  assertEqual("[dead] deliveries API surfaces DEAD state for ops", row && row.status, "DEAD");

  await receiver.close();
}

async function scenarioCrossUserIsolation() {
  console.log(
    "\n== scenario 4: user A's credit never delivers to user B's endpoint (owner-scoped fan-out) =="
  );
  const receiverA = await startReceiver(() => 200);
  const receiverB = await startReceiver(() => 200);
  const a = await signupTier1("isoA");
  const b = await signupTier1("isoB");
  grantTier1(a.userId);
  grantTier1(b.userId);
  const accountA = await provisionVirtualAccount(a.access);

  const endpointA = await registerEndpoint(a.access, receiverA.url);
  const endpointB = await registerEndpoint(b.access, receiverB.url);

  const txnId = `wh-iso-${accountA}`;
  const posted = await postVact(accountA, txnId);
  assertEqual("[iso] vact webhook accepted (fast-ack 201)", posted.status, 201);

  await poll(
    "A's delivery row created",
    () => {
      const value = sqlScalar(
        `SELECT COUNT(*) FROM "WebhookDelivery" WHERE "endpointId" = '${endpointA.id}'`
      );
      return { done: value === "1", value };
    },
    PROCESS_TIMEOUT_MS
  );

  await sleep(PROCESS_TIMEOUT_MS / 3);

  assertEqual(
    "[iso] no delivery row for user B's endpoint",
    sqlScalar(`SELECT COUNT(*) FROM "WebhookDelivery" WHERE "endpointId" = '${endpointB.id}'`),
    "0"
  );
  assertEqual("[iso] receiver B got zero POSTs", String(receiverB.state.requests.length), "0");
  assertTrue(
    "[iso] receiver A got the credit",
    receiverA.state.requests.length >= 1,
    `posts=${receiverA.state.requests.length}`
  );

  await receiverA.close();
  await receiverB.close();
}

async function main() {
  console.log("== Paadi developer-webhook delivery live-e2e ==");
  console.log(`   base: ${BASE}`);
  console.log(`   db:   ${DATABASE_URL.replace(/:[^:@]+@/, ":***@")}`);
  await callOk("GET", "/docs").catch(() => {
    throw new Error(`API not reachable at ${BASE}`);
  });
  console.log(`   psql: ${sqlScalar("SELECT 1")}`);

  await scenarioSignedDeliveryVerifies();
  await scenarioDisabledEndpointReceivesNothing();
  await scenarioRetryThenDead();
  await scenarioCrossUserIsolation();

  console.log("");
  if (failures > 0) {
    console.error(`== DEVELOPER-WEBHOOK E2E FAILED (${failures} assertion(s)) ==`);
    process.exit(1);
  }
  console.log("== ALL DEVELOPER-WEBHOOK E2E ASSERTIONS PASSED ==");
}

main().catch((e) => {
  console.error("E2E_DRIVER_ERROR", e.message);
  process.exit(1);
});
