export class ApiError extends Error {
    statusCode;
    code;
    details;
    constructor(statusCode, code, message, details) {
        super(message);
        this.statusCode = statusCode;
        this.code = code;
        this.details = details;
    }
}
export const badRequest = (message, details) => new ApiError(400, "BAD_REQUEST", message, details);
export const unauthorized = (message = "Unauthorized") => new ApiError(401, "UNAUTHORIZED", message);
export const forbidden = (message = "Forbidden") => new ApiError(403, "FORBIDDEN", message);
export const notFound = (message = "Not found") => new ApiError(404, "NOT_FOUND", message);
export const conflict = (message, details) => new ApiError(409, "CONFLICT", message, details);
export const tooManyRequests = (message, details) => new ApiError(429, "TOO_MANY_REQUESTS", message, details);
