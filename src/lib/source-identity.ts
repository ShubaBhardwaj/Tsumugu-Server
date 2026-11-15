import { createHash } from "node:crypto";
import { ValidationError } from "../types/app-error.js";

export const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

/** Matches mobile study-url.ts; no fetching, tracking-parameter stripping or query sorting. */
export function canonicalSourceUrl(input: string, type: "WEBSITE" | "YOUTUBE") {
  let url: URL;
  try { url = new URL(input.trim()); }
  catch { throw new ValidationError("Enter a complete HTTP or HTTPS URL"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || !url.hostname)
    throw new ValidationError("Use an HTTP or HTTPS URL without account credentials");
  if (type === "WEBSITE") return url.href;
  let videoId: string | null = null;
  if (url.hostname === "youtu.be") videoId = url.pathname.match(/^\/([\w-]{11})\/?$/)?.[1] ?? null;
  else if (["youtube.com", "www.youtube.com", "m.youtube.com"].includes(url.hostname))
    videoId = url.pathname === "/watch" ? url.searchParams.get("v") : url.pathname.match(/^\/(?:shorts|embed)\/([\w-]{11})\/?$/)?.[1] ?? null;
  if (!videoId || !/^[\w-]{11}$/.test(videoId))
    throw new ValidationError("Enter a YouTube watch, shorts, embed, or youtu.be video URL");
  return `youtube:${videoId}`;
}

export function urlContentRevision(type: "WEBSITE" | "YOUTUBE", url: string, refreshGeneration = 0) {
  return sha256(`${type}\n${canonicalSourceUrl(url, type)}\n${refreshGeneration}`);
}
