import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  args: {},
  handler: async (ctx) => {
    const chats = await ctx.db.query("chats").collect();
    return chats.sort((a, b) => b.updatedAt - a.updatedAt);
  },
});

export const getById = query({
  args: { id: v.id("chats") },
  handler: async (ctx, args) => {
    const chat = await ctx.db.get(args.id);
    if (!chat) return null;

    const messages = await ctx.db
      .query("messages")
      .withIndex("chatId", (q) => q.eq("chatId", args.id))
      .collect();

    const chatDocs = await ctx.db
      .query("chatDocuments")
      .withIndex("chatId", (q) => q.eq("chatId", args.id))
      .collect();

    const documents = await Promise.all(
      chatDocs.map(async (cd) => {
        const doc = await ctx.db.get(cd.documentId);
        return doc;
      })
    );

    return {
      ...chat,
      messages: messages.sort((a, b) => a.timestamp - b.timestamp),
      documents: documents.filter(Boolean),
    };
  },
});

export const create = mutation({
  args: { title: v.string() },
  handler: async (ctx, args) => {
    const now = Date.now();
    const chatId = await ctx.db.insert("chats", {
      title: args.title,
      isMain: false,
      createdAt: now,
      updatedAt: now,
    });
    return chatId;
  },
});

export const updateTitle = mutation({
  args: { id: v.id("chats"), title: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      title: args.title,
      updatedAt: Date.now(),
    });
  },
});

export const deleteChat = mutation({
  args: { id: v.id("chats") },
  handler: async (ctx, args) => {
    const messages = await ctx.db
      .query("messages")
      .withIndex("chatId", (q) => q.eq("chatId", args.id))
      .collect();

    for (const msg of messages) {
      await ctx.db.delete(msg._id);
    }

    const chatDocs = await ctx.db
      .query("chatDocuments")
      .withIndex("chatId", (q) => q.eq("chatId", args.id))
      .collect();

    for (const cd of chatDocs) {
      await ctx.db.delete(cd._id);
    }

    await ctx.db.delete(args.id);
  },
});

export const addMessage = mutation({
  args: {
    chatId: v.id("chats"),
    role: v.union(v.literal("user"), v.literal("assistant")),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    const messageId = await ctx.db.insert("messages", {
      chatId: args.chatId,
      role: args.role,
      content: args.content,
      timestamp: Date.now(),
    });

    await ctx.db.patch(args.chatId, {
      updatedAt: Date.now(),
    });

    const chat = await ctx.db.get(args.chatId);
    if (chat?.isMain) return messageId;

    const allMessages = await ctx.db
      .query("messages")
      .withIndex("chatId", (q) => q.eq("chatId", args.chatId))
      .collect();

    const messageCount = allMessages.length;
    const recentMessages = allMessages.slice(-10);

    if (messageCount > 0 && messageCount % 5 === 0) {
      const recentMessages = await ctx.db
        .query("messages")
        .withIndex("chatId", (q) => q.eq("chatId", args.chatId))
        .order("desc")
        .take(10);

      const chatDocs = await ctx.db
        .query("chatDocuments")
        .withIndex("chatId", (q) => q.eq("chatId", args.chatId))
        .collect();

      const documents = await Promise.all(
        chatDocs.map(async (cd) => {
          const doc = await ctx.db.get(cd.documentId);
          return doc;
        })
      );

      const docNames = documents
        .filter((d) => d)
        .map((d: any) => d.filename)
        .join(", ");

      const recentText = recentMessages
        .reverse()
        .map((m) => `${m.role}: ${m.content}`)
        .join("\n");

      const summaryPrompt = `Analyze this conversation and create:
1. A brief 2-3 sentence summary of what was discussed
2. 5-10 keywords that capture the topics

Conversation:
${recentText}

${docNames ? `Documents: ${docNames}` : ""}

Format as:
SUMMARY: [your summary]
KEYWORDS: [comma-separated keywords]`;

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
      const llmResponse = summaryData.response?.trim() || "";

      const summaryMatch = llmResponse.match(/SUMMARY:\s*([\s\S]*?)(?:KEYWORDS:|$)/);
      const keywordsMatch = llmResponse.match(/KEYWORDS:\s*([\s\S]*)/);

      const summary = summaryMatch?.[1]?.trim() || "Conversation continues";
      const keywords = keywordsMatch?.[1]?.trim() || docNames || "general";

      const existingIndex = await ctx.db
        .query("chatIndex")
        .withIndex("chatId", (q) => q.eq("chatId", args.chatId))
        .first();

      const combinedForEmbedding = `Chat about: ${keywords}. Summary: ${summary}`;
      const embeddingResponse = await fetch("http://localhost:11434/api/embeddings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "nomic-embed-text",
          prompt: combinedForEmbedding,
        }),
      });

      const embeddingData = await embeddingResponse.json();
      const summaryEmbedding = embeddingData.embedding || [];

      if (existingIndex) {
        const existingKeywords = existingIndex.keywords.split(", ").filter(Boolean);
        const newKeywords = keywords.split(", ").filter(Boolean);
        const combinedKeywords = [...new Set([...existingKeywords, ...newKeywords])].slice(0, 10).join(", ");

        await ctx.db.patch(existingIndex._id, {
          summary: summary + " [updated]",
          keywords: combinedKeywords,
          summaryEmbedding,
          lastUpdated: Date.now(),
        });
      } else {
        await ctx.db.insert("chatIndex", {
          chatId: args.chatId,
          summary,
          keywords,
          summaryEmbedding,
          lastUpdated: Date.now(),
        });
      }
    }

    return messageId;
  },
});

export const addDocument = mutation({
  args: {
    chatId: v.id("chats"),
    documentId: v.id("documents"),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("chatDocuments")
      .withIndex("chatId", (q) => q.eq("chatId", args.chatId))
      .filter((q) => q.eq(q.field("documentId"), args.documentId))
      .first();

    if (existing) return existing._id;

    const id = await ctx.db.insert("chatDocuments", {
      chatId: args.chatId,
      documentId: args.documentId,
    });

    await ctx.db.patch(args.chatId, {
      updatedAt: Date.now(),
    });

    return id;
  },
});

export const getDocuments = query({
  args: { chatId: v.id("chats") },
  handler: async (ctx, args) => {
    const chatDocs = await ctx.db
      .query("chatDocuments")
      .withIndex("chatId", (q) => q.eq("chatId", args.chatId))
      .collect();

    const documents = await Promise.all(
      chatDocs.map(async (cd) => {
        const doc = await ctx.db.get(cd.documentId);
        return doc;
      })
    );

    return documents.filter(Boolean);
  },
});
