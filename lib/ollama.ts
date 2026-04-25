import { Ollama } from "ollama";

const ollama = new Ollama({
  host: process.env.OLLAMA_BASE_URL ?? "http://localhost:11434",
});

export const EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL ?? "nomic-embed-text";

export async function generateEmbedding(text: string): Promise<number[]> {
  const response = await ollama.embeddings({
    model: EMBED_MODEL,
    prompt: text,
  });
  return response.embedding;
}

export async function generateBatchEmbeddings(
  texts: string[]
): Promise<number[][]> {
  const embeddings: number[][] = [];
  for (const text of texts) {
    const embedding = await generateEmbedding(text);
    embeddings.push(embedding);
  }
  return embeddings;
}

export default ollama;
