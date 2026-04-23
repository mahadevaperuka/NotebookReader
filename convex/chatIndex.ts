import { query, mutation, action } from "./_generated/server";
import { v } from "convex/values";
import { api } from "./_generated/api";

export const getMainChat = query({
  args: {},
  handler: async (ctx) => {
    const mainChat = await ctx.db
      .query("chats")
      .withIndex("isMain", (q) => q.eq("isMain", true))
      .first();
    return mainChat;
  },
});

export const createMainChat = mutation({
  args: {},
  handler: async (ctx) => {
    const existingMain = await ctx.db
      .query("chats")
      .withIndex("isMain", (q) => q.eq("isMain", true))
      .first();

    if (existingMain) return existingMain._id;

    const now = Date.now();
    const chatId = await ctx.db.insert("chats", {
      title: "Main Chat",
      isMain: true,
      createdAt: now,
      updatedAt: now,
    });
    return chatId;
  },
});

export const updateIndex = mutation({
  args: {
    chatId: v.id("chats"),
    keywords: v.string(),
    summary: v.string(),
    summaryEmbedding: v.array(v.float64()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("chatIndex")
      .withIndex("chatId", (q) => q.eq("chatId", args.chatId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        keywords: args.keywords,
        summary: args.summary,
        summaryEmbedding: args.summaryEmbedding,
        lastUpdated: Date.now(),
      });
    } else {
      await ctx.db.insert("chatIndex", {
        chatId: args.chatId,
        keywords: args.keywords,
        summary: args.summary,
        summaryEmbedding: args.summaryEmbedding,
        lastUpdated: Date.now(),
      });
    }
  },
});

export const searchIndex = query({
  args: { query: v.string() },
  handler: async (ctx, args) => {
    const allIndexes = await ctx.db.query("chatIndex").collect();
    return allIndexes;
  },
});

export const getIndexByChatId = query({
  args: { chatId: v.id("chats") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("chatIndex")
      .withIndex("chatId", (q) => q.eq("chatId", args.chatId))
      .first();
  },
});

export const getById = query({
  args: { id: v.id("chatIndex") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

type SearchResult = {
  chatId: string;
  title: string;
  summary: string;
  keywords: string;
  score: number;
};

export const vectorSearch = action({
  args: {
    embedding: v.array(v.float64()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { embedding, limit }): Promise<SearchResult[]> => {
    const results = await ctx.vectorSearch("chatIndex", "by_embedding", {
      vector: embedding,
      limit: limit ?? 5,
    });

    const enriched: Array<SearchResult | null> = await Promise.all(
      results.map(async (r): Promise<SearchResult | null> => {
        const indexDoc = await ctx.runQuery(api.chatIndex.getById, { id: r._id });
        if (!indexDoc) return null;
        const chat = await ctx.runQuery(api.chats.getById, { id: indexDoc.chatId });
        return {
          chatId: indexDoc.chatId as string,
          title: chat?.title ?? "Untitled Chat",
          summary: indexDoc.summary,
          keywords: indexDoc.keywords,
          score: r._score,
        };
      })
    );

    return enriched.filter((r): r is SearchResult => r !== null);
  },
});
