import crypto from "node:crypto";
import dayjs from "dayjs";
import express from "express";
import { findFixedLoginAccountByPin, loginPinSchema } from "@ros/shared";
import { prisma } from "../lib/db.js";
import { clearAuthCookies, setAuthCookies } from "../lib/cookies.js";
import { AUTH_COOKIE_NAMES } from "../lib/constants.js";
import { unauthorized, tooManyRequests } from "../lib/errors.js";
import { getRequestIp, ok } from "../lib/http.js";
import { isSessionIdle } from "../lib/session.js";
import { mapAuthUser } from "../lib/serializers.js";
import { createCsrfToken, createPinLookup, hashOpaqueToken, hashPin, verifyPin } from "../lib/security.js";
import { ACCESS_TTL_SECONDS, REFRESH_REMEMBER_ME_TTL_SECONDS, REFRESH_TTL_SECONDS, signAccessToken, signRefreshToken, verifyRefreshToken } from "../lib/tokens.js";
import { RateLimiter } from "../lib/rate-limit.js";
import { requireAuth } from "../middleware/auth.js";
const router = express.Router();
const ipLimiter = new RateLimiter("login:ip", 10, 1000 * 60 * 10);
const pinLimiter = new RateLimiter("login:pin", 5, 1000 * 60 * 10);
router.post("/login-pin", async (request, response, next) => {
    try {
        const input = loginPinSchema.parse(request.body);
        const ip = getRequestIp(request);
        const [ipWindow, pinWindow] = await Promise.all([
            ipLimiter.consume(ip),
            pinLimiter.consume(input.pin)
        ]);
        if (!ipWindow.allowed || !pinWindow.allowed) {
            throw tooManyRequests("Too many login attempts. Please try again later.", {
                retryAfterMs: Math.max(ipWindow.retryAfterMs, pinWindow.retryAfterMs)
            });
        }
        const fixedAccount = findFixedLoginAccountByPin(input.pin);
        if (!fixedAccount) {
            throw unauthorized("Invalid PIN.");
        }
        const pinLookup = createPinLookup(input.pin);
        let user = await prisma.user.findUnique({ where: { pinLookup } });
        if (!user) {
            user = await prisma.user.create({
                data: {
                    displayName: fixedAccount.displayName,
                    role: fixedAccount.role,
                    preferredLocale: fixedAccount.preferredLocale,
                    pinHash: await hashPin(input.pin),
                    pinLookup,
                    isActive: true
                }
            });
        }
        if (!user.isActive) {
            throw unauthorized("Invalid PIN.");
        }
        const isValidPin = await verifyPin(input.pin, user.pinHash);
        if (!isValidPin) {
            throw unauthorized("Invalid PIN.");
        }
        if (user.displayName !== fixedAccount.displayName ||
            user.role !== fixedAccount.role ||
            user.preferredLocale !== fixedAccount.preferredLocale) {
            user = await prisma.user.update({
                where: { id: user.id },
                data: {
                    displayName: fixedAccount.displayName,
                    role: fixedAccount.role,
                    preferredLocale: fixedAccount.preferredLocale,
                    isActive: true
                }
            });
        }
        const sessionId = crypto.randomUUID();
        const refreshToken = signRefreshToken({
            sub: user.id,
            role: user.role,
            sessionId,
            rememberMe: input.rememberMe ?? false
        });
        const accessToken = signAccessToken({
            sub: user.id,
            role: user.role,
            sessionId
        });
        const csrfToken = createCsrfToken(sessionId);
        await prisma.$transaction(async (tx) => {
            await tx.session.create({
                data: {
                    id: sessionId,
                    userId: user.id,
                    refreshTokenHash: hashOpaqueToken(refreshToken),
                    ipAddress: ip,
                    userAgent: request.headers["user-agent"]?.toString(),
                    rememberMe: input.rememberMe ?? false,
                    lastActiveAt: new Date(),
                    expiresAt: dayjs()
                        .add(input.rememberMe ? REFRESH_REMEMBER_ME_TTL_SECONDS : REFRESH_TTL_SECONDS, "second")
                        .toDate()
                }
            });
            await tx.activityLog.create({
                data: {
                    actorUserId: user.id,
                    actorNameSnapshot: user.displayName,
                    actorRole: user.role,
                    action: "AUTH_LOGIN",
                    entityType: "Session",
                    entityId: sessionId,
                    metadata: {
                        ip,
                        rememberMe: input.rememberMe ?? false
                    }
                }
            });
        });
        setAuthCookies(response, {
            accessToken,
            refreshToken,
            csrfToken,
            rememberMe: input.rememberMe ?? false
        });
        ok(response, {
            user: mapAuthUser(user),
            csrfToken,
            accessExpiresIn: ACCESS_TTL_SECONDS
        }, "Logged in successfully.");
    }
    catch (error) {
        next(error);
    }
});
router.post("/refresh", async (request, response, next) => {
    try {
        const token = request.cookies?.[AUTH_COOKIE_NAMES.refresh];
        if (!token) {
            throw unauthorized();
        }
        const payload = verifyRefreshToken(token);
        const session = await prisma.session.findUnique({
            where: { id: payload.sessionId },
            include: { user: true }
        });
        const expiredByInactivity = Boolean(session && isSessionIdle(session.lastActiveAt));
        if (!session ||
            session.revokedAt ||
            dayjs(session.expiresAt).isBefore(dayjs()) ||
            expiredByInactivity ||
            session.userId !== payload.sub ||
            session.user.role !== payload.role ||
            !(await Promise.resolve(hashOpaqueToken(token) === session.refreshTokenHash)) ||
            !session.user.isActive) {
            if (session && !session.revokedAt) {
                await prisma.session.updateMany({
                    where: { id: session.id, revokedAt: null },
                    data: { revokedAt: new Date() }
                });
            }
            clearAuthCookies(response);
            throw unauthorized(expiredByInactivity ? "Session expired due to inactivity." : undefined);
        }
        const nextRefreshToken = signRefreshToken({
            sub: session.userId,
            role: session.user.role,
            sessionId: session.id,
            rememberMe: session.rememberMe
        });
        const accessToken = signAccessToken({
            sub: session.userId,
            role: session.user.role,
            sessionId: session.id
        });
        const csrfToken = createCsrfToken(session.id);
        await prisma.session.update({
            where: { id: session.id },
            data: {
                refreshTokenHash: hashOpaqueToken(nextRefreshToken),
                lastActiveAt: new Date(),
                expiresAt: dayjs()
                    .add(session.rememberMe ? REFRESH_REMEMBER_ME_TTL_SECONDS : REFRESH_TTL_SECONDS, "second")
                    .toDate()
            }
        });
        setAuthCookies(response, {
            accessToken,
            refreshToken: nextRefreshToken,
            csrfToken,
            rememberMe: session.rememberMe
        });
        ok(response, { user: mapAuthUser(session.user), csrfToken, accessExpiresIn: ACCESS_TTL_SECONDS });
    }
    catch (error) {
        next(error);
    }
});
router.get("/me", requireAuth, async (request, response, next) => {
    try {
        ok(response, { user: request.auth });
    }
    catch (error) {
        next(error);
    }
});
router.post("/logout", requireAuth, async (request, response, next) => {
    try {
        await prisma.$transaction(async (tx) => {
            await tx.session.updateMany({
                where: { id: request.auth.sessionId },
                data: { revokedAt: new Date() }
            });
            await tx.activityLog.create({
                data: {
                    actorUserId: request.auth.id,
                    actorNameSnapshot: request.auth.displayName,
                    actorRole: request.auth.role,
                    action: "AUTH_LOGOUT",
                    entityType: "Session",
                    entityId: request.auth.sessionId
                }
            });
        });
        clearAuthCookies(response);
        ok(response, { loggedOut: true }, "Logged out.");
    }
    catch (error) {
        next(error);
    }
});
export default router;
