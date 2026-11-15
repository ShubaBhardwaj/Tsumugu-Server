import { YoutubeTranscript } from "youtube-transcript";
import { ValidationError } from "../types/app-error.js";
import { canonicalSourceUrl } from "./source-identity.js";

export async function fetchYoutubeTranscript(url: string) {
  const videoId = canonicalSourceUrl(url, "YOUTUBE").slice("youtube:".length);

  try {
    const segments = await YoutubeTranscript.fetchTranscript(videoId);
    const content = segments
      .map((segment) => segment.text)
      .join(" ")
      .trim();

    if (!content) {
      throw new ValidationError("No transcript found for this video");
    }

    return { videoId, content };
  } catch {
    throw new ValidationError(
      "Could not fetch transcript. The video may not have captions.",
    );
  }
}
