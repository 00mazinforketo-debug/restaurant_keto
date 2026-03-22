export const ok = (response, data, message, statusCode = 200) => response.status(statusCode).json({ success: true, message, data });
export const getRequestIp = (request) => request.ip || request.headers["x-forwarded-for"]?.toString().split(",")[0]?.trim() || "unknown";
