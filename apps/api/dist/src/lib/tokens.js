import jwt from "jsonwebtoken";
import { env } from "./env.js";
export const ACCESS_TTL_SECONDS = 60 * 15;
export const REFRESH_TTL_SECONDS = 60 * 60 * 24 * 7;
export const REFRESH_REMEMBER_ME_TTL_SECONDS = 60 * 60 * 24 * 30;
export const signAccessToken = (payload) => jwt.sign({ ...payload, type: "access" }, env.JWT_ACCESS_SECRET, {
    expiresIn: ACCESS_TTL_SECONDS
});
export const signRefreshToken = (payload) => jwt.sign({ ...payload, type: "refresh" }, env.JWT_REFRESH_SECRET, {
    expiresIn: payload.rememberMe ? REFRESH_REMEMBER_ME_TTL_SECONDS : REFRESH_TTL_SECONDS
});
export const verifyAccessToken = (token) => jwt.verify(token, env.JWT_ACCESS_SECRET);
export const verifyRefreshToken = (token) => jwt.verify(token, env.JWT_REFRESH_SECRET);
