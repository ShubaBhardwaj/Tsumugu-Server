import type { NextFunction, Request, Response } from "express";
import multer from "multer";
import { ZodError } from "zod";
import { AppError } from "../types/app-error.js";
import { getZodFieldErrors } from "../utils/zod-error.js";

export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (error instanceof AppError) {
    if (error.retryAfter) res.setHeader("Retry-After", error.retryAfter);
    res.status(error.statusCode).json({
      error: error.message,
      ...(error.code ? { code: error.code } : {}),
      ...(error.details ? { details: error.details } : {}),
    });
    return;
  }

  if (error instanceof ZodError) {
    res.status(400).json({
      error: "Validation failed",
      details: getZodFieldErrors(error),
    });
    return;
  }

  if (error instanceof multer.MulterError) {
    res.status(400).json({ error: error.message });
    return;
  }

  if (
    error instanceof Error &&
    error.message === "Only PDF files are allowed"
  ) {
    res.status(400).json({ error: error.message });
    return;
  }

  const cloudinaryError = error as Error & {
    http_code?: number;
    name?: string;
  };
  if (
    cloudinaryError.name === "UnexpectedResponse" &&
    cloudinaryError.http_code === 403
  ) {
    res.status(400).json({
      error:
        "Cloudinary upload rejected: your API key is missing Upload (create) permission. In Cloudinary Dashboard → Settings → API Keys, use the root secret or create a key with Upload enabled.",
    });
    return;
  }

  const httpError = error as { status?: number; type?: string };
  if (httpError.status === 413) {
    res.status(413).json({ error: "Request exceeds 256 KiB" });
    return;
  }
  if (httpError.type === "entity.parse.failed") {
    res.status(400).json({ error: "Invalid JSON" });
    return;
  }
  if (res.headersSent) {
    res.end();
    return;
  }
  console.error("Request failed");
  res.status(500).json({ error: "Internal server error" });
}
