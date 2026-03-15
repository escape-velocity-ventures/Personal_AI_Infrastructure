import type { ChunkStrategy } from './types';

export interface Chunk {
  content: string;
  metadata: {
    heading?: string;
    index: number;
    source_file?: string;
  };
}

export function chunkMarkdown(
  content: string,
  strategy: ChunkStrategy,
  options?: { maxSize?: number; sourceFile?: string },
): Chunk[] {
  let raw: Chunk[];

  switch (strategy) {
    case 'heading':
      raw = chunkByHeading(content);
      break;
    case 'paragraph':
      raw = chunkByParagraph(content);
      break;
    case 'fixed_size':
      raw = chunkByFixedSize(content, options?.maxSize ?? 1000);
      break;
    default:
      raw = [{ content, metadata: { index: 0 } }];
  }

  // Post-process: trim, skip empty, set source_file, reindex
  const result: Chunk[] = [];
  let idx = 0;
  for (const chunk of raw) {
    const trimmed = chunk.content.trim();
    if (trimmed.length === 0) continue;
    result.push({
      content: trimmed,
      metadata: {
        ...chunk.metadata,
        index: idx,
        source_file: options?.sourceFile,
      },
    });
    idx++;
  }

  // Guarantee at least one chunk for non-empty input
  if (result.length === 0 && content.trim().length > 0) {
    result.push({
      content: content.trim(),
      metadata: { index: 0, source_file: options?.sourceFile },
    });
  }

  return result;
}

// ── Heading Strategy ──────────────────────────────────────────────

function chunkByHeading(content: string): Chunk[] {
  const parts = content.split(/^(?=## )/m);
  const chunks: Chunk[] = [];

  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.length === 0) continue;

    const headingMatch = trimmed.match(/^## (.+)/);
    if (headingMatch) {
      const heading = headingMatch[1].trim();
      const body = trimmed.slice(headingMatch[0].length).trim();

      // Skip chunks that are just a heading with no content
      if (body.length === 0) continue;

      // If chunk exceeds 4000 chars, sub-split on ###
      if (trimmed.length > 4000) {
        const subChunks = subSplitOnH3(body, heading);
        chunks.push(...subChunks);
      } else {
        chunks.push({
          content: trimmed,
          metadata: { heading, index: 0 },
        });
      }
    } else {
      // Preamble (content before first heading)
      chunks.push({
        content: trimmed,
        metadata: { index: 0 },
      });
    }
  }

  return chunks;
}

function subSplitOnH3(body: string, parentHeading: string): Chunk[] {
  const parts = body.split(/^(?=### )/m);
  const chunks: Chunk[] = [];

  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.length === 0) continue;

    const h3Match = trimmed.match(/^### (.+)/);
    if (h3Match) {
      const subHeading = h3Match[1].trim();
      const subBody = trimmed.slice(h3Match[0].length).trim();
      if (subBody.length === 0) continue;
      chunks.push({
        content: trimmed,
        metadata: { heading: `${parentHeading} > ${subHeading}`, index: 0 },
      });
    } else {
      // Content before first ### in this section
      chunks.push({
        content: trimmed,
        metadata: { heading: parentHeading, index: 0 },
      });
    }
  }

  return chunks;
}

// ── Paragraph Strategy ────────────────────────────────────────────

function chunkByParagraph(content: string): Chunk[] {
  const paragraphs = content.split(/\n\n+/).map(p => p.trim()).filter(p => p.length > 0);
  const chunks: Chunk[] = [];
  let buffer = '';

  for (const para of paragraphs) {
    if (para.length >= 200) {
      // Flush buffer first
      if (buffer.length > 0) {
        chunks.push({ content: buffer, metadata: { index: 0 } });
        buffer = '';
      }
      chunks.push({ content: para, metadata: { index: 0 } });
    } else {
      // Short paragraph — accumulate
      if (buffer.length > 0) {
        buffer += '\n\n' + para;
      } else {
        buffer = para;
      }
      // If accumulated buffer exceeds 200, flush
      if (buffer.length >= 200) {
        chunks.push({ content: buffer, metadata: { index: 0 } });
        buffer = '';
      }
    }
  }

  // Flush remaining buffer
  if (buffer.length > 0) {
    chunks.push({ content: buffer, metadata: { index: 0 } });
  }

  return chunks;
}

// ── Fixed-Size Strategy ───────────────────────────────────────────

function chunkByFixedSize(content: string, maxSize: number): Chunk[] {
  const chunks: Chunk[] = [];
  let remaining = content;

  while (remaining.length > 0) {
    if (remaining.length <= maxSize) {
      chunks.push({ content: remaining, metadata: { index: 0 } });
      break;
    }

    let splitAt = -1;

    // Try sentence boundaries within maxSize
    const window = remaining.slice(0, maxSize);
    const sentenceDelimiters = ['. ', '! ', '? ', '\n'];
    for (const delim of sentenceDelimiters) {
      const lastIdx = window.lastIndexOf(delim);
      if (lastIdx > 0 && lastIdx > splitAt) {
        splitAt = lastIdx + delim.length;
      }
    }

    // Sentence boundary must be within 80% of maxSize (i.e., within 20% of end)
    const minSentenceBoundary = maxSize * 0.8;
    if (splitAt < minSentenceBoundary) {
      splitAt = -1; // too early, look for word boundary instead
    }

    if (splitAt <= 0) {
      // No good sentence boundary — split at word boundary
      const lastSpace = window.lastIndexOf(' ');
      if (lastSpace > 0) {
        splitAt = lastSpace;
      } else {
        // No space at all — force split at maxSize (shouldn't happen with real text)
        splitAt = maxSize;
      }
    }

    const chunk = remaining.slice(0, splitAt);
    chunks.push({ content: chunk, metadata: { index: 0 } });
    remaining = remaining.slice(splitAt);

    // Trim leading whitespace from remaining
    remaining = remaining.replace(/^\s+/, '');
  }

  return chunks;
}
