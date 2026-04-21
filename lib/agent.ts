import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import { Id } from "../convex/_generated/dataModel";
import { generateEmbedding } from "./ollama";

const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

// Keep cosineSimilarity for chatIndex search (no vector index on that table yet)
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

  return { type: "general" };
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

  try {
    const allIndexes = await convex.query(api.chatIndex.searchIndex, {
      query: message,
    });

    if (!allIndexes || allIndexes.length === 0) {
      yield {
        type: "message",
        content:
          "I don't have any indexed chats yet. Upload some documents to a new chat and I'll remember the topics!",
      };
      return;
    }

    const queryEmbedding = await generateEmbedding(message);

    const scoredChats = allIndexes
      .map((idx: { chatId: string; keywords: string; summary: string; summaryEmbedding: number[] }) => ({
        ...idx,
        score: idx.summaryEmbedding?.length > 0
          ? cosineSimilarity(queryEmbedding, idx.summaryEmbedding)
          : 0,
      }))
      .filter((c: { score: number }) => c.score > 0.50)
      .sort((a: { score: number }, b: { score: number }) => b.score - a.score)
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
      .map((c: { summary: string; keywords: string; chatId: string; score: number }, i: number) => {
        const scorePercent = Math.round(c.score * 100);
        return `Option ${i + 1}:\n   Summary: ${c.summary}\n   Keywords: ${c.keywords}\n   ID: ${c.chatId}\n   Relevance Score: ${scorePercent}%`;
      })
      .join("\n\n");

    const redirectPrompt = `Given the user's question: "${message}"

And these potentially relevant chats found from the database:
${chatList}

Create a helpful response that:
1. Shows only the chats that are ACTUALLY relevant to the user's question. 
2. If a chat is completely unrelated, DO NOT output it at all.
3. For the relevant ones, explain briefly why they are relevant and offer a clickable URL to switch to them.

Format your response exactly as normal markdown text.
Do NOT use ANY system tags like FOUND_CHATS: or START_NEW:. Write naturally in markdown.
Make sure the links use the exact ID format: [Chat Title](/chat/the_chat_id).
`;

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
