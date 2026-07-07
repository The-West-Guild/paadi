import { SetMetadata } from "@nestjs/common";
import type { ApiKeyScope } from "@paadi/contracts";

export const REQUIRED_SCOPES = "requiredScopes";

/**
 * Allowlists a route for API-key principals. Routes without this decorator
 * are session-only (the ScopesGuard default-denies API keys). An empty call
 * — `@Scopes()` — admits any valid API key without requiring a specific scope.
 */
export const Scopes = (...scopes: ApiKeyScope[]) => SetMetadata(REQUIRED_SCOPES, scopes);
