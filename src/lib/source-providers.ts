import {
  uploadPdfToCloudinary,
  deletePdfFromCloudinary,
} from "./cloudinary.js";
import { scrapeWebsite } from "./firecrawl.js";
import { fetchYoutubeTranscript } from "./youtube.js";
import { extractPdfFromCloudinary } from "./pdf.js";
import { embedTexts } from "./openai.js";
import {
  upsertSourceVectors,
  deleteSourceVectors,
  deleteWorkspaceVectors,
  queryWorkspaceVectors,
  deleteJobVectors,
  deleteVectorIds,
} from "./pinecone.js";
export const sourceProviders = {
  uploadPdfToCloudinary,
  deletePdfFromCloudinary,
  scrapeWebsite,
  fetchYoutubeTranscript,
  extractPdfFromCloudinary,
  embedTexts,
  upsertSourceVectors,
  deleteSourceVectors,
  deleteWorkspaceVectors,
  queryWorkspaceVectors,
  deleteJobVectors,
  deleteVectorIds,
};
