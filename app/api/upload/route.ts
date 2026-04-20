import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../convex/_generated/api";
import { chunkText } from "../../../lib/pdf";
import { generateBatchEmbeddings } from "../../../lib/ollama";

const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

interface Chunk {
  chunkText: string;
  chunkIndex: number;
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const text = formData.get("text") as string;
    const filename = formData.get("filename") as string;
    const chatId = formData.get("chatId") as string;

    if (!text || !filename) {
      return NextResponse.json({ error: "Text and filename required" }, { status: 400 });
    }

    const chunks = chunkText(text) as Chunk[];

    const chunkTexts = chunks.map((c: Chunk) => c.chunkText);
    const embeddings = await generateBatchEmbeddings(chunkTexts);

    const documentId = await convex.mutation(api.documents.create, {
      filename: filename,
      content: text,
    });

    const chunksWithEmbeddings = chunks.map((chunk: Chunk, i: number) => ({
      documentId,
      chunkText: chunk.chunkText,
      chunkIndex: chunk.chunkIndex,
      embedding: embeddings[i],
    }));

    await convex.mutation(api.chunks.createMany, { chunks: chunksWithEmbeddings });

    if (chatId) {
      await convex.mutation(api.chats.addDocument, {
        chatId: chatId as any,
        documentId,
      });
    }

    const keywordsPrompt = `Extract 5-10 keywords from this document that would help identify what topics were discussed. Return just a comma-separated list of keywords.

Document content preview:
${text.substring(0, 2000)}`;

    const keywordsResponse = await fetch("http://localhost:11434/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "llama3.2",
        prompt: keywordsPrompt,
        stream: false,
      }),
    });

    const keywordsData = await keywordsResponse.json();
    const keywords = keywordsData.response?.trim() || filename;

    const summaryPrompt = `Create a brief 1-2 sentence summary of what this document is about.

Document content preview:
${text.substring(0, 2000)}`;

    const summaryResponse = await fetch("http://localhost:11434/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "llama3.2",
        prompt: summaryPrompt,
        stream: false,
      }),
    });

    const summaryData = await summaryResponse.json();
    const summary = summaryData.response?.trim() || filename;

    const summaryForEmbedding = `Chat about: ${keywords}. Summary: ${summary}`;
    const summaryEmbedding = await generateBatchEmbeddings([summaryForEmbedding]);

    let chatTitle = filename.replace(".pdf", "");
    chatTitle = chatTitle
      .replace(/[-_]/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());

    if (chatId) {
      await convex.mutation(api.chats.addDocument, {
        chatId: chatId as any,
        documentId,
      });

      const existingChat = await convex.query(api.chats.getById, { id: chatId as any });
      if (existingChat && !existingChat.title) {
        await convex.mutation(api.chats.updateTitle, {
          id: chatId as any,
          title: chatTitle,
        });
      }

      await convex.mutation(api.chatIndex.updateIndex, {
        chatId: chatId as any,
        keywords,
        summary,
        summaryEmbedding: summaryEmbedding[0],
      });
    }

    return NextResponse.json({
      documentId,
      chunkCount: chunks.length,
      keywords,
      summary,
    });
  } catch (error) {
    console.error("Upload error:", error);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
