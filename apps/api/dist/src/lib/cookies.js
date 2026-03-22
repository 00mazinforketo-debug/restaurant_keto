import { AUTH_COOKIE_NAMES } from "./constants.js";
import { env, isProduction } from "./env.js";
const createCookieOptions = (maxAgeMs, httpOnly = true) => ({
    domain: env.COOKIE_DOMAIN === "localhost" ? undefined : env.COOKIE_DOMAIN,
    httpOnly,
    sameSite: "lax",
    secure: isProduction,
    maxAge: maxAgeMs,
    path: "/"
});
export const setAuthCookies = (response, values) => {
    response.cookie(AUTH_COOKIE_NAMES.access, values.accessToken, createCookieOptions(1000 * 60 * 15));
    response.cookie(AUTH_COOKIE_NAMES.refresh, values.refreshToken, createCookieOptions(values.rememberMe ? 1000 * 60 * 60 * 24 * 30 : 1000 * 60 * 60 * 24 * 7));
    response.cookie(AUTH_COOKIE_NAMES.csrf, values.csrfToken, createCookieOptions(1000 * 60 * 60 * 24 * 30, false));
};
export const clearAuthCookies = (response) => {
    response.clearCookie(AUTH_COOKIE_NAMES.access, createCookieOptions(0));
    response.clearCookie(AUTH_COOKIE_NAMES.refresh, createCookieOptions(0));
    response.clearCookie(AUTH_COOKIE_NAMES.csrf, createCookieOptions(0, false));
};
export const readCookie = (request, name) => request.cookies?.[name];
