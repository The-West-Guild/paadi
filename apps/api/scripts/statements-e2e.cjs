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
function assertTrue(name, condition, detail) {
  if (condition) {
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

function ledgerRowCounts() {
  return {
    payment: sqlScalar(`SELECT COUNT(*) FROM "Payment"`),
    settlement: sqlScalar(`SELECT COUNT(*) FROM "Settlement"`),
    ledgerEntry: sqlScalar(`SELECT COUNT(*) FROM "LedgerEntry"`),
    ledgerTxn: sqlScalar(`SELECT COUNT(*) FROM "LedgerTransaction"`),
    walletCredit: sqlScalar(`SELECT COUNT(*) FROM "WalletCredit"`)
  };
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

async function assertAdminGate() {
  console.log("\n== admin gate: non-admin -> 403, missing bearer -> 401 ==");
  const stranger = await signupTier1("stmtstranger");
  const strangerRes = await call("GET", "/admin/reconciliation/report", null, stranger.access);
  assertEqual("[gate] non-allowlisted user forbidden on report", strangerRes.status, 403);
  assertMatch("[gate] 403 message 'admin only'", JSON.stringify(strangerRes.body), /admin only/);

  const noAuth = await call("GET", "/admin/reconciliation/report", null, null);
  assertEqual("[gate] missing bearer unauthorized", noAuth.status, 401);
}

async function resolveAdminAccess() {
  const admin = await signupTier1("stmtadmin");
  console.log(`\n   admin user id: ${admin.userId}`);
  console.log(`   ${ADMIN_ENV} (boot allowlist): [${ALLOWLIST.join(", ") || "<empty>"}]`);

  const probe = await call("GET", "/admin/reconciliation/report", null, admin.access);
  if (probe.status === 200) {
    pass("[gate] admin caller reaches the report (200)");
    return admin;
  }

  console.error("");
  console.error("   >>> ADMIN GUARD BLOCKED THE CALLER (fail-closed by design, chunk-8 §4.5 / chunk-9 §7).");
  console.error("   >>> The AdminGuard reads PAADI_ADMIN_USER_IDS from config at BOOT time, so a");
  console.error("   >>> runtime-created admin is not on the allowlist until the API is restarted with it.");
  console.error("   >>> Two-phase boot to run the report assertions:");
  console.error("   >>>");
  console.error(`   >>>     export ${ADMIN_ENV}=${admin.userId}`);
  console.error("   >>>     # restart the API, then re-run this driver (it mints a fresh admin id).");
  console.error("   >>>");
  console.error("   >>> Because signup mints a random uuid, the deterministic loop is: run once to");
  console.error("   >>> print an id, export it, restart, re-run. Alternatively point the driver at a");
  console.error("   >>> pre-seeded admin whose id is already in the boot allowlist.");
  fail("[gate] admin caller reaches the report", `got ${probe.status} ${JSON.stringify(probe.body)}`);
  return null;
}

async function scenarioStatements(admin) {
  console.log("\n== scenario: VA credit -> wallet balance + statement + activity + reconciliation ==");
  const org = await signupTier1("stmtorg");
  grantTier1(org.userId);
  const accountNumber = await provisionVirtualAccount(org.access);

  assertEqual(
    "[pre] wallet balance is zero before any credit",
    ledgerBalanceKobo("user_wallet", org.userId),
    "0"
  );
  const emptyWallet = await callOk("GET", "/me/wallet", null, org.access);
  assertEqual("[pre] GET /me/wallet balanceKobo 0 before credit", emptyWallet.balanceKobo, 0);

  const txnId = `stmt-vact-${accountNumber}`;
  const posted = await postVact(accountNumber, txnId);
  assertEqual("[credit] webhook accepted (fast-ack 201)", posted.status, 201);

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
    "[credit] user_wallet ledger balance == 500000 (source of truth)",
    ledgerBalanceKobo("user_wallet", org.userId),
    "500000"
  );
  assertGlobalInvariant("post-credit");

  const before = ledgerRowCounts();
  console.log(
    `\n   read-only snapshot (before reads): payments=${before.payment} settlements=${before.settlement} ` +
      `entries=${before.ledgerEntry} txns=${before.ledgerTxn} walletCredits=${before.walletCredit}`
  );

  console.log("\n-- GET /me/wallet --");
  const wallet = await callOk("GET", "/me/wallet", null, org.access);
  assertEqual("[wallet] balanceKobo == credit (CR-normal, positive)", wallet.balanceKobo, CREDIT_KOBO);
  assertEqual("[wallet] currency NGN", wallet.currency, "NGN");
  assertMatch("[wallet] asOf is ISO datetime", wallet.asOf, /^\d{4}-\d{2}-\d{2}T/);
  assertTrue("[wallet] virtualAccount header present", Boolean(wallet.virtualAccount), "va header");
  if (wallet.virtualAccount) {
    assertEqual(
      "[wallet] virtualAccount.accountNumber matches provisioned NUBAN",
      wallet.virtualAccount.accountNumber,
      accountNumber
    );
    assertEqual("[wallet] virtualAccount.status ACTIVE", wallet.virtualAccount.status, "ACTIVE");
  }
  assertEqual(
    "[wallet] balanceKobo agrees with direct ledger SQL",
    wallet.balanceKobo,
    ledgerBalanceKobo("user_wallet", org.userId)
  );

  console.log("\n-- GET /me/wallet/transactions --");
  const stmt = await callOk("GET", "/me/wallet/transactions", null, org.access);
  assertEqual("[stmt] exactly one transaction row", stmt.items.length, 1);
  assertEqual("[stmt] envelope balanceKobo == credit", stmt.balanceKobo, CREDIT_KOBO);
  assertEqual("[stmt] nextCursor null (single page)", stmt.nextCursor, "null");
  if (stmt.items.length >= 1) {
    const row = stmt.items[0];
    assertEqual("[stmt] row.kind va_credit", row.kind, "va_credit");
    assertEqual("[stmt] row.direction credit (CR-normal money in)", row.direction, "credit");
    assertEqual("[stmt] row.amountKobo == +credit (signed positive)", row.amountKobo, CREDIT_KOBO);
    assertEqual("[stmt] row.potId null (wallet VA credit)", row.potId ?? "null", "null");
    assertMatch("[stmt] row.description names the credit", row.description, /^Received /);
    assertMatch("[stmt] row.occurredAt ISO datetime", row.occurredAt, /^\d{4}-\d{2}-\d{2}T/);
  }

  console.log("\n-- GET /me/statement (alias) --");
  const alias = await callOk("GET", "/me/statement", null, org.access);
  assertEqual("[alias] alias returns same row count", alias.items.length, stmt.items.length);
  assertEqual("[alias] alias balanceKobo matches", alias.balanceKobo, stmt.balanceKobo);
  if (alias.items.length >= 1 && stmt.items.length >= 1) {
    assertEqual("[alias] alias row id matches canonical", alias.items[0].id, stmt.items[0].id);
    assertEqual("[alias] alias row amountKobo matches canonical", alias.items[0].amountKobo, stmt.items[0].amountKobo);
  }

  console.log("\n-- GET /me/activity --");
  const activity = await callOk("GET", "/me/activity", null, org.access);
  assertTrue("[activity] feed has at least one item", activity.items.length >= 1, `count=${activity.items.length}`);
  const walletItem = activity.items.find((item) => item.type === "wallet_credit");
  assertTrue("[activity] wallet_credit item present", Boolean(walletItem), "wallet_credit");
  if (walletItem) {
    assertEqual("[activity] wallet_credit amountKobo == +credit", walletItem.amountKobo, CREDIT_KOBO);
    assertMatch("[activity] wallet_credit headline names the credit", walletItem.headline, /Received .* to your wallet/);
    assertMatch("[activity] wallet_credit occurredAt ISO datetime", walletItem.occurredAt, /^\d{4}-\d{2}-\d{2}T/);
  }
  let ordered = true;
  for (let i = 1; i < activity.items.length; i += 1) {
    if (Date.parse(activity.items[i - 1].occurredAt) < Date.parse(activity.items[i].occurredAt)) {
      ordered = false;
      break;
    }
  }
  assertTrue("[activity] items are newest-first (occurredAt DESC)", ordered);

  console.log("\n-- GET /admin/reconciliation/report --");
  const report = await callOk("GET", "/admin/reconciliation/report", null, admin.access);
  assertEqual("[report] balanced true (internal invariant holds)", report.balanced, true);
  assertEqual("[report] internalDriftKobo 0 (ΣDR==ΣCR, kinds signed correctly)", report.internalDriftKobo, 0);
  assertEqual(
    "[report] pooledCashKobo == sumLiabilitiesKobo",
    report.pooledCashKobo,
    report.sumLiabilitiesKobo
  );
  assertEqual("[report] currency NGN", report.currency, "NGN");
  assertTrue(
    "[report] breakdown.userWalletKobo includes this credit (>= 500000)",
    Number(report.breakdown.userWalletKobo) >= CREDIT_KOBO,
    `userWalletKobo=${report.breakdown.userWalletKobo}`
  );
  assertTrue("[report] counts.wallets >= 1", Number(report.counts.wallets) >= 1, `wallets=${report.counts.wallets}`);
  assertEqual(
    "[report] pooledCashKobo agrees with direct ledger SQL",
    report.pooledCashKobo,
    ledgerBalanceKobo("pooled_cash", "house")
  );
  if (report.external === "unavailable") {
    pass("[report] external cross-check unavailable (degraded, informational)");
  } else {
    assertTrue(
      "[report] external cross-check present (mock deterministic balance)",
      typeof report.external.nombaKobo === "number",
      `nombaKobo=${report.external.nombaKobo}`
    );
    assertEqual(
      "[report] externalDriftKobo == pooledCash - nombaKobo (informational, not a failure)",
      report.external.externalDriftKobo,
      report.pooledCashKobo - report.external.nombaKobo
    );
  }

  console.log("\n-- READ-ONLY PROOF: row counts unchanged after every read --");
  const after = ledgerRowCounts();
  assertEqual("[read-only] Payment count unchanged", after.payment, before.payment);
  assertEqual("[read-only] Settlement count unchanged", after.settlement, before.settlement);
  assertEqual("[read-only] LedgerEntry count unchanged", after.ledgerEntry, before.ledgerEntry);
  assertEqual("[read-only] LedgerTransaction count unchanged", after.ledgerTxn, before.ledgerTxn);
  assertEqual("[read-only] WalletCredit count unchanged", after.walletCredit, before.walletCredit);
  assertGlobalInvariant("post-reads");

  return { org, accountNumber, txnId };
}

async function scenarioSelfScoping() {
  console.log("\n== scenario: self-scoping -> a second user never sees the org's wallet ==");
  const other = await signupTier1("stmtother");
  const otherWallet = await callOk("GET", "/me/wallet", null, other.access);
  assertEqual("[scope] other user's wallet balanceKobo 0", otherWallet.balanceKobo, 0);
  assertEqual("[scope] other user has no VA header yet", otherWallet.virtualAccount ?? "null", "null");
  const otherStmt = await callOk("GET", "/me/wallet/transactions", null, other.access);
  assertEqual("[scope] other user's statement empty", otherStmt.items.length, 0);
  assertEqual("[scope] other user's statement balanceKobo 0", otherStmt.balanceKobo, 0);
  const otherActivity = await callOk("GET", "/me/activity", null, other.access);
  assertEqual("[scope] other user's activity empty", otherActivity.items.length, 0);
}

async function main() {
  console.log("== Paadi statements & reporting live-e2e (Chunk 9, read-only) ==");
  console.log(`   base: ${BASE}`);
  console.log(`   db:   ${DATABASE_URL.replace(/:[^:@]+@/, ":***@")}`);
  await call("GET", "/docs").catch(() => {
    throw new Error(`API not reachable at ${BASE}`);
  });
  console.log(`   psql: ${sqlScalar("SELECT 1")}`);

  await assertAdminGate();

  const admin = await resolveAdminAccess();
  if (!admin) {
    console.error("");
    console.error("== STATEMENTS E2E ABORTED: admin caller not on the boot allowlist ==");
    console.error("== (fix per instructions above, then re-run) ==");
    process.exit(1);
  }

  await scenarioStatements(admin);
  await scenarioSelfScoping();

  console.log("");
  if (failures > 0) {
    console.error(`== STATEMENTS E2E FAILED (${failures} assertion(s)) ==`);
    process.exit(1);
  }
  console.log("== ALL STATEMENTS E2E ASSERTIONS PASSED ==");
}

main().catch((e) => {
  console.error("E2E_DRIVER_ERROR", e.message);
  process.exit(1);
});
