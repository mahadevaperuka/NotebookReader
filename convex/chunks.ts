import { query, mutation, action, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";

export const listAll = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("chunks").collect();
  },
});

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

export const getById = internalQuery({
  args: { id: v.id("chunks") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

type ChunkSearchResult = {
  _id: Id<"chunks">;
  documentId: Id<"documents">;
  chunkText: string;
  chunkIndex: number;
  score: number;
};

export const keywordSearch = query({
  args: {
    query: v.string(),
    documentIds: v.optional(v.array(v.id("documents"))),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{ chunkText: string; documentId: Id<"documents"> }[]> => {
    const limit = args.limit ?? 10;
    const hasFilter = args.documentIds && args.documentIds.length > 0;

    if (hasFilter) {
      const results = await Promise.all(
        args.documentIds!.map((docId) =>
          ctx.db
            .query("chunks")
            .withSearchIndex("search_text", (q) =>
              q.search("chunkText", args.query).eq("documentId", docId)
            )
            .take(limit)
        )
      );
      return results.flat().slice(0, limit);
    }

    return ctx.db
      .query("chunks")
      .withSearchIndex("search_text", (q) => q.search("chunkText", args.query))
      .take(limit);
  },
});

export const searchSimilar = action({
  args: {
    embedding: v.array(v.float64()),
    documentIds: v.optional(v.array(v.id("documents"))),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<ChunkSearchResult[]> => {
    const limit = args.limit ?? 5;
    const hasFilter = args.documentIds && args.documentIds.length > 0;

    const results = await ctx.vectorSearch("chunks", "by_embedding", {
      vector: args.embedding,
      limit,
      ...(hasFilter
        ? {
            filter: (q: any) => {
              const ids = args.documentIds!;
              if (ids.length === 1) {
                return q.eq("documentId", ids[0]);
              }
              return q.or(...ids.map((id: any) => q.eq("documentId", id)));
            },
          }
        : {}),
    });

    const chunks: (ChunkSearchResult | null)[] = await Promise.all(
      results.map(async (result): Promise<ChunkSearchResult | null> => {
        const chunk = await ctx.runQuery(internal.chunks.getById, {
          id: result._id,
        });
        if (!chunk) return null;
        return {
          _id: chunk._id,
          documentId: chunk.documentId,
          chunkText: chunk.chunkText,
          chunkIndex: chunk.chunkIndex,
          score: result._score,
        };
      })
    );

    return chunks.filter((c): c is ChunkSearchResult => c !== null);
  },
});
