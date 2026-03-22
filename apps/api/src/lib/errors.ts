export class ApiError extends Error {
  statusCode: number;
  code: string;
  details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new ApiError(400, "BAD_REQUEST", message, details);

export const unauthorized = (message = "Unauthorized") =>
  new ApiError(401, "UNAUTHORIZED", message);

export const forbidden = (message = "Forbidden") =>
  new ApiError(403, "FORBIDDEN", message);

export const notFound = (message = "Not found") => new ApiError(404, "NOT_FOUND", message);

export const conflict = (message: string, details?: unknown) =>
  new ApiError(409, "CONFLICT", message, details);

export const tooManyRequests = (message: string, details?: unknown) =>
  new ApiError(429, "TOO_MANY_REQUESTS", message, details);
