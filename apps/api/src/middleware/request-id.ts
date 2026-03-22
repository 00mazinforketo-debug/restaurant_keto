import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";

export const requestIdMiddleware = (request: Request, response: Response, next: NextFunction) => {
  request.requestId = request.headers["x-request-id"]?.toString() || crypto.randomUUID();
  response.setHeader("x-request-id", request.requestId);
  next();
};
