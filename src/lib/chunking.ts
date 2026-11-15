import { CHUNK_SIZE, CHUNK_OVERLAP } from "./ai-config.js";
export type TextChunk = {
  index: number;
  content: string;
  metadata?: Record<string, unknown>;
};
const SEPARATORS = ["\n\n", "\n", ". ", " ", ""];
function splitBounded(text: string, size: number, depth = 0): string[] {
  if (text.length <= size) return [text];
  const separator = SEPARATORS[depth] ?? "";
  if (!separator)
    return Array.from({ length: Math.ceil(text.length / size) }, (_, i) =>
      text.slice(i * size, (i + 1) * size),
    );
  const pieces: string[] = [];
  let start = 0;
  let end: number;
  while ((end = text.indexOf(separator, start)) !== -1) {
    pieces.push(text.slice(start, end + separator.length));
    start = end + separator.length;
  }
  if (start < text.length) pieces.push(text.slice(start));
  return pieces.flatMap((piece) => splitBounded(piece, size, depth + 1));
}
export function chunkText(
  text: string,
  options: {
    chunkSize?: number;
    chunkOverlap?: number;
    metadata?: Record<string, unknown>;
  } = {},
): TextChunk[] {
  const size = options.chunkSize ?? CHUNK_SIZE,
    overlap = options.chunkOverlap ?? CHUNK_OVERLAP;
  if (
    !Number.isInteger(size) ||
    size <= 0 ||
    !Number.isInteger(overlap) ||
    overlap < 0 ||
    overlap >= size
  )
    throw new Error(
      "Chunk size must be positive and overlap must be smaller than size",
    );
  const value = text.trim();
  if (!value) return [];
  const cores: string[] = [];
  let current = "";
  for (const piece of splitBounded(value, size - overlap)) {
    if (current.length + piece.length > size - overlap) {
      cores.push(current);
      current = "";
    }
    current += piece;
  }
  if (current) cores.push(current);
  let previous = "";
  return cores.map((content, index) => {
    const joined = previous.slice(-overlap || previous.length) + content;
    const result = {
      index,
      content: overlap ? joined : content,
      metadata: options.metadata,
    };
    previous = result.content;
    return result;
  });
}
export function chunkPages(
  pages: string[],
  options: { chunkSize?: number; chunkOverlap?: number } = {},
): TextChunk[] {
  const chunks: TextChunk[] = [];
  pages.forEach((page, index) => {
    for (const chunk of chunkText(page, {
      ...options,
      metadata: { page: index + 1 },
    }))
      chunks.push({ ...chunk, index: chunks.length });
  });
  return chunks;
}
