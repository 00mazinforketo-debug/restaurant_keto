import type { NextFunction, Request, Response } from "express";
import { AUTH_COOKIE_NAMES } from "../lib/constants.js";
import { forbidden } from "../lib/errors.js";

const csrfExemptPaths = new Set(["/auth/login-pin", "/auth/refresh", "/healthz", "/readyz"]);

export const csrfMiddleware = (request: Request, _response: Response, next: NextFunction) => {
  const method = request.method.toUpperCase();
  if (["GET", "HEAD", "OPTIONS"].includes(method) || csrfExemptPaths.has(request.path)) {
    return next();
  }

  const cookieToken = request.cookies?.[AUTH_COOKIE_NAMES.csrf];
  const headerToken = request.headers["x-csrf-token"]?.toString();

  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    return next(forbidden("CSRF validation failed."));
  }

  next();
};
