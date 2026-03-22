import { v2 as cloudinary } from "cloudinary";
import { env } from "./env.js";
import { badRequest } from "./errors.js";
const isConfigured = Boolean(env.CLOUDINARY_CLOUD_NAME) &&
    Boolean(env.CLOUDINARY_API_KEY) &&
    Boolean(env.CLOUDINARY_API_SECRET);
if (isConfigured) {
    cloudinary.config({
        cloud_name: env.CLOUDINARY_CLOUD_NAME,
        api_key: env.CLOUDINARY_API_KEY,
        api_secret: env.CLOUDINARY_API_SECRET
    });
}
export const createUploadSignature = (folder) => {
    if (!isConfigured) {
        throw badRequest("Cloudinary is not configured.");
    }
    const timestamp = Math.floor(Date.now() / 1000);
    const params = { folder, timestamp };
    const signature = cloudinary.utils.api_sign_request(params, env.CLOUDINARY_API_SECRET);
    return {
        timestamp,
        signature,
        apiKey: env.CLOUDINARY_API_KEY,
        cloudName: env.CLOUDINARY_CLOUD_NAME,
        folder
    };
};
