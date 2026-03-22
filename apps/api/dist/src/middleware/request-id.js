import crypto from "node:crypto";
export const requestIdMiddleware = (request, response, next) => {
    request.requestId = request.headers["x-request-id"]?.toString() || crypto.randomUUID();
    response.setHeader("x-request-id", request.requestId);
    next();
};
