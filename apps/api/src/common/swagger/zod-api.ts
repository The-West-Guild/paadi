import { applyDecorators } from "@nestjs/common";
import { ApiBody, ApiResponse } from "@nestjs/swagger";
import { SchemaObject } from "@nestjs/swagger/dist/interfaces/open-api-spec.interface";
import { generateSchema } from "@anatine/zod-openapi";
import { ZodType } from "zod";

export function toOpenApi30(node: unknown): unknown {
  if (Array.isArray(node)) {
    return node.map(toOpenApi30);
  }
  if (node && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key === "type" && Array.isArray(value)) {
        const types = value.filter((type) => type !== "null");
        if (value.includes("null")) {
          out.nullable = true;
        }
        out.type = types[0];
      } else {
        out[key] = toOpenApi30(value);
      }
    }
    return out;
  }
  return node;
}

function toSchema(schema: ZodType): SchemaObject {
  return toOpenApi30(generateSchema(schema)) as SchemaObject;
}

export function ApiZodBody(schema: ZodType) {
  return ApiBody({ schema: toSchema(schema) });
}

export function ApiZodResponse(status: number, schema: ZodType, description?: string) {
  return ApiResponse({ status, description, schema: toSchema(schema) });
}

export function ApiZod(options: { body?: ZodType; response?: ZodType; status?: number; description?: string }) {
  return applyDecorators(
    ...(options.body ? [ApiZodBody(options.body)] : []),
    ...(options.response ? [ApiZodResponse(options.status ?? 200, options.response, options.description)] : [])
  );
}
