const { execFileSync } = require("node:child_process");
const { buildSignedNombaWebhook } = require("/Users/feranmialabi/Developer/projects/nomba-paadi/apps/api/dist/integrations/nomba/dev/sign-nomba-webhook.js");

const BASE = process.env.BASE_URL || "http://localhost:3010";
const KEY = process.env.NOMBA_WEBHOOK_SIGNING_KEY || "devsecret";
const DATABASE_URL =
  process.env.DATABASE_URL || "postgresql://paadi:paadi@localhost:5433/paadi";
const PSQL = process.env.PSQL_BIN || "psql";

const OUTBOX_DRAIN_MS = 10_000;
const DEADLINE_SWEEP_MS = 60_000;
const SETTLE_TIMEOUT_MS = Number(process.env.SETTLE_TIMEOUT_MS || 45_000);
const REFUND_TIMEOUT_MS = Number(process.env.REFUND_TIMEOUT_MS || 150_000);
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

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function call(method, path, body, token, idem) {
  const headers = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  if (idem) headers["idempotency-key"] = idem;
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
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text}`);
  return json;
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
  let last = "";
  while (Date.now() - started < timeoutMs) {
    last = predicate();
    if (last.done) return last.value;
    await sleep(POLL_EVERY_MS);
  }
  throw new Error(`timeout waiting for ${label} (last=${last.value})`);
}

async function signupTier0(role) {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const phone = `+23480${String(Math.floor(Math.random() * 1e8))
    .padStart(8, "0")
    .slice(0, 8)}`;
  const start = await call("POST", "/auth/signup/start", { phone });
  const onb = start.onboardingToken;
  await call("POST", "/auth/signup/verify-phone", {
    onboardingToken: onb,
    code: "000000"
  });
  await call("POST", "/auth/signup/profile", {
    onboardingToken: onb,
    firstName: "Ada",
    lastName: "Okeke"
  });
  await call("POST", "/auth/signup/username", {
    onboardingToken: onb,
    username: `${role}${stamp}`
  });
  await call("POST", "/auth/signup/password", {
    onboardingToken: onb,
    password: `Sup3rSecret!${stamp}`
  });
  const pinResp = await call("POST", "/auth/signup/pin", {
    onboardingToken: onb,
    pin: "1357"
  });
  return { access: pinResp.accessToken, stamp };
}

async function upgradeToTier1(access) {
  await call("POST", "/me/kyc/bvn", { bvn: "12345678901" }, access);
  const selfie = await call(
    "POST",
    "/me/kyc/selfie",
    { image: "data:image/png;base64,bW9jay1zZWxmaWU=" },
    access
  );
  return selfie;
}

async function fundSplit(split, amountKobo) {
  const ts = new Date().toISOString();
  const naira = (amountKobo / 100).toFixed(2);
  const txnId = `set-txn-${split.id}`;
  const payload = {
    event_type: "payment_success",
    requestId: `set-req-${split.id}`,
    data: {
      merchant: { userId: "mock-user", walletId: "mock-wallet" },
      transaction: {
        transactionId: txnId,
        type: "online_checkout",
        time: ts,
        responseCode: "00",
        transactionAmount: naira,
        merchantTxRef: `paadi-${split.id}`
      },
      order: {
        orderReference: `paadi-${split.id}`,
        amount: naira,
        paymentMethod: "card_payment"
      }
    }
  };
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
  return { status: res.status, txnId };
}

async function fundToTarget(pot) {
  for (const split of pot.splits) {
    const r = await fundSplit(split, Number(split.shareKobo));
    if (r.status !== 201) {
      fail(`fund split ${split.id}`, `webhook status ${r.status}`);
    }
  }
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

async function scenarioBillPayment() {
  console.log("\n== scenario 1: bill_payment electricity -> SETTLED + vendToken ==");
  const { access, stamp } = await signupTier0("billorg");
  const potBody = {
    title: "June NEPA - Flat 3B",
    totalKobo: 900000,
    settlementType: "bill_payment",
    completionRule: "progressive",
    billerCategory: "electricity",
    billerProductCode: "phed",
    billerCustomerId: "45678901234",
    meterType: "PREPAID",
    splits: [
      { label: "Ada", weight: 1 },
      { label: "Tobi", weight: 1 },
      { label: "J", weight: 1 }
    ]
  };
  const pot = await call("POST", "/pots", potBody, access, `billpot-${stamp}`);
  console.log(`created bill pot ${pot.id} total=${pot.totalKobo}`);
  await fundToTarget(pot);

  const status = await poll(
    "bill pot SETTLED",
    () => {
      const value = sqlScalar(
        `SELECT status FROM "Pot" WHERE id = '${pot.id}'`
      );
      return { done: value === "SETTLED", value };
    },
    SETTLE_TIMEOUT_MS
  );
  assertEqual("[bill] pot status", status, "SETTLED");

  const row = sqlRows(`
    SELECT status, type, "vendToken", "vendUnits", "amountKobo"
    FROM "Settlement" WHERE "potId" = '${pot.id}'
  `);
  assertEqual("[bill] exactly one Settlement row", row.length, 1);
  if (row.length === 1) {
    const [sStatus, sType, vendToken, vendUnits, amountKobo] = row[0];
    assertEqual("[bill] settlement status", sStatus, "COMPLETED");
    assertEqual("[bill] settlement type", sType, "BILL_PAYMENT");
    assertEqual("[bill] settlement amountKobo", amountKobo, "900000");
    assertEqual(
      "[bill] vendToken captured (mock MOCK-1234-5678)",
      vendToken,
      "MOCK-1234-5678"
    );
    assertEqual("[bill] vendUnits captured", vendUnits, "23.5");
  }

  assertEqual(
    "[bill] pot_liability drawn to zero",
    ledgerBalanceKobo("pot_liability", pot.id),
    "0"
  );
  assertEqual(
    "[bill] settlement_payout transit net zero (synchronous vend cleared)",
    ledgerBalanceKobo("settlement_payout", "house"),
    "0"
  );
  assertEqual(
    "[bill] one pool.settled outbox row",
    sqlScalar(
      `SELECT COUNT(*) FROM "WebhookEventOut" WHERE "eventType" = 'pool.settled' AND payload->>'potId' = '${pot.id}'`
    ),
    "1"
  );
  assertGlobalInvariant("bill");
  return pot.id;
}

async function scenarioBankPayout() {
  console.log("\n== scenario 2: bank_payout (tier-1) -> SETTLED ==");
  const { access, stamp } = await signupTier0("bankorg");
  const upgraded = await upgradeToTier1(access);
  assertEqual("[bank] kyc upgrade tier", upgraded.tier, "TIER_1");
  await call(
    "POST",
    "/me/payout-accounts",
    { bankCode: "058", accountNumber: "0123456789", pin: "1357" },
    access
  );

  const potBody = {
    title: "Flat rent - landlord",
    totalKobo: 600000,
    settlementType: "bank_payout",
    completionRule: "all_or_nothing",
    splits: [
      { label: "Ada", weight: 1 },
      { label: "Tobi", weight: 1 }
    ]
  };
  const pot = await call("POST", "/pots", potBody, access, `bankpot-${stamp}`);
  console.log(`created bank pot ${pot.id} total=${pot.totalKobo}`);
  await fundToTarget(pot);

  const status = await poll(
    "bank pot SETTLED",
    () => {
      const value = sqlScalar(
        `SELECT status FROM "Pot" WHERE id = '${pot.id}'`
      );
      return { done: value === "SETTLED", value };
    },
    SETTLE_TIMEOUT_MS
  );
  assertEqual("[bank] pot status", status, "SETTLED");

  const row = sqlRows(`
    SELECT status, type, "vendToken", "nombaRef"
    FROM "Settlement" WHERE "potId" = '${pot.id}'
  `);
  assertEqual("[bank] exactly one Settlement row", row.length, 1);
  if (row.length === 1) {
    const [sStatus, sType, vendToken, nombaRef] = row[0];
    assertEqual("[bank] settlement status", sStatus, "COMPLETED");
    assertEqual("[bank] settlement type", sType, "BANK_PAYOUT");
    assertEqual("[bank] no vendToken on bank payout", vendToken, "");
    assertEqual("[bank] nombaRef captured", nombaRef.length > 0, "true");
  }

  assertEqual(
    "[bank] pot_liability drawn to zero",
    ledgerBalanceKobo("pot_liability", pot.id),
    "0"
  );
  assertEqual(
    "[bank] settlement_payout transit net zero (mock 200 success -> both stages)",
    ledgerBalanceKobo("settlement_payout", "house"),
    "0"
  );
  assertEqual(
    "[bank] one pool.settled outbox row",
    sqlScalar(
      `SELECT COUNT(*) FROM "WebhookEventOut" WHERE "eventType" = 'pool.settled' AND payload->>'potId' = '${pot.id}'`
    ),
    "1"
  );
  assertGlobalInvariant("bank");
  return pot.id;
}

async function scenarioRefundAll() {
  console.log(
    "\n== scenario 3: all_or_nothing past deadline, under target -> REFUNDED =="
  );
  const { access, stamp } = await signupTier0("reforg");
  const future = new Date(Date.now() + 3_600_000).toISOString();
  const potBody = {
    title: "Squad trip fund",
    totalKobo: 900000,
    settlementType: "bill_payment",
    completionRule: "all_or_nothing",
    billerCategory: "electricity",
    billerProductCode: "phed",
    billerCustomerId: "45678901234",
    meterType: "PREPAID",
    deadlineAt: future,
    splits: [
      { label: "Ada", weight: 1 },
      { label: "Tobi", weight: 1 },
      { label: "J", weight: 1 }
    ]
  };
  const pot = await call("POST", "/pots", potBody, access, `refpot-${stamp}`);
  console.log(`created all_or_nothing pot ${pot.id} total=${pot.totalKobo}`);

  const firstSplit = pot.splits[0];
  const funded = await fundSplit(firstSplit, Number(firstSplit.shareKobo));
  assertEqual("[refund] one split funded (under target)", funded.status, 201);

  await poll(
    "partial collection recorded",
    () => {
      const value = sqlScalar(
        `SELECT "collectedKobo" FROM "Pot" WHERE id = '${pot.id}'`
      );
      return { done: value === String(firstSplit.shareKobo), value };
    },
    SETTLE_TIMEOUT_MS
  );
  assertEqual(
    "[refund] pot still OPEN (target not met)",
    sqlScalar(`SELECT status FROM "Pot" WHERE id = '${pot.id}'`),
    "OPEN"
  );

  const backdated = sqlScalar(`
    UPDATE "Pot" SET "deadlineAt" = now() - interval '1 hour'
    WHERE id = '${pot.id}' RETURNING "deadlineAt"
  `);
  console.log(`backdated deadlineAt -> ${backdated}`);

  const status = await poll(
    "pot REFUNDED via deadline sweep",
    () => {
      const value = sqlScalar(
        `SELECT status FROM "Pot" WHERE id = '${pot.id}'`
      );
      return { done: value === "REFUNDED", value };
    },
    REFUND_TIMEOUT_MS
  );
  assertEqual("[refund] pot status", status, "REFUNDED");

  const refundRows = sqlRows(`
    SELECT status, "amountKobo", "nombaRef"
    FROM "Refund" WHERE "potId" = '${pot.id}'
  `);
  assertEqual("[refund] one Refund row per funded payment", refundRows.length, 1);
  if (refundRows.length === 1) {
    const [rStatus, rAmount] = refundRows[0];
    assertEqual("[refund] refund status", rStatus, "COMPLETED");
    assertEqual(
      "[refund] refund amount == funded share",
      rAmount,
      String(firstSplit.shareKobo)
    );
  }

  assertEqual(
    "[refund] pot_liability drawn to zero",
    ledgerBalanceKobo("pot_liability", pot.id),
    "0"
  );
  assertEqual(
    "[refund] refunds_payable transit net zero",
    ledgerBalanceKobo("refunds_payable", pot.id),
    "0"
  );
  assertEqual(
    "[refund] one pool.refunded outbox row",
    sqlScalar(
      `SELECT COUNT(*) FROM "WebhookEventOut" WHERE "eventType" = 'pool.refunded' AND payload->>'potId' = '${pot.id}'`
    ),
    "1"
  );
  assertGlobalInvariant("refund");
  return { potId: pot.id };
}

async function scenarioIdempotentReplay(billPotId, refundCtx) {
  console.log(
    "\n== scenario 4: replay settlement + refund webhook/job -> no second row =="
  );
  const settlementsBefore = sqlScalar(
    `SELECT COUNT(*) FROM "Settlement" WHERE "potId" = '${billPotId}'`
  );
  const ledgerBefore = sqlScalar(
    `SELECT COUNT(*) FROM "LedgerEntry" e JOIN "LedgerTransaction" t ON t.id = e."transactionId"`
  );

  const billSplits = sqlRows(
    `SELECT id, "shareKobo" FROM "Split" WHERE "potId" = '${billPotId}' ORDER BY id LIMIT 1`
  );
  if (billSplits.length === 1) {
    const replay = await fundSplit(
      { id: billSplits[0][0] },
      Number(billSplits[0][1])
    );
    console.log(`replayed funding webhook on settled bill pot -> ${replay.status}`);
  }

  await sleep(OUTBOX_DRAIN_MS + 5_000);

  assertEqual(
    "[replay] still exactly one Settlement for bill pot",
    sqlScalar(`SELECT COUNT(*) FROM "Settlement" WHERE "potId" = '${billPotId}'`),
    settlementsBefore
  );
  assertEqual(
    "[replay] bill pot still SETTLED",
    sqlScalar(`SELECT status FROM "Pot" WHERE id = '${billPotId}'`),
    "SETTLED"
  );
  assertEqual(
    "[replay] still exactly one Refund for refund pot",
    sqlScalar(`SELECT COUNT(*) FROM "Refund" WHERE "potId" = '${refundCtx.potId}'`),
    "1"
  );
  assertEqual(
    "[replay] refund pot still REFUNDED",
    sqlScalar(`SELECT status FROM "Pot" WHERE id = '${refundCtx.potId}'`),
    "REFUNDED"
  );
  assertEqual(
    "[replay] ledger entries unchanged",
    sqlScalar(
      `SELECT COUNT(*) FROM "LedgerEntry" e JOIN "LedgerTransaction" t ON t.id = e."transactionId"`
    ),
    ledgerBefore
  );
}

async function main() {
  console.log("== Paadi settlement live-e2e ==");
  console.log(`   base: ${BASE}`);
  console.log(`   db:   ${DATABASE_URL.replace(/:[^:@]+@/, ":***@")}`);
  await call("GET", "/docs").catch(() => {
    throw new Error(`API not reachable at ${BASE}`);
  });
  console.log(`   psql: ${sqlScalar("SELECT 1")}`);

  const billPotId = await scenarioBillPayment();
  await scenarioBankPayout();
  const refundCtx = await scenarioRefundAll();
  await scenarioIdempotentReplay(billPotId, refundCtx);

  console.log("");
  if (failures > 0) {
    console.error(`== SETTLEMENT E2E FAILED (${failures} assertion(s)) ==`);
    process.exit(1);
  }
  console.log("== ALL SETTLEMENT E2E ASSERTIONS PASSED ==");
}

main().catch((e) => {
  console.error("E2E_DRIVER_ERROR", e.message);
  process.exit(1);
});
