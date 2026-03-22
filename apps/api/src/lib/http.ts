import type { Request, Response } from "express";

export const ok = <T>(response: Response, data: T, message?: string, statusCode = 200) =>
  response.status(statusCode).json({ success: true, message, data });

export const getRequestIp = (request: Request) =>
  request.ip || request.headers["x-forwarded-for"]?.toString().split(",")[0]?.trim() || "unknown";
