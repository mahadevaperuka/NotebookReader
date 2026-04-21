import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { generateEmbedding } from "../../../lib/ollama";
import { api } from "../../../convex/_generated/api";

const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

export async function POST(req: NextRequest) {
  try {
    const { query, topK = 5 } = await req.json();

    if (!query) {
      return NextResponse.json({ error: "Query required" }, { status: 400 });
    }

    const queryEmbedding = await generateEmbedding(query);

    // Use Convex native vector search instead of loading all chunks into memory
    const results = await convex.action(api.chunks.searchSimilar, {
      embedding: queryEmbedding,
      limit: topK,
    });

    return NextResponse.json({ results });
  } catch (error) {
    console.error("Search error:", error);
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }
}
