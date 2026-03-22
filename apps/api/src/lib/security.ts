import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { env } from "./env.js";

const BCRYPT_ROUNDS = 12;

export const hashPin = (pin: string) => bcrypt.hash(pin, BCRYPT_ROUNDS);
export const verifyPin = (pin: string, hash: string) => bcrypt.compare(pin, hash);

export const createPinLookup = (pin: string) =>
  crypto.createHmac("sha256", env.PIN_LOOKUP_SECRET).update(pin).digest("hex");

export const hashOpaqueToken = (token: string) =>
  crypto.createHash("sha256").update(token).digest("hex");

export const createOpaqueToken = () => crypto.randomBytes(48).toString("hex");

export const createCsrfToken = (sessionId: string) =>
  crypto.createHmac("sha256", env.CSRF_SECRET).update(sessionId).digest("hex");
