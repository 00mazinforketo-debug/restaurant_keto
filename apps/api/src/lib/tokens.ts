import jwt from "jsonwebtoken";
import type { UserRole } from "@ros/shared";
import { env } from "./env.js";

export type AccessTokenPayload = {
  sub: string;
  role: UserRole;
  sessionId: string;
  type: "access";
};

export type RefreshTokenPayload = {
  sub: string;
  role: UserRole;
  sessionId: string;
  type: "refresh";
  rememberMe: boolean;
};

export const ACCESS_TTL_SECONDS = 60 * 15;
export const REFRESH_TTL_SECONDS = 60 * 60 * 24 * 7;
export const REFRESH_REMEMBER_ME_TTL_SECONDS = 60 * 60 * 24 * 30;

export const signAccessToken = (payload: Omit<AccessTokenPayload, "type">) =>
  jwt.sign({ ...payload, type: "access" }, env.JWT_ACCESS_SECRET, {
    expiresIn: ACCESS_TTL_SECONDS
  });

export const signRefreshToken = (payload: Omit<RefreshTokenPayload, "type">) =>
  jwt.sign({ ...payload, type: "refresh" }, env.JWT_REFRESH_SECRET, {
    expiresIn: payload.rememberMe ? REFRESH_REMEMBER_ME_TTL_SECONDS : REFRESH_TTL_SECONDS
  });

export const verifyAccessToken = (token: string) =>
  jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessTokenPayload;

export const verifyRefreshToken = (token: string) =>
  jwt.verify(token, env.JWT_REFRESH_SECRET) as RefreshTokenPayload;
