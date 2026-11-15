import { v2 as cloudinary } from "cloudinary";
import { ValidationError } from "../types/app-error.js";

const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
const uploadPreset = process.env.CLOUDINARY_UPLOAD_PRESET ?? "dt2jgaj48";
const apiKey = process.env.CLOUDINARY_API_KEY;
const apiSecret = process.env.CLOUDINARY_API_SECRET;

/** Normalized result returned after a successful Cloudinary upload. */
export type CloudinaryUploadResult = {
  secureUrl: string;
  publicId: string;
  bytes: number;
  originalFilename: string;
  resourceType: "raw" | "image";
};

type CloudinaryUploadResponse = {
  secure_url: string;
  public_id: string;
  bytes: number;
  resource_type?: string;
  error?: { message: string };
};

export function getSignedCloudinaryDownloadUrl(
  publicId: string,
  resourceType: "raw" | "image" = "raw",
) {
  if (!cloudName || !apiKey || !apiSecret) {
    return null;
  }

  cloudinary.config({
    cloud_name: cloudName,
    api_key: apiKey,
    api_secret: apiSecret,
    secure: true,
  });

  return cloudinary.url(publicId, {
    resource_type: resourceType,
    type: "upload",
    sign_url: true,
    secure: true,
  });
}

/**
 * Uploads a PDF buffer to Cloudinary using an unsigned upload preset.
 *
 * @param buffer - PDF file bytes from Multer
 * @param filename - Original filename (used in the multipart form)
 * @returns Upload metadata including secure URL and public id
 * @throws {ValidationError} When Cloudinary is not configured or upload is rejected
 *
 */
export async function uploadPdfToCloudinary(
  buffer: Buffer,
  filename: string,
  representationTarget?: string,
): Promise<CloudinaryUploadResult> {
  if (!cloudName) {
    throw new ValidationError("Cloudinary is not configured on the server");
  }

  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array(buffer)], { type: "application/pdf" }),
    filename,
  );
  if (representationTarget) {
    if (!apiKey || !apiSecret)
      throw new ValidationError("Recoverable PDF uploads are not configured");
    const params = { public_id: representationTarget, overwrite: false, timestamp: Math.floor(Date.now() / 1000) };
    for (const [key, value] of Object.entries(params)) form.append(key, String(value));
    form.append("api_key", apiKey);
    form.append("signature", cloudinary.utils.api_sign_request(params, apiSecret));
  } else {
    form.append("upload_preset", uploadPreset);
    form.append("folder", "tsumugu/pdfs");
  }

  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${cloudName}/raw/upload`,
    { method: "POST", body: form, signal: AbortSignal.timeout(30000) },
  );

  const result = (await response.json()) as CloudinaryUploadResponse;

  if (!response.ok) {
    if (representationTarget) throw new ValidationError("PDF upload failed. Retry with a new operation key.");
    const message =
      result.error?.message ?? `Cloudinary upload failed (${response.status})`;

    if (response.status === 403) {
      throw new ValidationError(
        "Cloudinary rejected the upload. Check CLOUDINARY_UPLOAD_PRESET in server/.env matches an unsigned preset in your dashboard.",
      );
    }

    throw new ValidationError(message);
  }

  if (representationTarget && result.public_id !== representationTarget)
    throw new ValidationError("PDF representation could not be verified");

  return {
    secureUrl: result.secure_url,
    publicId: result.public_id,
    bytes: result.bytes,
    originalFilename: filename,
    resourceType: result.resource_type === "image" ? "image" : "raw",
  };
}

export async function deletePdfFromCloudinary(
  publicId: string,
  resourceType: "raw" | "image" = "raw",
) {
  if (!cloudName || !apiKey || !apiSecret)
    throw new ValidationError("PDF cleanup is not configured");
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = cloudinary.utils.api_sign_request(
    { public_id: publicId, timestamp },
    apiSecret,
  );
  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/destroy`,
    {
      method: "POST",
      signal: AbortSignal.timeout(30000),
      body: new URLSearchParams({
        public_id: publicId,
        api_key: apiKey,
        timestamp: String(timestamp),
        signature,
      }),
    },
  );
  const result = (await response.json()) as { result?: string };
  if (!response.ok || !["ok", "not found"].includes(result.result ?? ""))
    throw new Error("PDF cleanup failed");
}
