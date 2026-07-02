const { execFileSync } = require("node:child_process");
const { buildSignedNombaWebhook } = require("/Users/feranmialabi/Developer/projects/nomba-paadi/apps/api/dist/integrations/nomba/dev/sign-nomba-webhook.js");

const BASE = process.env.BASE_URL || "http://localhost:3010";
const KEY = process.env.NOMBA_WEBHOOK_SIGNING_KEY || "devsecret";
const DATABASE_URL =
  process.env.DATABASE_URL || "postgresql://paadi:paadi@localhost:5433/paadi";
const PSQL = process.env.PSQL_BIN || "psql";

const CREDIT_KOBO = 1000000;
const CREDIT_NAIRA = (CREDIT_KOBO / 100).toFixed(2);
const PROCESS_TIMEOUT_MS = Number(process.env.PROCESS_TIMEOUT_MS || 45_000);
const OUTBOX_DRAIN_MS = Number(process.env.OUTBOX_DRAIN_MS || 12_000);
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
  return { status: res.status, body: json };
}

async function callOk(method, path, body, token, idem) {
  const res = await call(method, path, body, token, idem);
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

function walletSpendableKobo(userId) {
  return (-BigInt(ledgerBalanceKobo("user_wallet", userId))).toString();
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

function assertDenormReconciles(scenario, userId) {
  assertEqual(
    `[${scenario}] walletBalanceKobo denorm == balance(user_wallet)`,
    sqlScalar(`SELECT "walletBalanceKobo" FROM "User" WHERE id = '${userId}'`),
    walletSpendableKobo(userId)
  );
}

function assertTxnBalanced(scenario, txnId) {
  const dr = sqlScalar(`
    SELECT COALESCE(SUM(e."amountKobo"), 0)
    FROM "LedgerEntry" e WHERE e."transactionId" = '${txnId}' AND e.direction = 'DR'
  `);
  const cr = sqlScalar(`
    SELECT COALESCE(SUM(e."amountKobo"), 0)
    FROM "LedgerEntry" e WHERE e."transactionId" = '${txnId}' AND e.direction = 'CR'
  `);
  assertEqual(`[${scenario}] transaction balances (ΣDR == ΣCR)`, dr, cr);
  return { dr, cr };
}

function legOf(txnId, direction) {
  return sqlScalar(`
    SELECT a.kind || '[' || a."ownerRef" || ']'
    FROM "LedgerEntry" e JOIN "LedgerAccount" a ON a.id = e."accountId"
    WHERE e."transactionId" = '${txnId}' AND e.direction = '${direction}'
  `);
}

async function signup(role) {
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

async function creditWallet(access, userId, tag) {
  const accountNumber = await provisionVirtualAccount(access);
  const txnId = `wsp-credit-${tag}-${accountNumber}`;
  const posted = await postVact(accountNumber, txnId);
  assertEqual(`[setup:${tag}] credit webhook accepted (fast-ack 201)`, posted.status, 201);

  await poll(
    `${tag} WalletCredit persisted`,
    () => {
      const value = sqlScalar(
        `SELECT COUNT(*) FROM "WalletCredit" WHERE "nombaTransactionId" = '${txnId}'`
      );
      return { done: value === "1", value };
    },
    PROCESS_TIMEOUT_MS
  );
  assertEqual(
    `[setup:${tag}] wallet credited ${CREDIT_KOBO} (ledger source of truth)`,
    walletSpendableKobo(userId),
    String(CREDIT_KOBO)
  );
  assertDenormReconciles(`setup:${tag}`, userId);
  return accountNumber;
}

async function createOpenPot(access, stamp, tag, splits) {
  const total = splits.reduce((sum, s) => sum + s.shareKobo, 0);
  const potBody = {
    title: `Wallet-spend ${tag}`,
    totalKobo: total,
    settlementType: "bill_payment",
    completionRule: "progressive",
    splitMode: "amount",
    billerCategory: "electricity",
    billerProductCode: "phed",
    billerCustomerId: "45678901234",
    meterType: "PREPAID",
    splits: splits.map((s) => ({ label: s.label, amountKobo: s.shareKobo }))
  };
  const pot = await callOk("POST", "/pots", potBody, access, `${tag}-pot-${stamp}`);
  assertEqual(`[${tag}] pot created OPEN`, pot.status, "open");
  return pot;
}

async function createPayoutAccount(access) {
  const created = await callOk(
    "POST",
    "/me/payout-accounts",
    { bankCode: "058", accountNumber: "0123456789", pin: "1357" },
    access
  );
  assertEqual("[setup] payout account name-match verified", created.nameMatchVerified, true);
  assertEqual("[setup] first payout account is primary", created.isPrimary, true);
  return created;
}

async function scenarioPayFromWallet() {
  console.log(
    "\n== scenario A: pay a split from wallet -> DR user_wallet / CR pot_liability, pooled_cash unchanged =="
  );
  const { access, stamp, userId } = await signup("wsppayer");
  await creditWallet(access, userId, "pay");

  const payShare = 250000;
  const pot = await createOpenPot(access, stamp, "pay", [
    { label: "Ada", shareKobo: payShare },
    { label: "Tobi", shareKobo: payShare },
    { label: "J", shareKobo: payShare }
  ]);
  const split = pot.splits[0];
  assertEqual("[pay] target split starts pending", split.status, "pending");

  const pooledBefore = ledgerBalanceKobo("pooled_cash", "house");
  const walletBefore = walletSpendableKobo(userId);
  const potLiabBefore = ledgerBalanceKobo("pot_liability", pot.id);

  const idem = `wsp-pay-${stamp}`;
  const detail = await callOk(
    "POST",
    "/me/wallet/pay",
    { potId: pot.id, splitId: split.id },
    access,
    idem
  );

  const paid = detail.splits.find((s) => s.id === split.id);
  assertEqual("[pay] response split advanced to paid", paid.status, "paid");
  assertEqual("[pay] response split paidKobo == share", paid.paidKobo, payShare);
  assertEqual("[pay] response pot collectedKobo == share", detail.progress.collectedKobo, payShare);

  assertEqual(
    "[pay] exactly one Payment(method=WALLET, wallet: ref) for this idempotency-key",
    sqlScalar(
      `SELECT COUNT(*) FROM "Payment" WHERE "nombaTransactionId" = 'wallet:${idem}' AND method = 'WALLET'`
    ),
    "1"
  );
  assertEqual(
    "[pay] Payment.splitId == target split",
    sqlScalar(`SELECT "splitId" FROM "Payment" WHERE "nombaTransactionId" = 'wallet:${idem}'`),
    split.id
  );
  assertEqual(
    "[pay] Payment.status succeeded",
    sqlScalar(`SELECT status FROM "Payment" WHERE "nombaTransactionId" = 'wallet:${idem}'`),
    "succeeded"
  );

  const txn = sqlRows(`
    SELECT t.id, t.kind
    FROM "LedgerTransaction" t
    WHERE t.kind = 'wallet_contribution'
      AND EXISTS (
        SELECT 1 FROM "LedgerEntry" e
        JOIN "LedgerAccount" a ON a.id = e."accountId"
        WHERE e."transactionId" = t.id AND a.kind = 'pot_liability' AND a."ownerRef" = '${pot.id}'
      )
    ORDER BY t."createdAt" DESC LIMIT 1
  `);
  assertEqual("[pay] exactly one wallet_contribution LedgerTransaction for pot", txn.length, 1);
  if (txn.length === 1) {
    const txnId = txn[0][0];
    const { dr } = assertTxnBalanced("pay", txnId);
    assertEqual("[pay] contribution total == share", dr, String(payShare));
    assertEqual("[pay] DR leg is user_wallet[payer]", legOf(txnId, "DR"), `user_wallet[${userId}]`);
    assertEqual("[pay] CR leg is pot_liability[pot]", legOf(txnId, "CR"), `pot_liability[${pot.id}]`);
  }

  assertEqual(
    "[pay] pooled_cash[house] UNCHANGED (no external cash moved; internal claim transfer)",
    ledgerBalanceKobo("pooled_cash", "house"),
    pooledBefore
  );
  assertEqual(
    "[pay] user_wallet[payer] drawn down by the share",
    (BigInt(walletBefore) - BigInt(walletSpendableKobo(userId))).toString(),
    String(payShare)
  );
  assertEqual(
    "[pay] pot_liability[pot] grew by the share",
    (BigInt(ledgerBalanceKobo("pot_liability", pot.id)) - BigInt(potLiabBefore)).toString(),
    String(payShare)
  );
  assertEqual(
    "[pay] DB Split.status advanced to PAID",
    sqlScalar(`SELECT status FROM "Split" WHERE id = '${split.id}'`),
    "PAID"
  );
  assertEqual(
    "[pay] walletBalanceKobo denorm down to remaining",
    sqlScalar(`SELECT "walletBalanceKobo" FROM "User" WHERE id = '${userId}'`),
    String(CREDIT_KOBO - payShare)
  );
  assertDenormReconciles("pay", userId);

  await sleep(OUTBOX_DRAIN_MS);
  assertEqual(
    "[pay] one payment.succeeded outbox row for this split",
    sqlScalar(
      `SELECT COUNT(*) FROM "WebhookEventOut" WHERE "eventType" = 'payment.succeeded' AND payload->>'splitId' = '${split.id}'`
    ),
    "1"
  );
  assertEqual(
    "[pay] one wallet.debited(split_payment) outbox row for payer",
    sqlScalar(
      `SELECT COUNT(*) FROM "WebhookEventOut" WHERE "eventType" = 'wallet.debited' AND payload->>'userId' = '${userId}' AND payload->>'reason' = 'split_payment' AND payload->>'potId' = '${pot.id}'`
    ),
    "1"
  );
  assertGlobalInvariant("pay");

  return { access, stamp, userId, pot, remainingKobo: CREDIT_KOBO - payShare };
}

async function scenarioDoubleSpend(ctx) {
  console.log(
    "\n== scenario B: two concurrent pay-from-wallet for the remaining balance -> exactly one 402, wallet never negative =="
  );
  const remaining = ctx.remainingKobo;
  assertTrue("[double] carried remaining balance > 0", remaining > 0, String(remaining));
  assertEqual(
    "[double] ledger remaining balance matches carried remaining",
    walletSpendableKobo(ctx.userId),
    String(remaining)
  );

  const contentedShare = remaining;
  const pot = await createOpenPot(ctx.access, ctx.stamp, "double", [
    { label: "RaceA", shareKobo: contentedShare },
    { label: "RaceB", shareKobo: contentedShare }
  ]);
  const [splitA, splitB] = pot.splits;

  const walletBefore = walletSpendableKobo(ctx.userId);
  const paymentsBefore = sqlScalar(
    `SELECT COUNT(*) FROM "Payment" WHERE method = 'WALLET' AND "potId" = '${pot.id}'`
  );

  const [ra, rb] = await Promise.all([
    call(
      "POST",
      "/me/wallet/pay",
      { potId: pot.id, splitId: splitA.id },
      ctx.access,
      `wsp-race-a-${ctx.stamp}`
    ),
    call(
      "POST",
      "/me/wallet/pay",
      { potId: pot.id, splitId: splitB.id },
      ctx.access,
      `wsp-race-b-${ctx.stamp}`
    )
  ]);

  const statuses = [ra.status, rb.status].sort((x, y) => x - y);
  const okCount = statuses.filter((s) => s < 400).length;
  const paymentRequiredCount = statuses.filter((s) => s === 402).length;
  assertEqual("[double] exactly one request succeeded (2xx)", okCount, 1);
  assertEqual("[double] exactly one request rejected 402", paymentRequiredCount, 1);
  const rejected = ra.status === 402 ? ra : rb;
  assertMatch(
    "[double] 402 body 'insufficient wallet balance'",
    JSON.stringify(rejected.body),
    /insufficient wallet balance/
  );

  assertEqual(
    "[double] exactly one new WALLET Payment posted (loser debited nothing)",
    sqlScalar(`SELECT COUNT(*) FROM "Payment" WHERE method = 'WALLET' AND "potId" = '${pot.id}'`),
    "1"
  );
  assertEqual(
    "[double] wallet drawn down by exactly the remaining balance (single debit)",
    (BigInt(walletBefore) - BigInt(walletSpendableKobo(ctx.userId))).toString(),
    String(remaining)
  );
  assertEqual(
    "[double] wallet balance is now exactly 0 (never negative)",
    walletSpendableKobo(ctx.userId),
    "0"
  );
  assertTrue(
    "[double] wallet balance never went negative",
    BigInt(walletSpendableKobo(ctx.userId)) >= 0n,
    walletSpendableKobo(ctx.userId)
  );
  assertEqual(
    "[double] walletBalanceKobo denorm floored at 0",
    sqlScalar(`SELECT "walletBalanceKobo" FROM "User" WHERE id = '${ctx.userId}'`),
    "0"
  );
  assertDenormReconciles("double", ctx.userId);
  assertEqual(
    "[double] exactly one split of the race pair advanced to PAID",
    sqlScalar(
      `SELECT COUNT(*) FROM "Split" WHERE "potId" = '${pot.id}' AND status = 'PAID'`
    ),
    "1"
  );
  assertGlobalInvariant("double");

  void paymentsBefore;
}

async function scenarioWithdraw() {
  console.log(
    "\n== scenario C: withdraw to bank -> stage-1 hold, mock transfer wd: ref, confirm clears (pooled_cash down) =="
  );
  const { access, stamp, userId } = await signup("wspwd");
  grantTier1(userId);
  await creditWallet(access, userId, "wd");
  const account = await createPayoutAccount(access);

  const amountKobo = 600000;
  const pooledBefore = ledgerBalanceKobo("pooled_cash", "house");
  const walletBefore = walletSpendableKobo(userId);
  const payoutTransitBefore = ledgerBalanceKobo("settlement_payout", "house");

  const idem = `wsp-wd-${stamp}`;
  const view = await callOk(
    "POST",
    "/me/wallet/withdraw",
    { amountKobo, pin: "1357" },
    access,
    idem
  );

  assertEqual("[withdraw] response amountKobo echoes request", view.amountKobo, amountKobo);
  assertEqual("[withdraw] response feeKobo == 0 (MVP 0 bps)", view.feeKobo, 0);
  assertEqual("[withdraw] response destination bank name", view.destination.bankName, account.bankName);
  assertEqual(
    "[withdraw] response destination last4",
    view.destination.accountNumberLast4,
    account.accountNumberLast4
  );
  assertEqual(
    "[withdraw] mock transfer completes synchronously -> status completed",
    view.status,
    "completed"
  );
  assertEqual(
    "[withdraw] nombaRef carries the wd: merchantTxRef echo",
    view.nombaRef,
    `mock-transfer-wd:${idem}`
  );

  const wRow = sqlRows(`
    SELECT id, status, "merchantTxRef", "nombaRef", "amountKobo", "feeKobo"
    FROM "Withdrawal" WHERE "merchantTxRef" = 'wd:${idem}'
  `);
  assertEqual("[withdraw] exactly one Withdrawal row for this idempotency-key", wRow.length, 1);
  let withdrawalId = "";
  if (wRow.length === 1) {
    const [id, status, merchantTxRef, nombaRef, amount] = wRow[0];
    withdrawalId = id;
    assertEqual("[withdraw] Withdrawal.status COMPLETED", status, "COMPLETED");
    assertEqual("[withdraw] Withdrawal.merchantTxRef == wd:<key>", merchantTxRef, `wd:${idem}`);
    assertEqual("[withdraw] Withdrawal.nombaRef == mock echo", nombaRef, `mock-transfer-wd:${idem}`);
    assertEqual("[withdraw] Withdrawal.amountKobo == request", amount, String(amountKobo));
  }

  const stage1 = sqlRows(`
    SELECT t.id FROM "LedgerTransaction" t
    WHERE t.kind = 'withdrawal'
      AND EXISTS (
        SELECT 1 FROM "LedgerEntry" e JOIN "LedgerAccount" a ON a.id = e."accountId"
        WHERE e."transactionId" = t.id AND a.kind = 'user_wallet' AND a."ownerRef" = '${userId}'
      )
    ORDER BY t."createdAt" DESC LIMIT 1
  `);
  assertEqual("[withdraw] stage-1 withdrawal LedgerTransaction exists (the hold)", stage1.length, 1);
  if (stage1.length === 1) {
    const txnId = stage1[0][0];
    const { dr } = assertTxnBalanced("withdraw-hold", txnId);
    assertEqual("[withdraw] stage-1 total == amount", dr, String(amountKobo));
    assertEqual(
      "[withdraw] stage-1 DR leg is user_wallet[user]",
      legOf(txnId, "DR"),
      `user_wallet[${userId}]`
    );
    assertEqual(
      "[withdraw] stage-1 CR leg is settlement_payout[house]",
      legOf(txnId, "CR"),
      "settlement_payout[house]"
    );
  }

  const stage2 = sqlRows(`
    SELECT t.id FROM "LedgerTransaction" t
    WHERE t.kind = 'withdrawal_cleared'
      AND EXISTS (
        SELECT 1 FROM "LedgerEntry" e JOIN "LedgerAccount" a ON a.id = e."accountId"
        WHERE e."transactionId" = t.id AND a.kind = 'settlement_payout' AND a."ownerRef" = 'house'
      )
    ORDER BY t."createdAt" DESC LIMIT 1
  `);
  assertEqual("[withdraw] stage-2 withdrawal_cleared LedgerTransaction exists (confirm)", stage2.length, 1);
  if (stage2.length === 1) {
    const txnId = stage2[0][0];
    const { dr } = assertTxnBalanced("withdraw-cleared", txnId);
    assertEqual("[withdraw] stage-2 total == amount", dr, String(amountKobo));
    assertEqual(
      "[withdraw] stage-2 DR leg is settlement_payout[house]",
      legOf(txnId, "DR"),
      "settlement_payout[house]"
    );
    assertEqual(
      "[withdraw] stage-2 CR leg is pooled_cash[house]",
      legOf(txnId, "CR"),
      "pooled_cash[house]"
    );
  }

  assertEqual(
    "[withdraw] settlement_payout[house] transit net unchanged (stage-1 + stage-2 cancel)",
    ledgerBalanceKobo("settlement_payout", "house"),
    payoutTransitBefore
  );
  assertEqual(
    "[withdraw] pooled_cash[house] down by amount (real cash left on confirm)",
    (BigInt(pooledBefore) - BigInt(ledgerBalanceKobo("pooled_cash", "house"))).toString(),
    String(amountKobo)
  );
  assertEqual(
    "[withdraw] user_wallet[user] down by amount",
    (BigInt(walletBefore) - BigInt(walletSpendableKobo(userId))).toString(),
    String(amountKobo)
  );
  assertEqual(
    "[withdraw] walletBalanceKobo denorm == remaining after withdraw",
    sqlScalar(`SELECT "walletBalanceKobo" FROM "User" WHERE id = '${userId}'`),
    String(CREDIT_KOBO - amountKobo)
  );
  assertDenormReconciles("withdraw", userId);

  const receipt = await callOk("GET", `/me/wallet/withdrawals/${withdrawalId}`, null, access);
  assertEqual("[withdraw] GET receipt status completed", receipt.status, "completed");
  assertEqual("[withdraw] GET receipt amountKobo", receipt.amountKobo, amountKobo);

  await sleep(OUTBOX_DRAIN_MS);
  assertEqual(
    "[withdraw] one withdrawal.completed outbox row",
    sqlScalar(
      `SELECT COUNT(*) FROM "WebhookEventOut" WHERE "eventType" = 'withdrawal.completed' AND payload->>'withdrawalId' = '${withdrawalId}'`
    ),
    "1"
  );
  assertEqual(
    "[withdraw] one wallet.debited(withdrawal) outbox row",
    sqlScalar(
      `SELECT COUNT(*) FROM "WebhookEventOut" WHERE "eventType" = 'wallet.debited' AND payload->>'withdrawalId' = '${withdrawalId}' AND payload->>'reason' = 'withdrawal'`
    ),
    "1"
  );
  assertGlobalInvariant("withdraw");

  return { access, stamp, userId, idem, withdrawalId, amountKobo, account };
}

async function scenarioWithdrawReplay(ctx) {
  console.log(
    "\n== scenario D: replay withdraw with the same Idempotency-Key -> no second debit / no second transfer =="
  );
  const withdrawalsBefore = sqlScalar(
    `SELECT COUNT(*) FROM "Withdrawal" WHERE "userId" = '${ctx.userId}'`
  );
  const clearedTxnBefore = sqlScalar(
    `SELECT COUNT(*) FROM "LedgerTransaction" t
     JOIN "LedgerEntry" e ON e."transactionId" = t.id
     JOIN "LedgerAccount" a ON a.id = e."accountId"
     WHERE t.kind = 'withdrawal_cleared' AND a.kind = 'user_wallet' AND a."ownerRef" = '${ctx.userId}'`
  );
  const walletBefore = walletSpendableKobo(ctx.userId);
  const pooledBefore = ledgerBalanceKobo("pooled_cash", "house");
  const denormBefore = sqlScalar(`SELECT "walletBalanceKobo" FROM "User" WHERE id = '${ctx.userId}'`);

  const replay = await call(
    "POST",
    "/me/wallet/withdraw",
    { amountKobo: ctx.amountKobo, pin: "1357" },
    ctx.access,
    ctx.idem
  );
  console.log(`replayed withdraw with same idempotency-key -> ${replay.status}`);
  assertTrue("[replay] replay resolves without a 5xx", replay.status < 500, String(replay.status));
  if (replay.status < 400) {
    assertEqual("[replay] replay returns the same withdrawalId", replay.body.id, ctx.withdrawalId);
  }

  assertEqual(
    "[replay] still exactly one Withdrawal for the user (merchantTxRef @unique)",
    sqlScalar(`SELECT COUNT(*) FROM "Withdrawal" WHERE "userId" = '${ctx.userId}'`),
    withdrawalsBefore
  );
  assertEqual(
    "[replay] no second withdrawal_cleared ledger transaction",
    sqlScalar(
      `SELECT COUNT(*) FROM "LedgerTransaction" t
       JOIN "LedgerEntry" e ON e."transactionId" = t.id
       JOIN "LedgerAccount" a ON a.id = e."accountId"
       WHERE t.kind = 'withdrawal_cleared' AND a.kind = 'user_wallet' AND a."ownerRef" = '${ctx.userId}'`
    ),
    clearedTxnBefore
  );
  assertEqual(
    "[replay] wallet balance unchanged (no second debit)",
    walletSpendableKobo(ctx.userId),
    walletBefore
  );
  assertEqual(
    "[replay] pooled_cash unchanged (no second transfer cleared)",
    ledgerBalanceKobo("pooled_cash", "house"),
    pooledBefore
  );
  assertEqual(
    "[replay] walletBalanceKobo denorm unchanged",
    sqlScalar(`SELECT "walletBalanceKobo" FROM "User" WHERE id = '${ctx.userId}'`),
    denormBefore
  );
  assertDenormReconciles("replay", ctx.userId);
  assertGlobalInvariant("replay");
}

async function main() {
  console.log("== Paadi wallet spend & withdraw live-e2e (Chunk 10) ==");
  console.log(`   base: ${BASE}`);
  console.log(`   db:   ${DATABASE_URL.replace(/:[^:@]+@/, ":***@")}`);
  await callOk("GET", "/docs").catch(() => {
    throw new Error(`API not reachable at ${BASE}`);
  });
  console.log(`   psql: ${sqlScalar("SELECT 1")}`);

  const payCtx = await scenarioPayFromWallet();
  await scenarioDoubleSpend(payCtx);
  const wdCtx = await scenarioWithdraw();
  await scenarioWithdrawReplay(wdCtx);

  console.log("");
  if (failures > 0) {
    console.error(`== WALLET SPEND/WITHDRAW E2E FAILED (${failures} assertion(s)) ==`);
    process.exit(1);
  }
  console.log("== ALL WALLET SPEND/WITHDRAW E2E ASSERTIONS PASSED ==");
}

main().catch((e) => {
  console.error("E2E_DRIVER_ERROR", e.message);
  process.exit(1);
});
