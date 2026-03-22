process.env.NODE_ENV = "test";
process.env.WEB_ORIGIN = process.env.WEB_ORIGIN || "http://localhost:5173";
process.env.API_ORIGIN = process.env.API_ORIGIN || "http://localhost:4000";
process.env.COOKIE_DOMAIN = process.env.COOKIE_DOMAIN || "localhost";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/test?schema=public";
process.env.PIN_LOOKUP_SECRET = process.env.PIN_LOOKUP_SECRET || "test-secret-123";
process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || "test-access-secret-123456";
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || "test-refresh-secret-123456";
process.env.CSRF_SECRET = process.env.CSRF_SECRET || "test-csrf-secret";
