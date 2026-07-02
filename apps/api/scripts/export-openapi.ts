import "reflect-metadata";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { config as loadEnv } from "dotenv";

const ENV_PATH = resolve(__dirname, "../.env");
if (existsSync(ENV_PATH)) {
  loadEnv({ path: ENV_PATH });
}

import { NestFactory } from "@nestjs/core";
import { SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "../src/app.module";
import { buildOpenApiConfig } from "../src/common/swagger/openapi.config";
import { toOpenApi30 } from "../src/common/swagger/zod-api";

const OUTPUT_PATH = resolve(__dirname, "../../../docs/api/openapi.json");

function sortDeep(node: unknown): unknown {
  if (Array.isArray(node)) {
    return node.map(sortDeep);
  }
  if (node && typeof node === "object") {
    const source = node as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      sorted[key] = sortDeep(source[key]);
    }
    return sorted;
  }
  return node;
}

async function main(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    abortOnError: false,
    logger: false
  });

  const document = SwaggerModule.createDocument(app, buildOpenApiConfig());
  const normalized = sortDeep(toOpenApi30(document));

  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");

  await app.close();
  process.stdout.write(`wrote ${OUTPUT_PATH}\n`);
}

void main();
