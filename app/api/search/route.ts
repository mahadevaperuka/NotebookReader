import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { generateEmbedding } from "../../../lib/ollama";
import { api } from "../../../convex/_generated/api";

const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

function cosineSimilarity(a: number[], b: number[]): number {
  const dotProduct = a.reduce((sum, val, i) => sum + val * b[i], 0);
  const magnitudeA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
  const magnitudeB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
  return dotProduct / (magnitudeA * magnitudeB);
}

export async function POST(req: NextRequest) {
  try {
    const { query, topK = 5 } = await req.json();

    if (!query) {
      return NextResponse.json({ error: "Query required" }, { status: 400 });
    }

    const queryEmbedding = await generateEmbedding(query);

    const chunks = await convex.query(api.chunks.listAll, {});

    const results = chunks
      .map((chunk: { _id: string; documentId: string; chunkText: string; chunkIndex: number; embedding: number[] }) => ({
        ...chunk,
        similarity: chunk.embedding.length > 0 
          ? cosineSimilarity(queryEmbedding, chunk.embedding) 
          : 0,
      }))
      .filter((chunk: { similarity: number }) => chunk.similarity > 0)
      .sort((a: { similarity: number }, b: { similarity: number }) => b.similarity - a.similarity)
      .slice(0, topK);

    return NextResponse.json({ results });
  } catch (error) {
    console.error("Search error:", error);
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }
}
