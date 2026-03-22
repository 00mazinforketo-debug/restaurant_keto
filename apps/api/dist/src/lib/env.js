import { z } from "zod";
const envSchema = z.object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().default(4000),
    WEB_ORIGIN: z.string().url(),
    API_ORIGIN: z.string().url(),
    COOKIE_DOMAIN: z.string().min(1),
    DATABASE_URL: z.string().min(1),
    REDIS_URL: z.string().min(1).optional(),
    PIN_LOOKUP_SECRET: z.string().min(8),
    JWT_ACCESS_SECRET: z.string().min(16),
    JWT_REFRESH_SECRET: z.string().min(16),
    CSRF_SECRET: z.string().min(8),
    CLOUDINARY_CLOUD_NAME: z.string().optional(),
    CLOUDINARY_API_KEY: z.string().optional(),
    CLOUDINARY_API_SECRET: z.string().optional(),
    SENTRY_DSN: z.string().optional(),
    SEED_ADMIN_PIN: z.string().regex(/^\d{4}$/).default("9900"),
    SEED_CUSTOMER_PIN: z.string().regex(/^\d{4}$/).default("2000")
});
export const env = envSchema.parse(process.env);
export const isProduction = env.NODE_ENV === "production";
