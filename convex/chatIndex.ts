import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

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
