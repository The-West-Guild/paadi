import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Redis from "ioredis";

@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client: Redis;

  constructor(config: ConfigService) {
    this.client = new Redis(config.get<string>("redisUrl") ?? "redis://localhost:6379", {
      maxRetriesPerRequest: null
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }

  setex(key: string, ttlSeconds: number, value: string): Promise<"OK"> {
    return this.client.set(key, value, "EX", ttlSeconds);
  }

  get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  getdel(key: string): Promise<string | null> {
    return this.client.getdel(key);
  }

  del(key: string): Promise<number> {
    return this.client.del(key);
  }

  incr(key: string): Promise<number> {
    return this.client.incr(key);
  }

  expire(key: string, ttlSeconds: number): Promise<number> {
    return this.client.expire(key, ttlSeconds);
  }

  ttl(key: string): Promise<number> {
    return this.client.ttl(key);
  }
}
