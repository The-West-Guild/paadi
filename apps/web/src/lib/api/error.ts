/**
 * Matches the documented error response union exactly:
 *   { statusCode?: number; message?: string; issues?: { path: string; message: string }[] }
 *
 * Three shapes the API actually sends:
 *  - string-message errors:    { statusCode: 401, message: "invalid credentials" }
 *  - Zod validation failures:  { message: "Validation failed", issues: [...] }  (no statusCode key, HTTP 400)
 *  - unhandled 500:            { statusCode: 500 }
 *
 * Every fixture in this folder throws ApiError so hooks.ts only ever
 * needs to handle ONE error shape, whether it's talking to a fixture
 * today or the real apiClient tomorrow.
 */
export type ApiErrorBody = {
    statusCode?: number;
    message?: string;
    issues?: { path: string; message: string }[];
  };
  
  export class ApiError extends Error {
    statusCode?: number;
    issues?: { path: string; message: string }[];
  
    constructor(body: ApiErrorBody) {
      super(body.message ?? "request failed");
      this.statusCode = body.statusCode;
      this.issues = body.issues;
    }
  }