import { NextRequest } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../convex/_generated/api";
import { streamChat, ChatMessage } from "../../../../lib/agent";

// Prevent Next.js from caching or buffering this route
export const dynamic = "force-dynamic";

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

    let conversationHistory: ChatMessage[] = messages.slice(0, -1).map((m) => ({
      role: m.role,
      content: m.content,
    }));
    const currentMessages = messages.slice(-1).map((m) => ({
      role: m.role,
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

    // Use proper SSE format (data: {...}\n\n) which Turbopack's dev proxy
    // recognizes and flushes immediately, unlike raw NDJSON which gets buffered.
    const iterator = streamChat(currentMessages, context)[Symbol.asyncIterator]();
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async pull(controller) {
        try {
          const { done, value } = await iterator.next();
          if (done) {
            // Send SSE close event
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
            return;
          }
          // SSE format: "data: <json>\n\n" — the double newline is the event delimiter
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(value)}\n\n`));
        } catch (error) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: "error", content: "Stream failed: " + String(error) })}\n\n`)
          );
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
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

