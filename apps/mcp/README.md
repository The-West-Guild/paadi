# @paadi/mcp

A [Model Context Protocol](https://modelcontextprotocol.io) server that exposes
the Paadi API to AI agents (Claude Code, Claude Desktop, Cursor, …) as a set of
typed tools. It talks to the Paadi API with a scoped API key over Bearer auth,
runs over stdio, and lets an agent read pots and the wallet, create and manage
pots, look up billers, and — when explicitly enabled — move money.

A **pot** is a shared bill: one target amount split across contributors. See the
server's own `instructions` (surfaced to the model on connect) for the full
mental model.

## Prerequisites

- The Paadi API running and reachable (default `http://localhost:3001`).
- An API key minted for your account (see below).

## 1. Mint an API key

API keys are minted from an authenticated session — `POST /me/api-keys` — with
the scopes you want the agent to hold:

```bash
curl -X POST http://localhost:3001/me/api-keys \
  -H "authorization: Bearer <YOUR_SESSION_TOKEN>" \
  -H "content-type: application/json" \
  -d '{
    "name": "claude-code",
    "scopes": ["pots:read", "pots:write", "wallet:read", "bills:read", "activity:read", "profile:read"]
  }'
```

The response includes the plaintext `key` (e.g. `pk_test_…` or `pk_live_…`)
**once, and never again** — copy it now. The key's scopes decide which tools the
MCP server exposes.

Available scopes: `pots:read`, `pots:write`, `wallet:read`, `wallet:pay`,
`wallet:withdraw`, `bills:read`, `profile:read`, `activity:read`,
`webhooks:manage`.

## 2. Build

```bash
pnpm --filter @paadi/mcp build
```

This emits `dist/index.js`. Note its absolute path — the clients below launch it
directly with `node`.

## 3. Configure your client

### Claude Code

```bash
claude mcp add paadi \
  -e PAADI_API_KEY=pk_test_your_key \
  -e PAADI_BASE_URL=http://localhost:3001 \
  -- node /absolute/path/to/paadi/apps/mcp/dist/index.js
```

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "paadi": {
      "command": "node",
      "args": ["/absolute/path/to/paadi/apps/mcp/dist/index.js"],
      "env": {
        "PAADI_API_KEY": "pk_test_your_key",
        "PAADI_BASE_URL": "http://localhost:3001"
      }
    }
  }
}
```

### Cursor

Add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "paadi": {
      "command": "node",
      "args": ["/absolute/path/to/paadi/apps/mcp/dist/index.js"],
      "env": {
        "PAADI_API_KEY": "pk_test_your_key",
        "PAADI_BASE_URL": "http://localhost:3001"
      }
    }
  }
}
```

### Environment variables

| Variable           | Required | Default                 | Purpose                                                                 |
| ------------------ | -------- | ----------------------- | ----------------------------------------------------------------------- |
| `PAADI_API_KEY`    | yes      | —                       | Scoped API key (`pk_live_…` / `pk_test_…`). Bearer auth to the API.     |
| `PAADI_BASE_URL`   | no       | `http://localhost:3001` | Base URL of the Paadi API.                                              |
| `PAADI_MCP_SCOPES` | no       | —                       | Comma-separated scope fallback, used only if the key probe is unavailable. |
| `PAADI_PIN`        | no       | —                       | 4-digit PIN. Setting it enables the money-moving tools.                 |

See `.env.example`.

## Tools

Every amount is an **integer number of kobo** (₦1 = 100 kobo; ₦2,500 = 250000).
Never pass naira.

| Tool                         | Scope             | Safety             |
| ---------------------------- | ----------------- | ------------------ |
| `list_pots`                  | `pots:read`       | read               |
| `get_pot`                    | `pots:read`       | read               |
| `get_pot_activity`           | `pots:read`       | read               |
| `get_pot_settlement`         | `pots:read`       | read               |
| `create_pot`                 | `pots:write`      | write (idempotent) |
| `update_pot`                 | `pots:write`      | write (idempotent) |
| `cancel_pot`                 | `pots:write`      | destructive        |
| `retry_pot_settlement`       | `pots:write`      | write (idempotent) |
| `get_wallet`                 | `wallet:read`     | read               |
| `get_wallet_transactions`    | `wallet:read`     | read               |
| `get_statement`              | `wallet:read`     | read               |
| `get_withdrawal`             | `wallet:read`     | read               |
| `get_payout_accounts`        | `wallet:read`     | read               |
| `list_banks`                 | `wallet:read`     | read               |
| `pay_split_from_wallet`      | `wallet:pay`      | money — needs PIN  |
| `withdraw`                   | `wallet:withdraw` | money — needs PIN  |
| `list_electricity_providers` | `bills:read`      | read               |
| `lookup_electricity_customer`| `bills:read`      | read               |
| `list_cable_providers`       | `bills:read`      | read               |
| `list_cable_plans`           | `bills:read`      | read               |
| `lookup_cable_customer`      | `bills:read`      | read               |
| `get_activity`               | `activity:read`   | read               |
| `get_me`                     | `profile:read`    | read               |
| `get_payment_receipt`        | `pots:read`       | read               |
| `get_settlement_receipt`     | `pots:read`       | read               |
| `get_payer_view`             | _(public)_        | read               |

## Safety model

The server layers several guards so an agent can only do what you allowed:

- **Scopes gate the catalog.** On startup the server asks the API which scopes
  the key holds (`GET /me/api-keys/current`) and only registers tools the key
  can actually use. A tool that never appears can never be called. If the probe
  is unavailable it falls back to `PAADI_MCP_SCOPES`, or — if that is unset —
  runs permissively and lets the API reject anything the key cannot do.
- **`PAADI_PIN` gates the money tools.** `pay_split_from_wallet` and `withdraw`
  are only registered when a PIN is configured. Without it, the agent cannot
  move money at all. The PIN is merged into the request server-side and **never**
  appears in any tool input schema, output, log, or idempotency key.
- **Deterministic idempotency = safe retries.** Money tools derive their
  idempotency key from the tool name and arguments, so an agent that retries the
  same call with the same arguments produces the same key and the API returns the
  prior result instead of paying twice. Pass a `clientRef` to make this explicit;
  change it to intentionally repeat an action. Concurrent duplicate calls are
  also collapsed in-process.
- **The API is always the real authority.** Scope gating is a convenience; the
  API independently enforces scopes, PIN, KYC, and balances on every request.

## Development

```bash
pnpm --filter @paadi/mcp dev      # tsc --watch
pnpm --filter @paadi/mcp test     # jest
pnpm --filter @paadi/mcp inspect  # launch the MCP Inspector against the server
```

`stdout` is reserved for the MCP protocol — all diagnostics go to `stderr`.

## Troubleshooting

- **401 (key rejected).** The key is invalid, expired, or revoked. Mint a new
  one and update `PAADI_API_KEY`.
- **403 (missing scope).** The tool needs a scope your key does not hold.
  Re-issue a key that includes it. If a tool you expect is missing entirely, the
  server hid it because the key lacks its scope.
- **409 (idempotency conflict).** A `clientRef` was reused with different
  arguments. Retry with the exact same arguments to fetch the earlier result, or
  pass a new `clientRef` to repeat the action on purpose.
- **A money tool is missing.** Set `PAADI_PIN` (and ensure the key holds
  `wallet:pay` / `wallet:withdraw`).
- **Connection errors.** Check that the API is running and `PAADI_BASE_URL`
  points at it.
