import { Ollama } from "ollama";

const ollama = new Ollama({
  host: "http://localhost:11434",
});

export async function generateEmbedding(text: string): Promise<number[]> {
  const response = await ollama.embeddings({
    model: "nomic-embed-text",
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
