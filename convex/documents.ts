import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  args: {},
  handler: async (ctx) => {
    const documents = await ctx.db.query("documents").collect();
    return documents.sort((a, b) => b.uploadedAt - a.uploadedAt);
  },
});

export const getById = query({
  args: { id: v.id("documents") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

export const create = mutation({
  args: {
    filename: v.string(),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    const documentId = await ctx.db.insert("documents", {
      filename: args.filename,
      content: args.content,
      uploadedAt: Date.now(),
    });
    return documentId;
  },
});

export const remove = mutation({
  args: { id: v.id("documents") },
  handler: async (ctx, args) => {
    const chunks = await ctx.db
      .query("chunks")
      .withIndex("documentId", (q) => q.eq("documentId", args.id))
      .collect();

    for (const chunk of chunks) {
      await ctx.db.delete(chunk._id);
    }

    await ctx.db.delete(args.id);
  },
});

export const clearAll = mutation({
  args: {},
  handler: async (ctx) => {
    const tables = ["documents", "chunks", "messages", "chatDocuments", "chatIndex"] as const;

    for (const table of tables) {
      const rows = await ctx.db.query(table).collect();
      for (const row of rows) {
        await ctx.db.delete(row._id);
      }
    }

    // Delete all non-main chats; reset main chat
    const chats = await ctx.db.query("chats").collect();
    for (const chat of chats) {
      if (chat.isMain) {
        await ctx.db.patch(chat._id, { updatedAt: Date.now() });
      } else {
        await ctx.db.delete(chat._id);
      }
    }
  },
});
