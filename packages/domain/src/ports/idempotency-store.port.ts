import { IdempotencyRecord } from "../idempotency/idempotency";

export abstract class IdempotencyStore {
  abstract remember(record: IdempotencyRecord): Promise<boolean>;
  abstract seen(key: string): Promise<boolean>;
  abstract getResult(
    key: string,
  ): Promise<{ requestHash: string; response?: unknown } | null>;
}
