import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/**
 * Wraps a successful API response as an MCP tool result. The value is always
 * returned as pretty-printed JSON text. When the tool declares an outputSchema
 * and the value is a plain object, it is also attached as `structuredContent`
 * so schema-aware clients get typed data.
 */
export function ok(result: unknown, includeStructured = false): CallToolResult {
  const content: CallToolResult["content"] = [
    { type: "text", text: JSON.stringify(result, null, 2) },
  ];
  if (
    includeStructured &&
    result !== null &&
    typeof result === "object" &&
    !Array.isArray(result)
  ) {
    return { content, structuredContent: result as Record<string, unknown> };
  }
  return { content };
}
