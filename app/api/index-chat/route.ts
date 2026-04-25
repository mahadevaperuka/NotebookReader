import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../convex/_generated/api";
import { generateBatchEmbeddings } from "../../../lib/ollama";

const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
const ollamaBase = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
const chatModel = process.env.OLLAMA_CHAT_MODEL ?? "llama3.2";

export async function POST(req: NextRequest) {
  try {
    const { chatId } = await req.json();
    if (!chatId) return NextResponse.json({ error: "chatId required" }, { status: 400 });

    const chat = await convex.query(api.chats.getById, { id: chatId as any });
    if (!chat || chat.isMain) {
       return NextResponse.json({ error: "Invalid chat or main chat" }, { status: 400 });
    }

    if (!chat.messages || chat.messages.length === 0) {
       return NextResponse.json({ success: true, skipped: true });
    }

    // Auto-title: generate a short title from the first user message if still default
    const needsTitle = chat.title === "New Document Chat" || !chat.title;
    if (needsTitle) {
      const firstUserMessage = chat.messages.find((m: any) => m.role === "user");
      if (firstUserMessage) {
        const titlePrompt = `Generate a short chat title (4-6 words max) for a conversation that starts with this message. Return only the title, no quotes, no punctuation at the end.\n\nMessage: "${firstUserMessage.content.substring(0, 200)}"`;
        const titleRes = await fetch(`${ollamaBase}/api/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: chatModel, prompt: titlePrompt, stream: false }),
        });
        const titleData = await titleRes.json();
        const newTitle = titleData.response?.trim().replace(/^["']|["']$/g, "");
        if (newTitle) {
          await convex.mutation(api.chats.updateTitle, { id: chatId as any, title: newTitle });
        }
      }
    }

    // Focus purely on the most recent context so new topics aren't drowned out by older massive AI paragraphs
    const recentMessages = chat.messages.slice(-4);
    const conversationText = recentMessages
      .map((m: any) => `${m.role.toUpperCase()}: ${m.content.substring(0, 500)}`)
      .join("\n\n");

    const keywordsPrompt = `Extract 5-10 keywords from this conversation that would help identify what topics were discussed in a search engine. Pay special attention to the MOST RECENT user question at the very bottom. Return just a comma-separated list of keywords.

Conversation:
${conversationText.substring(0, 4000)}`;

    const keywordsResponse = await fetch(`${ollamaBase}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: chatModel, prompt: keywordsPrompt, stream: false }),
    });

    if (!keywordsResponse.ok) throw new Error("Ollama generation failed.");
    const keywordsData = await keywordsResponse.json();
    const keywords = keywordsData.response?.trim() || chat.title;

    const summaryPrompt = `Create a brief 1-2 sentence summary of what this conversation is about. Focus entirely on what the user asked about Most Recently in the final messages. Just return the sentence directly.

Conversation:
${conversationText.substring(0, 4000)}`;

    const summaryResponse = await fetch(`${ollamaBase}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: chatModel, prompt: summaryPrompt, stream: false }),
    });
    const summaryData = await summaryResponse.json();
    const summary = summaryData.response?.trim() || chat.title;

    const summaryForEmbedding = `Chat about: ${keywords}. Summary: ${summary}`;
    const summaryEmbedding = await generateBatchEmbeddings([summaryForEmbedding]);

    await convex.mutation(api.chatIndex.updateIndex, {
      chatId: chatId as any,
      keywords,
      summary,
      summaryEmbedding: summaryEmbedding[0],
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Index chat error:", error);
    return NextResponse.json({ error: "Failed to update index", details: String(error) }, { status: 500 });
  }
}
