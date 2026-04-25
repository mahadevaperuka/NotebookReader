import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../convex/_generated/api";
import { chunkText } from "../../../lib/pdf";
import { generateBatchEmbeddings } from "../../../lib/ollama";
import mammoth from "mammoth";

const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
const ollamaBase = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
const chatModel = process.env.OLLAMA_CHAT_MODEL ?? "llama3.2";

interface Chunk {
  chunkText: string;
  chunkIndex: number;
}

async function extractText(file: File): Promise<string> {
  const ext = file.name.split(".").pop()?.toLowerCase();
  const buffer = Buffer.from(await file.arrayBuffer());

  if (ext === "pdf") {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pdfParse = require("pdf-parse/lib/pdf-parse");
    const data = await pdfParse(buffer);
    return data.text;
  }

  if (ext === "docx") {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }

  if (ext === "txt" || ext === "md") {
    return buffer.toString("utf-8");
  }

  throw new Error(`Unsupported file type: .${ext}`);
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const chatId = formData.get("chatId") as string;

    if (!file) {
      return NextResponse.json({ error: "File required" }, { status: 400 });
    }

    const text = await extractText(file);

    if (!text.trim()) {
      return NextResponse.json({ error: "Could not extract text from file" }, { status: 400 });
    }

    const chunks = chunkText(text) as Chunk[];
    const chunkTexts = chunks.map((c: Chunk) => c.chunkText);
    const embeddings = await generateBatchEmbeddings(chunkTexts);

    const documentId = await convex.mutation(api.documents.create, {
      filename: file.name,
      content: text,
    });

    const chunksWithEmbeddings = chunks.map((chunk: Chunk, i: number) => ({
      documentId,
      chunkText: chunk.chunkText,
      chunkIndex: chunk.chunkIndex,
      embedding: embeddings[i],
    }));

    await convex.mutation(api.chunks.createMany, { chunks: chunksWithEmbeddings });

    const keywordsPrompt = `Extract 5-10 keywords from this document that would help identify what topics were discussed. Return just a comma-separated list of keywords.

Document content preview:
${text.substring(0, 2000)}`;

    const keywordsResponse = await fetch(`${ollamaBase}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: chatModel, prompt: keywordsPrompt, stream: false }),
    });

    const keywordsData = await keywordsResponse.json();
    const keywords = keywordsData.response?.trim() || file.name;

    const summaryPrompt = `Create a brief 1-2 sentence summary of what this document is about.

Document content preview:
${text.substring(0, 2000)}`;

    const summaryResponse = await fetch(`${ollamaBase}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: chatModel, prompt: summaryPrompt, stream: false }),
    });

    const summaryData = await summaryResponse.json();
    const summary = summaryData.response?.trim() || file.name;

    const summaryForEmbedding = `Chat about: ${keywords}. Summary: ${summary}`;
    const summaryEmbedding = await generateBatchEmbeddings([summaryForEmbedding]);

    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    let chatTitle = file.name.replace(new RegExp(`\\.${ext}$`), "");
    chatTitle = chatTitle.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

    if (chatId) {
      await convex.mutation(api.chats.addDocument, {
        chatId: chatId as any,
        documentId,
      });

      const existingChat = await convex.query(api.chats.getById, { id: chatId as any });
      if (existingChat && !existingChat.title) {
        await convex.mutation(api.chats.updateTitle, { id: chatId as any, title: chatTitle });
      }

      await convex.mutation(api.chatIndex.updateIndex, {
        chatId: chatId as any,
        keywords,
        summary,
        summaryEmbedding: summaryEmbedding[0],
      });
    }

    return NextResponse.json({ documentId, chunkCount: chunks.length, keywords, summary });
  } catch (error) {
    console.error("Upload error:", error);
    const message = error instanceof Error ? error.message : "Upload failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
