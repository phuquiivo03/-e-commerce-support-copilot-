/**
 * Heading-aware text chunking for knowledge-base ingestion.
 *
 * Strategy: split the document on markdown headings (## / ###), then pack
 * paragraphs into chunks of at most `maxTokens` (estimated at ~4 chars per
 * token), with `overlapTokens` carried between consecutive chunks of the same
 * section so policy sentences spanning a boundary stay retrievable.
 */

export type Chunk = {
  index: number;
  heading: string | null;
  content: string;
};

export type ChunkingOptions = {
  maxTokens: number;
  overlapTokens: number;
};

export const DEFAULT_CHUNKING: ChunkingOptions = {
  maxTokens: 180,
  overlapTokens: 30,
};

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function chunkDocument(content: string, options: ChunkingOptions = DEFAULT_CHUNKING): Chunk[] {
  const sections = splitByHeading(content);
  const chunks: Chunk[] = [];

  for (const section of sections) {
    const paragraphs = splitParagraphs(section.body);
    if (paragraphs.length === 0) continue;

    let buffer: string[] = [];
    let bufferTokens = 0;

    const flush = () => {
      if (buffer.length === 0) return;
      chunks.push({
        index: chunks.length,
        heading: section.heading,
        content: buffer.join('\n\n').trim(),
      });
      // Carry tail paragraphs as overlap for the next chunk of this section.
      const tail: string[] = [];
      let tailTokens = 0;
      for (let i = buffer.length - 1; i >= 0; i--) {
        const t = estimateTokens(buffer[i]!);
        if (tailTokens + t > options.overlapTokens) break;
        tail.unshift(buffer[i]!);
        tailTokens += t;
      }
      buffer = tail;
      bufferTokens = tailTokens;
    };

    for (const paragraph of paragraphs) {
      const tokens = estimateTokens(paragraph);
      // A single oversized paragraph is emitted as its own chunk.
      if (tokens > options.maxTokens) {
        flush();
        chunks.push({ index: chunks.length, heading: section.heading, content: paragraph.trim() });
        buffer = [];
        bufferTokens = 0;
        continue;
      }
      if (bufferTokens + tokens > options.maxTokens && buffer.length > 0) {
        flush();
      }
      buffer.push(paragraph);
      bufferTokens += tokens;
    }
    flush();
  }

  // Guarantee unique sequential indices even if a section produced nothing.
  return chunks
    .filter((c) => c.content.length > 0)
    .map((chunk, i) => ({ ...chunk, index: i }));
}

type Section = { heading: string | null; body: string };

function splitByHeading(content: string): Section[] {
  const lines = content.split(/\r?\n/);
  const sections: Section[] = [];
  let current: Section = { heading: null, body: '' };

  for (const line of lines) {
    const match = /^(#{2,4})\s+(.*)$/.exec(line);
    if (match) {
      if (current.body.trim().length > 0 || current.heading !== null) {
        sections.push(current);
      }
      current = { heading: match[2]!.trim(), body: '' };
    } else {
      current.body += line + '\n';
    }
  }
  if (current.body.trim().length > 0 || current.heading !== null) {
    sections.push(current);
  }
  return sections.filter((s) => s.body.trim().length > 0 || s.heading !== null);
}

function splitParagraphs(body: string): string[] {
  return body
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}
