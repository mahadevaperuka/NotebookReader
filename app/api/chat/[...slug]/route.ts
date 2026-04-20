import { NextRequest } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../convex/_generated/api";
import { streamChat, ChatMessage } from "../../../../lib/agent";

const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string[] }> }) {
  try {
    const { slug } = await params;
    const chatId = slug[0];

    const { messages, documentIds = [] } = await req.json();

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return new Response(JSON.stringify({ error: "Messages required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    let conversationHistory: ChatMessage[] = messages.slice(0, -1).map((m: any) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));
    let currentMessages = messages.slice(-1).map((m: any) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    let isMain = false;
    if (chatId) {
      const chat = await convex.query(api.chats.getById, { id: chatId as any });
      if (chat) {
        isMain = chat.isMain || false;
        conversationHistory = [
          ...chat.messages.map((m: any) => ({ role: m.role as "user" | "assistant", content: m.content })),
          ...conversationHistory,
        ];
      }
    }

    const context = {
      chatId,
      documentIds: documentIds || [],
      conversationHistory,
      isMain,
    };

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of streamChat(currentMessages, context)) {
            const data = JSON.stringify(chunk) + "\n";
            controller.enqueue(encoder.encode(data));
          }
          controller.close();
        } catch (error) {
          controller.enqueue(
            encoder.encode(JSON.stringify({ type: "error", content: "Stream failed: " + String(error) }) + "\n")
          );
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson",
        "Cache-Control": "no-cache",
      },
    });
  } catch (error) {
    console.error("Chat error:", error);
    return new Response(JSON.stringify({ error: "Chat failed", details: String(error) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
