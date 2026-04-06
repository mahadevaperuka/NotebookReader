import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../convex/_generated/api";
import { generateEmbedding } from "../../../lib/ollama";

const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

function cosineSimilarity(a: number[], b: number[]): number {
  const dotProduct = a.reduce((sum, val, i) => sum + val * b[i], 0);
  const magnitudeA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
  const magnitudeB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
  return dotProduct / (magnitudeA * magnitudeB);
}

export async function POST(req: NextRequest) {
  try {
    const { message, topK = 5 } = await req.json();

    if (!message) {
      return NextResponse.json({ error: "Message required" }, { status: 400 });
    }

    const queryEmbedding = await generateEmbedding(message);

    const chunks = await convex.query(api.chunks.listAll, {}) as Array<{
      _id: string;
      documentId: string;
      chunkText: string;
      chunkIndex: number;
      embedding: number[];
    }>;

    const results = chunks
      .map((chunk) => ({
        ...chunk,
        similarity: chunk.embedding?.length > 0 
          ? cosineSimilarity(queryEmbedding, chunk.embedding) 
          : 0,
      }))
      .filter((chunk) => chunk.similarity > 0)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, topK);

    if (results.length === 0) {
      return NextResponse.json({ 
        answer: "No relevant information found. Please upload a document first.",
        sources: []
      });
    }

    const context = results
      .map((r, i) => `[Chunk ${i + 1}]: ${r.chunkText}`)
      .join("\n\n");

    const prompt = `You are a helpful assistant. Use the following context from uploaded documents to answer the question.

Context:
${context}

Question: ${message}

Instructions:
- Answer based ONLY on the provided context
- If the context doesn't contain enough information, say "I don't have enough information to answer that"
- Be concise and specific

Answer:`;

    const ollamaResponse = await fetch("http://localhost:11434/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "llama3.2",
        prompt,
        stream: false,
      }),
    });

    const ollamaData = await ollamaResponse.json();
    
    return NextResponse.json({
      answer: ollamaData.response || "No response generated",
      sources: results.map((r) => ({
        chunkText: r.chunkText.substring(0, 100) + "...",
        similarity: r.similarity,
      })),
    });
  } catch (error) {
    console.error("Chat error:", error);
    return NextResponse.json({ error: "Chat failed" }, { status: 500 });
  }
}
