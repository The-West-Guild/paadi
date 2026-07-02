import { OutboxMessage } from "../outbox/outbox";

export abstract class OutboxRepository {
  abstract enqueue(message: OutboxMessage): Promise<void>;
  abstract pending(limit: number): Promise<OutboxMessage[]>;
  abstract markDispatched(id: string): Promise<void>;
  abstract markFailed(id: string, nextAttemptAt: string): Promise<void>;
}
