import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import { generateEmbedding } from "./ollama";

const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

function cosineSimilarity(a: number[], b: number[]): number {
  const dotProduct = a.reduce((sum, val, i) => sum + val * b[i], 0);
  const magnitudeA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
  const magnitudeB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
  return dotProduct / (magnitudeA * magnitudeB);
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatContext {
  chatId: string;
  documentIds: string[];
  conversationHistory: ChatMessage[];
  isMain: boolean;
}

export async function* streamChat(messages: ChatMessage[], context: ChatContext) {
  const lastMessage = messages[messages.length - 1];
  const userMessage = lastMessage.content;

  if (!userMessage) {
    yield { type: "error", content: "Message is required" };
    return;
  }

  if (context.isMain) {
    yield* await handleMainChat(userMessage, context.conversationHistory);
    return;
  }

  const intent = detectIntent(userMessage);

  if (intent.type === "list_documents") {
    yield* handleListDocuments(context.documentIds);
    return;
  }

  if (intent.type === "search") {
    yield* await handleDocumentSearch(userMessage, context, intent.query);
    return;
  }

  if (intent.type === "general") {
    yield* await handleGeneralChat(userMessage, context.conversationHistory);
    return;
  }

  yield* await handleDocumentSearch(userMessage, context);
}

function detectIntent(message: string): { type: string; query?: string } {
  const lowerMessage = message.toLowerCase();

  if (
    lowerMessage.includes("list") ||
    lowerMessage.includes("show me all") ||
    lowerMessage.includes("what documents") ||
    lowerMessage.includes("which files") ||
    lowerMessage.includes("available")
  ) {
    return { type: "list_documents" };
  }

  if (
    lowerMessage.includes("search") ||
    lowerMessage.includes("find")
  ) {
    const query = lowerMessage
      .replace(/search\s+(for\s+)?/i, "")
      .replace(/find\s+(for\s+)?/i, "")
      .trim();
    return { type: "search", query: query || message };
  }

  return { type: "rag" };
}

async function* handleListDocuments(documentIds: string[]) {
  try {
    let documents;
    if (documentIds.length > 0) {
      documents = await Promise.all(
        documentIds.map((id) => convex.query(api.documents.getById, { id } as any))
      );
    } else {
      documents = await convex.query(api.documents.list, {});
    }

    const docs = documents.filter(Boolean) as Array<{
      _id: string;
      filename: string;
      uploadedAt: number;
    }>;

    if (docs.length === 0) {
      yield { type: "message", content: "No documents in this chat yet. Add a document to get started!" };
      return;
    }

    const docList = docs
      .map((doc, i) => `${i + 1}. **${doc.filename}** (${formatDate(doc.uploadedAt)})`)
      .join("\n");

    yield { type: "message", content: "Documents in this conversation:\n\n" + docList };
  } catch (error) {
    yield { type: "error", content: "Failed to fetch documents" };
  }
}

async function* handleDocumentSearch(
  message: string,
  context: ChatContext,
  searchQuery?: string
) {
  const query = searchQuery || message;

  try {
    yield { type: "searching", content: "Searching documents..." };

    let documentIds = context.documentIds;
    
    if (documentIds.length === 0) {
      const allDocs = await convex.query(api.documents.list, {});
      documentIds = allDocs.map((d: any) => d._id);
    }

    if (documentIds.length === 0) {
      yield {
        type: "message",
        content: "No documents available. Please upload a PDF first.",
      };
      return;
    }

    let chunks: any[] = [];
    for (const docId of documentIds) {
      const docChunks = await convex.query(api.chunks.listByDocument, { documentId: docId as any });
      chunks = [...chunks, ...docChunks];
    }

    const queryEmbedding = await generateEmbedding(query);

    const results = chunks
      .map((chunk) => ({
        ...chunk,
        similarity: chunk.embedding?.length > 0
          ? cosineSimilarity(queryEmbedding, chunk.embedding)
          : 0,
      }))
      .filter((chunk) => chunk.similarity > 0.1)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 5);

    if (results.length === 0) {
      yield {
        type: "message",
        content: "I couldn't find relevant information in the selected documents. Try asking about different topics or add more documents.",
      };
      return;
    }

    const contextHistory = context.conversationHistory
      .slice(-5)
      .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
      .join("\n");

    const documentInfo = documentIds.length > 0
      ? `You are discussing ${documentIds.length} document(s) in this conversation.`
      : "Search across all available documents.";

    const contextText = results
      .map((r, i) => `[Context ${i + 1}]: ${r.chunkText}`)
      .join("\n\n");

    const prompt = `You are a helpful assistant that answers questions based on documents in a conversation.

${documentInfo}

Conversation History:
${contextHistory ? contextHistory + "\n" : ""}User's Current Question: ${message}

Available Context from Documents:
${contextText}

Instructions:
- Answer based ONLY on the provided context
- If the context doesn't contain enough information, say so clearly
- Reference relevant sections when possible
- Keep your answer concise but informative

Answer:`;

    yield { type: "thinking", content: "Generating answer..." };

    const response = await fetch("http://localhost:11434/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "llama3.2",
        prompt,
        stream: true,
      }),
    });

    if (!response.body) {
      throw new Error("No response body");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6);
          if (data === "[DONE]") continue;
          try {
            const parsed = JSON.parse(data);
            if (parsed.response) {
              yield { type: "token", content: parsed.response };
            }
          } catch {}
        }
      }
    }
  } catch (error) {
    console.error("Chat error:", error);
    yield { type: "error", content: "Sorry, I encountered an error processing your request." };
  }
}

async function* handleGeneralChat(message: string, conversationHistory: ChatMessage[]) {
  const contextHistory = conversationHistory
    .slice(-5)
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
    .join("\n");

  const prompt = `You are a helpful assistant for a document question-answering system.

${contextHistory ? `Recent conversation:\n${contextHistory}\n` : ""}User: ${message}

Respond helpfully. If they want to ask questions about documents, encourage them to create a chat and add documents to it.`;

  try {
    const response = await fetch("http://localhost:11434/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "llama3.2",
        prompt,
        stream: true,
      }),
    });

    if (!response.body) {
      throw new Error("No response body");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const text = decoder.decode(value, { stream: true });
      const lines = text.split("\n");
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6);
          if (data === "[DONE]") continue;
          try {
            const parsed = JSON.parse(data);
            if (parsed.response) {
              yield { type: "token", content: parsed.response };
            }
          } catch {}
        }
      }
    }
  } catch (error) {
    yield { type: "error", content: "Sorry, I couldn't process that request." };
  }
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

async function* handleMainChat(message: string, conversationHistory: ChatMessage[]) {
  const lowerMessage = message.toLowerCase();

  const routingKeywords = [
    "did i talk about",
    "did we discuss",
    "did we talk about",
    "earlier",
    "before",
    "previous",
    "earlier chat",
    "other chat",
    "that conversation",
    "what did i ask",
    "what did we discuss",
    "search my chats",
    "find my chat",
    "show me chats",
    "which chats",
    "what chats",
  ];

  const isRoutingQuery = routingKeywords.some((kw) =>
    lowerMessage.includes(kw)
  );

  if (isRoutingQuery) {
    yield { type: "searching", content: "Searching your chat history..." };

    try {
      const allIndexes = await convex.query(api.chatIndex.searchIndex, {
        query: message,
      });

      if (!allIndexes || allIndexes.length === 0) {
        yield {
          type: "message",
          content:
            "I don't have any indexed chats yet. Start a new chat with some documents and I'll remember the topics!",
        };
        return;
      }

      const queryEmbedding = await generateEmbedding(message);

      const scoredChats = allIndexes
        .map((idx: any) => ({
          ...idx,
          score: idx.summaryEmbedding?.length > 0
            ? cosineSimilarity(queryEmbedding, idx.summaryEmbedding)
            : 0,
        }))
        .filter((c: any) => c.score > 0.05)
        .sort((a: any, b: any) => b.score - a.score)
        .slice(0, 3);

      if (scoredChats.length === 0) {
        yield {
          type: "message",
          content:
            "I couldn't find any chats that match that topic. Would you like to start a new chat about this?",
        };
        return;
      }

      const chatList = scoredChats
        .map((c: any, i: number) => `${i + 1}. ${c.summary}\n   Keywords: ${c.keywords}`)
        .join("\n\n");

      const redirectPrompt = `Given the user's question: "${message}"

And these relevant chats found:
${chatList}

Create a helpful response that:
1. Shows the top 3 most relevant chats with their relevance score
2. Explains briefly why each is relevant
3. Offers to switch to any of them

Format your response as:

FOUND_CHATS:
[For each relevant chat, format as:]
- Chat [n] (score: X%): [chat summary]
  Keywords: [keywords]
  To switch, say "go to [chat_id]"

If the user should start a new chat, add:
START_NEW: [brief suggestion]

Otherwise, end with a helpful prompt like "Which chat would you like to switch to?"`;

      const response = await fetch("http://localhost:11434/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "llama3.2",
          prompt: redirectPrompt,
          stream: true,
        }),
      });

      if (!response.body) {
        throw new Error("No response body");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6);
            if (data === "[DONE]") continue;
            try {
              const parsed = JSON.parse(data);
              if (parsed.response) {
                yield { type: "token", content: parsed.response };
              }
            } catch {}
          }
        }
      }
    } catch (error) {
      console.error("Main chat search error:", error);
      yield {
        type: "message",
        content: "I had trouble searching your chat history. Try asking about a specific topic.",
      };
    }
    return;
  }

  yield {
    type: "message",
    content:
      "I'm your main chat assistant. I can help you find past conversations or route you to the right chat. Try asking things like:\n\n- \"Did we talk about X?\"\n- \"Show me chats about Y\"\n- \"Which chats do we have?\"\n\nOr create a new chat to start a fresh conversation with documents.",
  };
}
