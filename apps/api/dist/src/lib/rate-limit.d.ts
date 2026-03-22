export declare const redis: {
    incr: (key: string) => Promise<number>;
    pexpire: (key: string, ttl: number) => Promise<number>;
    pttl: (key: string) => Promise<number>;
    duplicate: () => unknown;
    on: (event: string, callback: (...args: unknown[]) => void) => void;
    connect: () => Promise<void>;
} | null;
export type RateLimitResult = {
    allowed: boolean;
    remaining: number;
    retryAfterMs: number;
};
export declare class RateLimiter {
    private readonly prefix;
    private readonly limit;
    private readonly windowMs;
    constructor(prefix: string, limit: number, windowMs: number);
    consume(key: string): Promise<RateLimitResult>;
}
