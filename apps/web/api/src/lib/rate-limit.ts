import Redis from "ioredis";
import { env } from "./env.js";

const memoryStore = new Map<string, { count: number; expiresAt: number }>();
const RedisClient = Redis as unknown as new (url: string, options?: Record<string, unknown>) => {
  incr: (key: string) => Promise<number>;
  pexpire: (key: string, ttl: number) => Promise<number>;
  pttl: (key: string) => Promise<number>;
  duplicate: () => unknown;
  on: (event: string, callback: (...args: unknown[]) => void) => void;
  connect: () => Promise<void>;
};

export const redis = (() => {
  if (!env.REDIS_URL) return null;

  const client = new RedisClient(env.REDIS_URL, { lazyConnect: true });
  client.on("error", () => {
    // Swallow redis connection errors so the app can still run in environments
    // where Redis is not available (e.g., demo/local development).
  });

  void client.connect().catch(() => {
    // Ignore connection failures and fall back to in-memory rate limiting.
  });

  return client;
})();

export type RateLimitResult = { allowed: boolean; remaining: number; retryAfterMs: number };

export class RateLimiter {
  constructor(private readonly prefix: string, private readonly limit: number, private readonly windowMs: number) {}
  async consume(key: string): Promise<RateLimitResult> {
    const scopedKey = `${this.prefix}:${key}`;
    if (redis) {
      const count = await redis.incr(scopedKey);
      if (count === 1) await redis.pexpire(scopedKey, this.windowMs);
      const ttl = await redis.pttl(scopedKey);
      return { allowed: count <= this.limit, remaining: Math.max(0, this.limit - count), retryAfterMs: ttl > 0 ? ttl : this.windowMs };
    }
    const now = Date.now();
    const current = memoryStore.get(scopedKey);
    if (!current || current.expiresAt <= now) {
      memoryStore.set(scopedKey, { count: 1, expiresAt: now + this.windowMs });
      return { allowed: true, remaining: this.limit - 1, retryAfterMs: this.windowMs };
    }
    current.count += 1;
    memoryStore.set(scopedKey, current);
    return { allowed: current.count <= this.limit, remaining: Math.max(0, this.limit - current.count), retryAfterMs: current.expiresAt - now };
  }
}
