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
  assertEqual("[setup] kyc tier after selfie", selfie.tier, "TIER_1");
  return { access, stamp };
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

async function scenarioHappyPath() {
  console.log("\n== scenario 1: vact_transfer to ACTIVE VA -> wallet credited ==");
  const { access } = await signupTier1("vactorg");
  const accountNumber = await provisionVirtualAccount(access);
  const userId = sqlScalar(
    `SELECT "userId" FROM "VirtualAccount" WHERE "accountNumber" = '${accountNumber}'`
  );
  assertMatch("[happy] resolved userId from NUBAN", userId, /.+/);

  const txnId = `vact-txn-${accountNumber}`;
  const posted = await postVact(accountNumber, txnId);
  assertEqual("[happy] webhook accepted (fast-ack 201)", posted.status, 201);

  await poll(
    "WalletCredit persisted",
    () => {
      const value = sqlScalar(
        `SELECT COUNT(*) FROM "WalletCredit" WHERE "nombaTransactionId" = '${txnId}'`
      );
      return { done: value === "1", value };
    },
    PROCESS_TIMEOUT_MS
  );

  assertEqual(
    "[happy] exactly one WalletCredit row for this transactionId",
    sqlScalar(
      `SELECT COUNT(*) FROM "WalletCredit" WHERE "nombaTransactionId" = '${txnId}'`
    ),
    "1"
  );

  const wc = sqlRows(`
    SELECT "userId", "amountKobo", status, "senderName", "senderAccount", "senderBank", "senderBankCode"
    FROM "WalletCredit" WHERE "nombaTransactionId" = '${txnId}'
  `);
  if (wc.length === 1) {
    const [wcUser, wcAmount, wcStatus, sName, sAcct, sBank, sBankCode] = wc[0];
    assertEqual("[happy] WalletCredit.userId == resolved user", wcUser, userId);
    assertEqual("[happy] WalletCredit.amountKobo == 500000", wcAmount, "500000");
    assertEqual("[happy] WalletCredit.status succeeded", wcStatus, "succeeded");
    assertEqual("[happy] sender name captured", sName, "JOHN SENDER");
    assertEqual("[happy] sender account captured", sAcct, "0111111111");
    assertEqual("[happy] sender bank captured", sBank, "Guaranty Trust Bank");
    assertEqual("[happy] sender bankCode captured (Chunk 8 refunds)", sBankCode, "058");
  }

  assertEqual(
    "[happy] User.walletBalanceKobo == 500000 (denorm bump)",
    sqlScalar(`SELECT "walletBalanceKobo" FROM "User" WHERE id = '${userId}'`),
    "500000"
  );

  assertEqual(
    "[happy] user_wallet ledger balance == 500000 (source of truth)",
    ledgerBalanceKobo("user_wallet", userId),
    "500000"
  );
  assertEqual(
    "[happy] denorm reconciles to ledger balance",
    sqlScalar(`SELECT "walletBalanceKobo" FROM "User" WHERE id = '${userId}'`),
    ledgerBalanceKobo("user_wallet", userId)
  );

  const txn = sqlRows(`
    SELECT t.id, t.kind
    FROM "LedgerTransaction" t
    JOIN "LedgerEntry" e ON e."transactionId" = t.id
    JOIN "LedgerAccount" a ON a.id = e."accountId"
    WHERE a.kind = 'user_wallet' AND a."ownerRef" = '${userId}'
    GROUP BY t.id, t.kind
  `);
  assertEqual("[happy] exactly one wallet_credit LedgerTransaction", txn.length, 1);
  if (txn.length === 1) {
    const [txnDbId, txnKind] = txn[0];
    assertEqual("[happy] LedgerTransaction.kind wallet_credit", txnKind, "wallet_credit");

    const dr = sqlScalar(`
      SELECT COALESCE(SUM(e."amountKobo"), 0)
      FROM "LedgerEntry" e JOIN "LedgerAccount" a ON a.id = e."accountId"
      WHERE e."transactionId" = '${txnDbId}' AND e.direction = 'DR'
    `);
    const cr = sqlScalar(`
      SELECT COALESCE(SUM(e."amountKobo"), 0)
      FROM "LedgerEntry" e JOIN "LedgerAccount" a ON a.id = e."accountId"
      WHERE e."transactionId" = '${txnDbId}' AND e.direction = 'CR'
    `);
    assertEqual("[happy] transaction balances (ΣDR == ΣCR)", dr, cr);
    assertEqual("[happy] transaction total == 500000", dr, "500000");

    assertEqual(
      "[happy] DR leg is pooled_cash[house]",
      sqlScalar(`
        SELECT a.kind || '[' || a."ownerRef" || ']'
        FROM "LedgerEntry" e JOIN "LedgerAccount" a ON a.id = e."accountId"
        WHERE e."transactionId" = '${txnDbId}' AND e.direction = 'DR'
      `),
      "pooled_cash[house]"
    );
    assertEqual(
      "[happy] CR leg is user_wallet[userId]",
      sqlScalar(`
        SELECT a.kind || '[' || a."ownerRef" || ']'
        FROM "LedgerEntry" e JOIN "LedgerAccount" a ON a.id = e."accountId"
        WHERE e."transactionId" = '${txnDbId}' AND e.direction = 'CR'
      `),
      `user_wallet[${userId}]`
    );
  }

  assertEqual(
    "[happy] one wallet.credited outbox row",
    sqlScalar(
      `SELECT COUNT(*) FROM "WebhookEventOut" WHERE "eventType" = 'wallet.credited' AND payload->>'nombaTransactionId' = '${txnId}'`
    ),
    "1"
  );
  assertEqual(
    "[happy] wallet.credited payload amountKobo == 500000",
    sqlScalar(
      `SELECT payload->>'amountKobo' FROM "WebhookEventOut" WHERE "eventType" = 'wallet.credited' AND payload->>'nombaTransactionId' = '${txnId}'`
    ),
    "500000"
  );
  assertEqual(
    "[happy] WebhookEventIn processedAt set",
    sqlScalar(
      `SELECT CASE WHEN "processedAt" IS NULL THEN 'null' ELSE 'set' END FROM "WebhookEventIn" WHERE "providerEventId" = 'vact-req-${txnId}'`
    ),
    "set"
  );

  assertGlobalInvariant("happy");
  return { accountNumber, userId, txnId };
}

async function scenarioReplay(ctx) {
  console.log("\n== scenario 2: replay same vact_transfer -> no second credit ==");
  const balanceBefore = sqlScalar(
    `SELECT "walletBalanceKobo" FROM "User" WHERE id = '${ctx.userId}'`
  );
  const creditsBefore = sqlScalar(
    `SELECT COUNT(*) FROM "WalletCredit" WHERE "nombaTransactionId" = '${ctx.txnId}'`
  );
  const ledgerBefore = sqlScalar(
    `SELECT COUNT(*) FROM "LedgerEntry" e
     JOIN "LedgerTransaction" t ON t.id = e."transactionId"
     WHERE t.kind = 'wallet_credit'`
  );

  const replay = await postVact(ctx.accountNumber, ctx.txnId);
  console.log(`replayed identical vact_transfer -> ${replay.status}`);

  await sleep(PROCESS_TIMEOUT_MS / 3);

  assertEqual(
    "[replay] still exactly one WalletCredit (layer-1 requestId dedupe)",
    sqlScalar(
      `SELECT COUNT(*) FROM "WalletCredit" WHERE "nombaTransactionId" = '${ctx.txnId}'`
    ),
    creditsBefore
  );
  assertEqual(
    "[replay] wallet balance unchanged",
    sqlScalar(`SELECT "walletBalanceKobo" FROM "User" WHERE id = '${ctx.userId}'`),
    balanceBefore
  );
  assertEqual(
    "[replay] wallet_credit ledger entries unchanged",
    sqlScalar(
      `SELECT COUNT(*) FROM "LedgerEntry" e
       JOIN "LedgerTransaction" t ON t.id = e."transactionId"
       WHERE t.kind = 'wallet_credit'`
    ),
    ledgerBefore
  );
  assertGlobalInvariant("replay");
}

async function scenarioNewTxnSameVaReplayLayer3(ctx) {
  console.log(
    "\n== scenario 3: same transactionId under a new requestId -> WalletCredit @unique blocks (layer 3) =="
  );
  const balanceBefore = sqlScalar(
    `SELECT "walletBalanceKobo" FROM "User" WHERE id = '${ctx.userId}'`
  );

  const ts = new Date().toISOString();
  const payload = buildVactBody(ctx.accountNumber, ctx.txnId, ts);
  payload.requestId = `vact-req-${ctx.txnId}-dup`;
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
  console.log(`re-posted same transactionId under new requestId -> ${res.status}`);

  await sleep(PROCESS_TIMEOUT_MS / 3);

  assertEqual(
    "[layer3] still exactly one WalletCredit for transactionId",
    sqlScalar(
      `SELECT COUNT(*) FROM "WalletCredit" WHERE "nombaTransactionId" = '${ctx.txnId}'`
    ),
    "1"
  );
  assertEqual(
    "[layer3] wallet balance unchanged after duplicate transactionId",
    sqlScalar(`SELECT "walletBalanceKobo" FROM "User" WHERE id = '${ctx.userId}'`),
    balanceBefore
  );
  assertGlobalInvariant("layer3");
}

async function scenarioUnprovisioned() {
  console.log(
    "\n== scenario 4: vact_transfer to unprovisioned NUBAN -> house suspense, no WalletCredit =="
  );
  const suspenseBefore = ledgerBalanceKobo("exceptions_suspense", "house");
  const unprovisioned = "9999999999";
  assertEqual(
    "[unmatched] target NUBAN is genuinely unprovisioned",
    sqlScalar(
      `SELECT COUNT(*) FROM "VirtualAccount" WHERE "accountNumber" = '${unprovisioned}'`
    ),
    "0"
  );

  const txnId = `vact-unmatched-${Date.now()}`;
  const posted = await postVact(unprovisioned, txnId);
  assertEqual("[unmatched] webhook accepted (fast-ack 201)", posted.status, 201);

  await poll(
    "wallet.credit_unmatched emitted",
    () => {
      const value = sqlScalar(
        `SELECT COUNT(*) FROM "WebhookEventOut" WHERE "eventType" = 'wallet.credit_unmatched' AND payload->>'nombaTransactionId' = '${txnId}'`
      );
      return { done: value === "1", value };
    },
    PROCESS_TIMEOUT_MS
  );

  assertEqual(
    "[unmatched] NO WalletCredit row written (money not yet anyone's)",
    sqlScalar(
      `SELECT COUNT(*) FROM "WalletCredit" WHERE "nombaTransactionId" = '${txnId}'`
    ),
    "0"
  );
  assertEqual(
    "[unmatched] exceptions_suspense[house] grew by 500000",
    (
      BigInt(ledgerBalanceKobo("exceptions_suspense", "house")) - BigInt(suspenseBefore)
    ).toString(),
    "500000"
  );
  assertEqual(
    "[unmatched] one wallet.credit_unmatched outbox row",
    sqlScalar(
      `SELECT COUNT(*) FROM "WebhookEventOut" WHERE "eventType" = 'wallet.credit_unmatched' AND payload->>'nombaTransactionId' = '${txnId}'`
    ),
    "1"
  );
  assertEqual(
    "[unmatched] reason UNKNOWN_ACCOUNT",
    sqlScalar(
      `SELECT payload->>'reason' FROM "WebhookEventOut" WHERE "eventType" = 'wallet.credit_unmatched' AND payload->>'nombaTransactionId' = '${txnId}'`
    ),
    "UNKNOWN_ACCOUNT"
  );
  assertEqual(
    "[unmatched] unmatched payload carries accountNumber",
    sqlScalar(
      `SELECT payload->>'accountNumber' FROM "WebhookEventOut" WHERE "eventType" = 'wallet.credit_unmatched' AND payload->>'nombaTransactionId' = '${txnId}'`
    ),
    unprovisioned
  );
  assertGlobalInvariant("unmatched");
}

async function main() {
  console.log("== Paadi vact_transfer -> wallet-credit live-e2e ==");
  console.log(`   base: ${BASE}`);
  console.log(`   db:   ${DATABASE_URL.replace(/:[^:@]+@/, ":***@")}`);
  await callOk("GET", "/docs").catch(() => {
    throw new Error(`API not reachable at ${BASE}`);
  });
  console.log(`   psql: ${sqlScalar("SELECT 1")}`);

  const ctx = await scenarioHappyPath();
  await scenarioReplay(ctx);
  await scenarioNewTxnSameVaReplayLayer3(ctx);
  await scenarioUnprovisioned();

  console.log("");
  if (failures > 0) {
    console.error(`== VACT WALLET-CREDIT E2E FAILED (${failures} assertion(s)) ==`);
    process.exit(1);
  }
  console.log("== ALL VACT WALLET-CREDIT E2E ASSERTIONS PASSED ==");
}

main().catch((e) => {
  console.error("E2E_DRIVER_ERROR", e.message);
  process.exit(1);
});
