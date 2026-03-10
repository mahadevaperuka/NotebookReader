export interface Chunk {
  chunkText: string;
  chunkIndex: number;
}

export async function extractTextFromPDF(
  buffer: ArrayBuffer
): Promise<string> {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: Buffer.from(buffer) });
  const result = await parser.getText();
  return result.text;
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

    const chunkText = text.slice(start, end).trim();
    if (chunkText) {
      chunks.push({ chunkText, chunkIndex: index });
      index++;
    }

    start = end - overlap;
    if (start <= chunks[index - 1]?.chunkText.length) {
      start = chunks[index - 1]?.chunkText.length + 1;
    }
  }

  return chunks;
}
