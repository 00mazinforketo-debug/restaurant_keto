import dayjs from "dayjs";
import { forbidden, unauthorized } from "../lib/errors.js";
import { prisma } from "../lib/db.js";
import { isSessionIdle, shouldTouchSession } from "../lib/session.js";
import { mapAuthUser } from "../lib/serializers.js";
import { verifyAccessToken } from "../lib/tokens.js";
export const requireAuth = async (request, _response, next) => {
    try {
        const token = request.cookies?.ros_access;
        if (!token) {
            throw unauthorized();
        }
        const payload = verifyAccessToken(token);
        const [user, session] = await Promise.all([
            prisma.user.findUnique({ where: { id: payload.sub } }),
            prisma.session.findUnique({ where: { id: payload.sessionId } })
        ]);
        if (!user ||
            !user.isActive ||
            !session ||
            session.userId !== user.id ||
            session.revokedAt ||
            dayjs(session.expiresAt).isBefore(dayjs()) ||
            isSessionIdle(session.lastActiveAt)) {
            if (session && !session.revokedAt) {
                await prisma.session.updateMany({
                    where: { id: session.id, revokedAt: null },
                    data: { revokedAt: new Date() }
                });
            }
            throw unauthorized();
        }
        if (shouldTouchSession(session.lastActiveAt)) {
            await prisma.session.update({
                where: { id: session.id },
                data: { lastActiveAt: new Date() }
            });
        }
        request.auth = {
            ...mapAuthUser(user),
            sessionId: payload.sessionId
        };
        next();
    }
    catch (_error) {
        next(unauthorized());
    }
};
export const requireRole = (...roles) => {
    return (request, _response, next) => {
        if (!request.auth) {
            return next(unauthorized());
        }
        if (!roles.includes(request.auth.role)) {
            return next(forbidden());
        }
        next();
    };
};
