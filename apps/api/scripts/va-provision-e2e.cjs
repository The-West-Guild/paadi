const { execFileSync } = require("node:child_process");

const BASE = process.env.BASE_URL || "http://localhost:3010";
const DATABASE_URL =
  process.env.DATABASE_URL || "postgresql://paadi:paadi@localhost:5433/paadi";
const PSQL = process.env.PSQL_BIN || "psql";

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

async function signupVerified(role) {
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

async function main() {
  console.log("== Paadi virtual-account provisioning live-e2e ==");
  console.log(`   base: ${BASE}`);
  console.log(`   db:   ${DATABASE_URL.replace(/:[^:@]+@/, ":***@")}`);
  await callOk("GET", "/docs").catch(() => {
    throw new Error(`API not reachable at ${BASE}`);
  });
  console.log(`   psql: ${sqlScalar("SELECT 1")}`);

  const { access } = await signupVerified("vaorg");

  console.log("\n== step 1: POST /me/virtual-account -> 201 mint ==");
  const first = await call("POST", "/me/virtual-account", {}, access);
  assertEqual("[provision] first POST status", first.status, 201);
  assertMatch("[provision] NUBAN is 10-digit numeric", first.body.accountNumber, /^\d{10}$/);
  assertMatch(
    "[provision] holder name is Nomba/<legal name>",
    first.body.accountName,
    /^Nomba\/ADA OKEKE$/
  );
  assertEqual("[provision] providerBank (mock)", first.body.providerBank, "Paadi MFB");
  assertEqual("[provision] status ACTIVE", first.body.status, "ACTIVE");
  const nuban = first.body.accountNumber;

  console.log("\n== step 2: POST again -> 200 idempotent (same NUBAN) ==");
  const second = await call("POST", "/me/virtual-account", {}, access);
  assertEqual("[idempotent] second POST status", second.status, 200);
  assertEqual("[idempotent] same accountNumber", second.body.accountNumber, nuban);
  assertEqual("[idempotent] same accountName", second.body.accountName, first.body.accountName);

  console.log("\n== step 3: GET /me/virtual-account -> shows the account ==");
  const read = await call("GET", "/me/virtual-account", undefined, access);
  assertEqual("[read] GET status", read.status, 200);
  assertEqual("[read] accountNumber matches minted", read.body.accountNumber, nuban);
  assertEqual("[read] status ACTIVE", read.body.status, "ACTIVE");

  console.log("\n== step 4: db assertions (exactly one VirtualAccount row, uniques) ==");
  assertEqual(
    "[db] exactly one VirtualAccount row for this NUBAN",
    sqlScalar(
      `SELECT COUNT(*) FROM "VirtualAccount" WHERE "accountNumber" = '${nuban}'`
    ),
    "1"
  );

  const row = sqlRows(`
    SELECT "userId", "accountNumber", "accountName", "providerBank", "nombaAccountRef", status
    FROM "VirtualAccount" WHERE "accountNumber" = '${nuban}'
  `);
  let provisionedUserId = "";
  if (row.length === 1) {
    const [userId, accountNumber, accountName, providerBank, nombaAccountRef, status] = row[0];
    provisionedUserId = userId;
    assertEqual("[db] row status ACTIVE", status, "ACTIVE");
    assertEqual("[db] row accountNumber matches", accountNumber, nuban);
    assertEqual("[db] row accountName Nomba/ADA OKEKE", accountName, "Nomba/ADA OKEKE");
    assertEqual("[db] row providerBank Paadi MFB", providerBank, "Paadi MFB");
    assertMatch("[db] userId (unique) populated", userId, /.+/);
    assertMatch(
      "[db] nombaAccountRef (unique) is mock-va-va_<userId>",
      nombaAccountRef,
      new RegExp(`^mock-va-va_${userId}$`)
    );
  }

  assertEqual(
    "[db] accountNumber column is unique for this value",
    sqlScalar(
      `SELECT COUNT(DISTINCT "accountNumber") FROM "VirtualAccount" WHERE "accountNumber" = '${nuban}'`
    ),
    "1"
  );
  assertEqual(
    "[db] one distinct nombaAccountRef for this row",
    sqlScalar(
      `SELECT COUNT(DISTINCT "nombaAccountRef") FROM "VirtualAccount" WHERE "accountNumber" = '${nuban}'`
    ),
    "1"
  );
  assertEqual(
    "[db] one distinct userId for this row",
    sqlScalar(
      `SELECT COUNT(DISTINCT "userId") FROM "VirtualAccount" WHERE "accountNumber" = '${nuban}'`
    ),
    "1"
  );
  assertEqual(
    "[db] no user_wallet ledger account for this user (identity-only, no posting)",
    sqlScalar(
      `SELECT COUNT(*) FROM "LedgerAccount" WHERE kind = 'user_wallet' AND "ownerRef" = '${provisionedUserId}'`
    ),
    "0"
  );
  assertEqual(
    "[db] one virtual_account.provisioned outbox row",
    sqlScalar(
      `SELECT COUNT(*) FROM "WebhookEventOut" WHERE "eventType" = 'virtual_account.provisioned' AND payload->>'accountNumber' = '${nuban}'`
    ),
    "1"
  );

  console.log("");
  if (failures > 0) {
    console.error(`== VA PROVISION E2E FAILED (${failures} assertion(s)) ==`);
    process.exit(1);
  }
  console.log("== ALL VA PROVISION E2E ASSERTIONS PASSED ==");
}

main().catch((e) => {
  console.error("E2E_DRIVER_ERROR", e.message);
  process.exit(1);
});
