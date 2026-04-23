import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import { Id } from "../convex/_generated/dataModel";
import { generateEmbedding } from "./ollama";

const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);


export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatContext {
  chatId: string;
  documentIds: Id<"documents">[];
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

  const intent = await detectIntent(userMessage);
  if (intent.type === "list_documents") {
    yield* handleListDocuments(context.documentIds);
    return;
  }

  if (intent.type === "search") {
    yield* await handleDocumentSearch(userMessage, context, intent.query);
    return;
  }

  // Only use general chat if there are no documents — otherwise always search the docs
  if (intent.type === "general" && context.documentIds.length === 0) {
    yield* await handleGeneralChat(userMessage, context.conversationHistory);
    return;
  }

  yield* await handleDocumentSearch(userMessage, context);
}

function detectIntentFallback(message: string): { type: string; query?: string } {
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

  if (lowerMessage.includes("search") || lowerMessage.includes("find")) {
    const query = lowerMessage
      .replace(/search\s+(for\s+)?/i, "")
      .replace(/find\s+(for\s+)?/i, "")
      .trim();
    return { type: "search", query: query || message };
  }

  return { type: "general" };
}

async function detectIntent(message: string): Promise<{ type: string; query?: string }> {
  const ollamaBase = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
  try {
    const res = await fetch(`${ollamaBase}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "llama3.2",
        prompt: `Classify the following user message into exactly one of these intents:
- LIST_DOCS: user wants to see a list of uploaded documents
- SEARCH_DOCS: user wants to search document content for specific information
- GENERAL: anything else (greetings, help requests, etc.)

Respond with only the intent label, nothing else.

Message: "${message}"
Intent:`,
        stream: false,
      }),
      signal: AbortSignal.timeout(5000),
    });
    const json = await res.json();
    const label = (json.response ?? "").trim().toUpperCase();
    if (label === "LIST_DOCS") return { type: "list_documents" };
    if (label === "SEARCH_DOCS") return { type: "search", query: message };
    return { type: "general" };
  } catch {
    return detectIntentFallback(message);
  }
}

async function* handleListDocuments(documentIds: Id<"documents">[]) {
  try {
    let documents;
    if (documentIds.length > 0) {
     documents = await Promise.all(
       documentIds.map((id) => convex.query(api.documents.getById, { id }))
     );
    } else {
      documents = await convex.query(api.documents.list, {});
    }

     const docs = documents.filter(Boolean);

    if (docs.length === 0) {
      yield { type: "message", content: "No documents in this chat yet. Add a document to get started!" };
      return;
    }

    const docList = docs
      .map((doc, i) => `${i + 1}. **${doc?.filename || 'Unknown'}** (${formatDate(doc?.uploadedAt || Date.now())})`)
      .join("\n");

    yield { type: "message", content: "Documents in this conversation:\n\n" + docList };
  } catch {
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

    const documentIds = context.documentIds;

    // Generate embedding for the search query
    const queryEmbedding = await generateEmbedding(query);

    // Use Convex native vector search instead of loading all chunks into memory
    const results: Array<{ chunkText: string }> = await convex.action(api.chunks.searchSimilar, {
      embedding: queryEmbedding,
      ...(documentIds.length > 0 ? { documentIds: documentIds as Id<"documents">[] } : {}),
      limit: 5,
    });

    if (!results || results.length === 0) {
      // Fallback: check if there are any documents at all
      const allDocs = await convex.query(api.documents.list, {});
      if (allDocs.length === 0) {
        yield {
          type: "message",
          content: "No documents available. Please upload a PDF first.",
        };
        return;
      }
    }

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

    const ollamaBase = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
    const response = await fetch(`${ollamaBase}/api/generate`, {
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
           if (line.trim()) {
             try {
               const parsed = JSON.parse(line);
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

  const ollamaBase = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
  try {
    const response = await fetch(`${ollamaBase}/api/generate`, {
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
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          if (parsed.response) {
            yield { type: "token", content: parsed.response };
          }
        } catch {}
      }
    }
  } catch (error) {
    console.error("[agent] Error in handleGeneralChat:", error);
    yield { type: "error", content: "Sorry, I couldn't process that request. Error: " + String(error) };
  }
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

async function* handleMainChat(message: string, _conversationHistory: ChatMessage[]) {
  yield { type: "searching", content: "Searching your chat history..." };

  const ollamaBase = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";

  try {
    const queryEmbedding = await generateEmbedding(message);

    const results = await convex.action(api.chatIndex.vectorSearch, {
      embedding: queryEmbedding,
      limit: 5,
    }) as Array<{ chatId: string; title: string; summary: string; keywords: string; score: number }>;

    if (!results || results.length === 0) {
      yield {
        type: "message",
        content:
          "I don't have any indexed chats yet. Upload some documents to a new chat and I'll remember the topics!",
      };
      return;
    }

    const chatList = results
      .map((c, i) => {
        const scorePercent = Math.round(c.score * 100);
        return `Option ${i + 1}:\n  Title: ${c.title}\n  Summary: ${c.summary}\n  Keywords: ${c.keywords}\n  ID: ${c.chatId}\n  Relevance: ${scorePercent}%`;
      })
      .join("\n\n");

    const redirectPrompt = `Given the user's question: "${message}"

Here are the most relevant chats found (pre-ranked by semantic similarity):
${chatList}

Write a helpful response in markdown that:
1. Only includes chats that are genuinely relevant to the question — skip any that are unrelated.
2. Formats each relevant chat as a card like this:

### [Chat Title Here](/chat/the_chat_id)
> One sentence explaining why this chat is relevant.
**Topics:** keywords here

3. After the cards, add a brief 1-sentence closing line.
4. Do NOT use system tags or preamble. Start directly with the first card (or an apology if none are relevant).
`;

    const response = await fetch(`${ollamaBase}/api/generate`, {
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
        if (line.trim()) {
          try {
            const parsed = JSON.parse(line);
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
      content: "I had trouble searching your chat history. Make sure Ollama is running.",
    };
  }
}
