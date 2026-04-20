export interface Chunk {
  chunkText: string;
  chunkIndex: number;
}

export function chunkText(
  text: string,
  chunkSize: number = 500,
  overlap: number = 50
): Chunk[] {
  const chunks: Chunk[] = [];
  let start = 0;
  let index = 0;

  while (start < text.length) {
    let end = start + chunkSize;

    if (end < text.length) {
      const lastSpace = text.lastIndexOf(" ", end);
      const lastNewline = text.lastIndexOf("\n", end);
      const boundary = Math.max(lastSpace, lastNewline);
      if (boundary > start) {
        end = boundary;
      }
    }

    const chunkTextValue = text.slice(start, end).trim();
    if (chunkTextValue) {
      chunks.push({ chunkText: chunkTextValue, chunkIndex: index });
      index++;
    }

    start = end - overlap;
    if (start <= chunks[index - 1]?.chunkText.length) {
      start = chunks[index - 1]?.chunkText.length + 1;
    }
  }

  return chunks;
}
