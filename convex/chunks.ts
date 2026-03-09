import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const listByDocument = query({
  args: { documentId: v.id("documents") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("chunks")
      .withIndex("documentId", (q) => q.eq("documentId", args.documentId))
      .collect();
  },
});

export const create = mutation({
  args: {
    documentId: v.id("documents"),
    chunkText: v.string(),
    chunkIndex: v.number(),
    embedding: v.array(v.float64()),
  },
  handler: async (ctx, args) => {
    const chunkId = await ctx.db.insert("chunks", {
      documentId: args.documentId,
      chunkText: args.chunkText,
      chunkIndex: args.chunkIndex,
      embedding: args.embedding,
    });
    return chunkId;
  },
});

export const createMany = mutation({
  args: {
    chunks: v.array(
      v.object({
        documentId: v.id("documents"),
        chunkText: v.string(),
        chunkIndex: v.number(),
        embedding: v.array(v.float64()),
      })
    ),
  },
  handler: async (ctx, args) => {
    const chunkIds = [];
    for (const chunk of args.chunks) {
      const chunkId = await ctx.db.insert("chunks", chunk);
      chunkIds.push(chunkId);
    }
    return chunkIds;
  },
});
