const { execFileSync } = require("node:child_process");
const { buildSignedNombaWebhook } = require("/Users/feranmialabi/Developer/projects/nomba-paadi/apps/api/dist/integrations/nomba/dev/sign-nomba-webhook.js");

const BASE = process.env.BASE_URL || "http://localhost:3010";
const KEY = process.env.NOMBA_WEBHOOK_SIGNING_KEY || "devsecret";
const DATABASE_URL =
  process.env.DATABASE_URL || "postgresql://paadi:paadi@localhost:5433/paadi";
const PSQL = process.env.PSQL_BIN || "psql";

const CREDIT_KOBO = 500000;
const CREDIT_NAIRA = (CREDIT_KOBO / 100).toFixed(2);
const PROCESS_TIMEOUT_MS = Number(process.env.PROCESS_TIMEOUT_MS || 45_000);
const POLL_EVERY_MS = 2_000;

const ADMIN_ENV = "PAADI_ADMIN_USER_IDS";
const ALLOWLIST = (process.env[ADMIN_ENV] ?? "")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);

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

function ledgerBalanceKobo(kind, ownerRef) {
  const owner = ownerRef === null ? "" : `AND a."ownerRef" = '${ownerRef}'`;
  return sqlScalar(`
    SELECT COALESCE(SUM(CASE WHEN e.direction = 'DR' THEN e."amountKobo" ELSE -e."amountKobo" END), 0)
    FROM "LedgerEntry" e
    JOIN "LedgerAccount" a ON a.id = e."accountId"
    WHERE a.kind = '${kind}' ${owner}
  `);
}

function assertGlobalInvariant(scenario) {
  const pooled = ledgerBalanceKobo("pooled_cash", "house");
  const sumPotLiability = ledgerBalanceKobo("pot_liability", null);
  const sumUserWallet = ledgerBalanceKobo("user_wallet", null);
  const suspense = ledgerBalanceKobo("exceptions_suspense", null);
  const payout = ledgerBalanceKobo("settlement_payout", null);
  const platformFee = ledgerBalanceKobo("platform_fee", null);
  const refundsPayable = ledgerBalanceKobo("refunds_payable", null);
  const rhs =
    BigInt(sumPotLiability) +
    BigInt(sumUserWallet) +
    BigInt(suspense) +
    BigInt(payout) +
    BigInt(platformFee) +
    BigInt(refundsPayable);
  assertEqual(
    `[${scenario}] balance invariant pooled_cash == Σ liabilities/transit`,
    pooled,
    rhs.toString()
  );
}

function assertSuspenseConservation(scenario) {
  const suspense = ledgerBalanceKobo("exceptions_suspense", "house");
  const openSum = sqlScalar(`
    SELECT COALESCE(SUM("amountKobo"), 0)
    FROM "ReconciliationException"
    WHERE status = 'OPEN' AND "suspenseOwnerRef" = 'house'
  `);
  assertEqual(
    `[${scenario}] exceptions_suspense[house] == Σ OPEN house exceptions`,
    suspense,
    openSum
  );
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

  await callOk("POST", "/me/kyc/bvn", { bvn: "12345678901" }, access);
  const selfie = await callOk(
    "POST",
    "/me/kyc/selfie",
    { image: "data:image/png;base64,bW9jay1zZWxmaWU=" },
    access
  );
  assertEqual(`[setup:${role}] kyc tier after selfie`, selfie.tier, "TIER_1");
  const userId = sqlScalar(`SELECT id FROM "User" WHERE username = '${role}${stamp}'`);
  assertMatch(`[setup:${role}] userId resolved`, userId, /.+/);
  return { access, stamp, userId };
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
        bankName: "GTBank",
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

async function raiseUnknownException(label, unprovisioned, txnId) {
  const suspenseBefore = ledgerBalanceKobo("exceptions_suspense", "house");
  assertEqual(
    `[${label}] target NUBAN is genuinely unprovisioned`,
    sqlScalar(
      `SELECT COUNT(*) FROM "VirtualAccount" WHERE "accountNumber" = '${unprovisioned}'`
    ),
    "0"
  );

  const posted = await postVact(unprovisioned, txnId);
  assertEqual(`[${label}] webhook accepted (fast-ack 201)`, posted.status, 201);

  const exceptionId = await poll(
    `${label} ReconciliationException persisted`,
    () => {
      const value = sqlScalar(
        `SELECT id FROM "ReconciliationException" WHERE "nombaTransactionId" = '${txnId}'`
      );
      return { done: value.length > 0, value };
    },
    PROCESS_TIMEOUT_MS
  );

  assertEqual(
    `[${label}] exactly one ReconciliationException for this txn`,
    sqlScalar(
      `SELECT COUNT(*) FROM "ReconciliationException" WHERE "nombaTransactionId" = '${txnId}'`
    ),
    "1"
  );
  assertEqual(
    `[${label}] NO WalletCredit row (money not yet anyone's)`,
    sqlScalar(
      `SELECT COUNT(*) FROM "WalletCredit" WHERE "nombaTransactionId" = '${txnId}'`
    ),
    "0"
  );

  const row = sqlRows(`
    SELECT status, reason, "amountKobo", "senderName", "senderAccount", "senderBank", "vaAccountNumber", "suspenseOwnerRef"
    FROM "ReconciliationException" WHERE id = '${exceptionId}'
  `);
  if (row.length === 1) {
    const [status, reason, amount, sName, sAcct, sBank, vaNum, owner] = row[0];
    assertEqual(`[${label}] exception status OPEN`, status, "OPEN");
    assertEqual(`[${label}] reason UNKNOWN_ACCOUNT`, reason, "UNKNOWN_ACCOUNT");
    assertEqual(`[${label}] amountKobo == 500000`, amount, "500000");
    assertEqual(`[${label}] senderName captured`, sName, "JOHN SENDER");
    assertEqual(`[${label}] senderAccount captured`, sAcct, "0111111111");
    assertEqual(`[${label}] senderBank captured`, sBank, "GTBank");
    assertEqual(`[${label}] vaAccountNumber == target NUBAN`, vaNum, unprovisioned);
    assertEqual(`[${label}] suspenseOwnerRef house`, owner, "house");
  }

  assertEqual(
    `[${label}] exceptions_suspense[house] grew by 500000`,
    (
      BigInt(ledgerBalanceKobo("exceptions_suspense", "house")) - BigInt(suspenseBefore)
    ).toString(),
    "500000"
  );
  assertEqual(
    `[${label}] one exception.raised outbox row`,
    sqlScalar(
      `SELECT COUNT(*) FROM "WebhookEventOut" WHERE "eventType" = 'exception.raised' AND payload->>'exceptionId' = '${exceptionId}'`
    ),
    "1"
  );
  assertEqual(
    `[${label}] exception.raised payload reason`,
    sqlScalar(
      `SELECT payload->>'reason' FROM "WebhookEventOut" WHERE "eventType" = 'exception.raised' AND payload->>'exceptionId' = '${exceptionId}'`
    ),
    "UNKNOWN_ACCOUNT"
  );
  assertSuspenseConservation(label);
  assertGlobalInvariant(label);
  return exceptionId;
}

async function assertAdminGate() {
  console.log("\n== admin gate: non-admin -> 403, admin -> 200 ==");
  const stranger = await signupTier1("stranger");
  const strangerRes = await call(
    "GET",
    "/admin/reconciliation/exceptions?status=OPEN",
    null,
    stranger.access
  );
  assertEqual("[gate] non-allowlisted user forbidden", strangerRes.status, 403);
  assertMatch("[gate] 403 message 'admin only'", JSON.stringify(strangerRes.body), /admin only/);

  const noAuth = await call("GET", "/admin/reconciliation/exceptions", null, null);
  assertEqual("[gate] missing bearer unauthorized", noAuth.status, 401);
}

async function resolveAdminAccess() {
  const admin = await signupTier1("rcxadmin");
  console.log(`\n   admin user id: ${admin.userId}`);
  console.log(`   ${ADMIN_ENV} (boot allowlist): [${ALLOWLIST.join(", ") || "<empty>"}]`);

  const probe = await call(
    "GET",
    "/admin/reconciliation/exceptions?status=OPEN&limit=1",
    null,
    admin.access
  );
  if (probe.status === 200) {
    pass("[gate] admin caller reaches the queue (200)");
    return admin;
  }

  console.error("");
  console.error("   >>> ADMIN GUARD BLOCKED THE CALLER (fail-closed by design, chunk-8 §4.5/E16).");
  console.error("   >>> The AdminGuard reads PAADI_ADMIN_USER_IDS from the config at BOOT time, so a");
  console.error("   >>> runtime-created admin is not on the allowlist until the API is restarted with it.");
  console.error("   >>> To run the full assign/refund flow, boot the API with this user allowlisted:");
  console.error("   >>>");
  console.error(`   >>>     export ${ADMIN_ENV}=${admin.userId}`);
  console.error("   >>>     # restart the API, then re-run this driver (it will create a fresh admin id).");
  console.error("   >>>");
  console.error("   >>> Because signup mints a random uuid, the deterministic loop is: run once to");
  console.error("   >>> print an id, export it, restart, re-run. Alternatively point the driver at a");
  console.error("   >>> pre-seeded admin whose id is already in the boot allowlist.");
  fail("[gate] admin caller reaches the queue", `got ${probe.status} ${JSON.stringify(probe.body)}`);
  return null;
}

async function scenarioAssign(admin) {
  console.log("\n== scenario A: unknown vact_transfer -> queue -> resolve assign ==");
  const payee = await signupTier1("payee");
  const walletBefore = ledgerBalanceKobo("user_wallet", payee.userId);
  assertEqual("[assign] payee wallet starts at zero", walletBefore, "0");

  const unprovisioned = "9000000001";
  const txnId = `rcx-assign-${Date.now()}`;
  const exceptionId = await raiseUnknownException("assign-raise", unprovisioned, txnId);

  const list = await callOk(
    "GET",
    "/admin/reconciliation/exceptions?status=OPEN",
    null,
    admin.access
  );
  const inQueue = list.items.find((item) => item.id === exceptionId);
  assertEqual("[assign] raised exception visible in OPEN queue", Boolean(inQueue), "true");
  if (inQueue) {
    assertEqual("[assign] queue item reason", inQueue.reason, "UNKNOWN_ACCOUNT");
    assertEqual("[assign] queue item amountKobo (number at boundary)", inQueue.amountKobo, CREDIT_KOBO);
    assertEqual("[assign] queue item senderName", inQueue.senderName, "JOHN SENDER");
  }
  assertEqual(
    "[assign] totals.openAmountKobo includes this exception",
    BigInt(list.totals.openAmountKobo) >= BigInt(CREDIT_KOBO),
    true
  );
  assertEqual("[assign] totals.openCount >= 1", list.totals.openCount >= 1, true);

  const suspenseBefore = ledgerBalanceKobo("exceptions_suspense", "house");
  const resolved = await callOk(
    "POST",
    `/admin/reconciliation/exceptions/${exceptionId}/resolve`,
    { action: "assign", userId: payee.userId, note: "clearly the payee's deposit" },
    admin.access
  );
  assertEqual("[assign] resolve response status RESOLVED", resolved.status, "RESOLVED");
  assertEqual("[assign] resolve response matchedUserId == payee", resolved.matchedUserId, payee.userId);
  assertEqual("[assign] resolve response resolvedBy == admin", resolved.resolvedBy, admin.userId);

  assertEqual(
    "[assign] DB row RESOLVED",
    sqlScalar(`SELECT status FROM "ReconciliationException" WHERE id = '${exceptionId}'`),
    "RESOLVED"
  );
  assertEqual(
    "[assign] DB matchedUserId == payee",
    sqlScalar(`SELECT "matchedUserId" FROM "ReconciliationException" WHERE id = '${exceptionId}'`),
    payee.userId
  );
  assertEqual(
    "[assign] DB resolvedBy == admin",
    sqlScalar(`SELECT "resolvedBy" FROM "ReconciliationException" WHERE id = '${exceptionId}'`),
    admin.userId
  );
  assertEqual(
    "[assign] resolvedAt stamped",
    sqlScalar(
      `SELECT CASE WHEN "resolvedAt" IS NULL THEN 'null' ELSE 'set' END FROM "ReconciliationException" WHERE id = '${exceptionId}'`
    ),
    "set"
  );

  assertEqual(
    "[assign] exceptions_suspense[house] drawn down by 500000",
    (
      BigInt(suspenseBefore) - BigInt(ledgerBalanceKobo("exceptions_suspense", "house"))
    ).toString(),
    "500000"
  );
  assertEqual(
    "[assign] user_wallet[payee] credited 500000",
    ledgerBalanceKobo("user_wallet", payee.userId),
    "500000"
  );

  const txn = sqlRows(`
    SELECT t.id, t.kind
    FROM "LedgerTransaction" t
    JOIN "LedgerEntry" e ON e."transactionId" = t.id
    JOIN "LedgerAccount" a ON a.id = e."accountId"
    WHERE a.kind = 'user_wallet' AND a."ownerRef" = '${payee.userId}'
    GROUP BY t.id, t.kind
  `);
  assertEqual("[assign] exactly one exception_assignment LedgerTransaction", txn.length, 1);
  if (txn.length === 1) {
    const [txnDbId, txnKind] = txn[0];
    assertEqual("[assign] LedgerTransaction.kind exception_assignment", txnKind, "exception_assignment");
    const dr = sqlScalar(`
      SELECT COALESCE(SUM(e."amountKobo"), 0)
      FROM "LedgerEntry" e WHERE e."transactionId" = '${txnDbId}' AND e.direction = 'DR'
    `);
    const cr = sqlScalar(`
      SELECT COALESCE(SUM(e."amountKobo"), 0)
      FROM "LedgerEntry" e WHERE e."transactionId" = '${txnDbId}' AND e.direction = 'CR'
    `);
    assertEqual("[assign] assignment transaction balances (ΣDR == ΣCR)", dr, cr);
    assertEqual("[assign] assignment total == 500000", dr, "500000");
    assertEqual(
      "[assign] DR leg is exceptions_suspense[house]",
      sqlScalar(`
        SELECT a.kind || '[' || a."ownerRef" || ']'
        FROM "LedgerEntry" e JOIN "LedgerAccount" a ON a.id = e."accountId"
        WHERE e."transactionId" = '${txnDbId}' AND e.direction = 'DR'
      `),
      "exceptions_suspense[house]"
    );
    assertEqual(
      "[assign] CR leg is user_wallet[payee]",
      sqlScalar(`
        SELECT a.kind || '[' || a."ownerRef" || ']'
        FROM "LedgerEntry" e JOIN "LedgerAccount" a ON a.id = e."accountId"
        WHERE e."transactionId" = '${txnDbId}' AND e.direction = 'CR'
      `),
      `user_wallet[${payee.userId}]`
    );
  }

  assertEqual(
    "[assign] one exception.resolved outbox row",
    sqlScalar(
      `SELECT COUNT(*) FROM "WebhookEventOut" WHERE "eventType" = 'exception.resolved' AND payload->>'exceptionId' = '${exceptionId}'`
    ),
    "1"
  );
  assertEqual(
    "[assign] exception.resolved payload action",
    sqlScalar(
      `SELECT payload->>'action' FROM "WebhookEventOut" WHERE "eventType" = 'exception.resolved' AND payload->>'exceptionId' = '${exceptionId}'`
    ),
    "assign"
  );
  assertEqual(
    "[assign] exception.resolved payload userId == payee",
    sqlScalar(
      `SELECT payload->>'userId' FROM "WebhookEventOut" WHERE "eventType" = 'exception.resolved' AND payload->>'exceptionId' = '${exceptionId}'`
    ),
    payee.userId
  );
  assertSuspenseConservation("assign-resolved");
  assertGlobalInvariant("assign-resolved");

  console.log("\n== scenario A': re-resolve the assigned exception -> 409 ==");
  const reResolve = await call(
    "POST",
    `/admin/reconciliation/exceptions/${exceptionId}/resolve`,
    { action: "assign", userId: payee.userId },
    admin.access
  );
  assertEqual("[assign] second resolve conflicts", reResolve.status, 409);
  assertMatch("[assign] 409 message 'already resolved'", JSON.stringify(reResolve.body), /already resolved/);
  assertEqual(
    "[assign] still exactly one exception_assignment txn after re-resolve",
    sqlScalar(`
      SELECT COUNT(*) FROM "LedgerTransaction" t
      JOIN "LedgerEntry" e ON e."transactionId" = t.id
      JOIN "LedgerAccount" a ON a.id = e."accountId"
      WHERE t.kind = 'exception_assignment' AND a.kind = 'user_wallet' AND a."ownerRef" = '${payee.userId}'
    `),
    "1"
  );
  assertGlobalInvariant("assign-reresolve");
  return { exceptionId, txnId, unprovisioned };
}

async function scenarioRefund(admin) {
  console.log("\n== scenario B: unknown vact_transfer -> queue -> resolve refund ==");
  const unprovisioned = "9000000002";
  const txnId = `rcx-refund-${Date.now()}`;
  const exceptionId = await raiseUnknownException("refund-raise", unprovisioned, txnId);

  const pooledBefore = ledgerBalanceKobo("pooled_cash", "house");
  const suspenseBefore = ledgerBalanceKobo("exceptions_suspense", "house");
  const expectedRef = `rcx_${exceptionId}`;

  const resolved = await callOk(
    "POST",
    `/admin/reconciliation/exceptions/${exceptionId}/resolve`,
    { action: "refund", bankCode: "058", note: "cannot place; send it back" },
    admin.access
  );
  assertEqual("[refund] resolve response status REFUNDED", resolved.status, "REFUNDED");

  assertEqual(
    "[refund] DB row REFUNDED",
    sqlScalar(`SELECT status FROM "ReconciliationException" WHERE id = '${exceptionId}'`),
    "REFUNDED"
  );
  assertEqual(
    "[refund] resolvedBy == admin",
    sqlScalar(`SELECT "resolvedBy" FROM "ReconciliationException" WHERE id = '${exceptionId}'`),
    admin.userId
  );
  assertEqual(
    "[refund] refundMerchantTxRef == rcx_<id> (deterministic, idempotent at Nomba)",
    sqlScalar(`SELECT "refundMerchantTxRef" FROM "ReconciliationException" WHERE id = '${exceptionId}'`),
    expectedRef
  );

  await poll(
    "refund transfer recorded post-commit",
    () => {
      const value = sqlScalar(
        `SELECT "refundNombaRef" FROM "ReconciliationException" WHERE id = '${exceptionId}'`
      );
      return { done: value.length > 0, value };
    },
    PROCESS_TIMEOUT_MS
  );
  assertEqual(
    "[refund] refundNombaRef == mock echo of rcx_<id>",
    sqlScalar(`SELECT "refundNombaRef" FROM "ReconciliationException" WHERE id = '${exceptionId}'`),
    expectedRef
  );
  assertMatch(
    "[refund] refundStatus set post-commit (PENDING/SUCCESS mapping)",
    sqlScalar(`SELECT COALESCE("refundStatus", 'null') FROM "ReconciliationException" WHERE id = '${exceptionId}'`),
    /^(PENDING|SUCCESS|COMPLETED)$/
  );

  assertEqual(
    "[refund] exceptions_suspense[house] drawn down by 500000",
    (
      BigInt(suspenseBefore) - BigInt(ledgerBalanceKobo("exceptions_suspense", "house"))
    ).toString(),
    "500000"
  );
  assertEqual(
    "[refund] pooled_cash[house] drawn down by 500000 (matching real cash-out)",
    (
      BigInt(pooledBefore) - BigInt(ledgerBalanceKobo("pooled_cash", "house"))
    ).toString(),
    "500000"
  );

  const txn = sqlRows(`
    SELECT t.id
    FROM "LedgerTransaction" t
    WHERE t.kind = 'exception_refund'
      AND EXISTS (
        SELECT 1 FROM "LedgerEntry" e
        JOIN "LedgerAccount" a ON a.id = e."accountId"
        WHERE e."transactionId" = t.id AND a.kind = 'exceptions_suspense' AND a."ownerRef" = 'house'
      )
    ORDER BY t."createdAt" DESC LIMIT 1
  `);
  assertEqual("[refund] an exception_refund LedgerTransaction exists", txn.length, 1);
  if (txn.length === 1) {
    const txnDbId = txn[0][0];
    const dr = sqlScalar(`
      SELECT COALESCE(SUM(e."amountKobo"), 0)
      FROM "LedgerEntry" e WHERE e."transactionId" = '${txnDbId}' AND e.direction = 'DR'
    `);
    const cr = sqlScalar(`
      SELECT COALESCE(SUM(e."amountKobo"), 0)
      FROM "LedgerEntry" e WHERE e."transactionId" = '${txnDbId}' AND e.direction = 'CR'
    `);
    assertEqual("[refund] refund transaction balances (ΣDR == ΣCR)", dr, cr);
    assertEqual("[refund] refund total == 500000", dr, "500000");
    assertEqual(
      "[refund] DR leg is exceptions_suspense[house]",
      sqlScalar(`
        SELECT a.kind || '[' || a."ownerRef" || ']'
        FROM "LedgerEntry" e JOIN "LedgerAccount" a ON a.id = e."accountId"
        WHERE e."transactionId" = '${txnDbId}' AND e.direction = 'DR'
      `),
      "exceptions_suspense[house]"
    );
    assertEqual(
      "[refund] CR leg is pooled_cash[house]",
      sqlScalar(`
        SELECT a.kind || '[' || a."ownerRef" || ']'
        FROM "LedgerEntry" e JOIN "LedgerAccount" a ON a.id = e."accountId"
        WHERE e."transactionId" = '${txnDbId}' AND e.direction = 'CR'
      `),
      "pooled_cash[house]"
    );
  }

  assertEqual(
    "[refund] one exception.resolved outbox row",
    sqlScalar(
      `SELECT COUNT(*) FROM "WebhookEventOut" WHERE "eventType" = 'exception.resolved' AND payload->>'exceptionId' = '${exceptionId}'`
    ),
    "1"
  );
  assertEqual(
    "[refund] exception.resolved payload action refund",
    sqlScalar(
      `SELECT payload->>'action' FROM "WebhookEventOut" WHERE "eventType" = 'exception.resolved' AND payload->>'exceptionId' = '${exceptionId}'`
    ),
    "refund"
  );
  assertSuspenseConservation("refund-resolved");
  assertGlobalInvariant("refund-resolved");

  console.log("\n== scenario B': re-resolve the refunded exception -> 409 ==");
  const reResolve = await call(
    "POST",
    `/admin/reconciliation/exceptions/${exceptionId}/resolve`,
    { action: "refund", bankCode: "058" },
    admin.access
  );
  assertEqual("[refund] second resolve conflicts", reResolve.status, 409);
  assertMatch("[refund] 409 message 'already resolved'", JSON.stringify(reResolve.body), /already resolved/);
  assertGlobalInvariant("refund-reresolve");
  return { exceptionId, txnId, unprovisioned };
}

async function scenarioRaiseIdempotency(admin, assignCtx) {
  console.log("\n== scenario C: replay identical credit -> no second exception (raise idempotency) ==");
  const before = sqlScalar(
    `SELECT COUNT(*) FROM "ReconciliationException" WHERE "nombaTransactionId" = '${assignCtx.txnId}'`
  );
  const suspenseBefore = ledgerBalanceKobo("exceptions_suspense", "house");

  const replay = await postVact(assignCtx.unprovisioned, assignCtx.txnId);
  console.log(`replayed identical unknown vact_transfer -> ${replay.status}`);
  await sleep(PROCESS_TIMEOUT_MS / 3);

  assertEqual(
    "[idem] still exactly one ReconciliationException for txn",
    sqlScalar(
      `SELECT COUNT(*) FROM "ReconciliationException" WHERE "nombaTransactionId" = '${assignCtx.txnId}'`
    ),
    before
  );
  assertEqual(
    "[idem] no second suspense leg posted on replay",
    ledgerBalanceKobo("exceptions_suspense", "house"),
    suspenseBefore
  );
  assertEqual(
    "[idem] the already-resolved exception stays RESOLVED",
    sqlScalar(`SELECT status FROM "ReconciliationException" WHERE id = '${assignCtx.exceptionId}'`),
    "RESOLVED"
  );
  assertGlobalInvariant("idem");
}

async function main() {
  console.log("== Paadi reconciliation / exceptions live-e2e (Chunk 8) ==");
  console.log(`   base: ${BASE}`);
  console.log(`   db:   ${DATABASE_URL.replace(/:[^:@]+@/, ":***@")}`);
  await callOk("GET", "/docs").catch(() => {
    throw new Error(`API not reachable at ${BASE}`);
  });
  console.log(`   psql: ${sqlScalar("SELECT 1")}`);

  await assertAdminGate();

  const admin = await resolveAdminAccess();
  if (!admin) {
    console.error("");
    console.error("== RECONCILIATION E2E ABORTED: admin caller not on the boot allowlist ==");
    console.error("== (fix per instructions above, then re-run) ==");
    process.exit(1);
  }

  const assignCtx = await scenarioAssign(admin);
  await scenarioRefund(admin);
  await scenarioRaiseIdempotency(admin, assignCtx);

  console.log("");
  if (failures > 0) {
    console.error(`== RECONCILIATION E2E FAILED (${failures} assertion(s)) ==`);
    process.exit(1);
  }
  console.log("== ALL RECONCILIATION E2E ASSERTIONS PASSED ==");
}

main().catch((e) => {
  console.error("E2E_DRIVER_ERROR", e.message);
  process.exit(1);
});
