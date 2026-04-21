import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  documents: defineTable({
    filename: v.string(),
    content: v.string(),
    uploadedAt: v.number(),
  }).index("uploadedAt", ["uploadedAt"]),

  chunks: defineTable({
    documentId: v.id("documents"),
    chunkText: v.string(),
    chunkIndex: v.number(),
    embedding: v.array(v.float64()),
  })
    .index("documentId", ["documentId"])
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 768,
      filterFields: ["documentId"],
    }),

  chats: defineTable({
    title: v.string(),
    isMain: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("updatedAt", ["updatedAt"])
    .index("isMain", ["isMain"]),

  messages: defineTable({
    chatId: v.id("chats"),
    role: v.union(v.literal("user"), v.literal("assistant")),
    content: v.string(),
    timestamp: v.number(),
  }).index("chatId", ["chatId"]),

  chatDocuments: defineTable({
    chatId: v.id("chats"),
    documentId: v.id("documents"),
  })
    .index("chatId", ["chatId"])
    .index("documentId", ["documentId"]),

  chatIndex: defineTable({
    chatId: v.id("chats"),
    keywords: v.string(),
    summary: v.string(),
    summaryEmbedding: v.array(v.float64()),
    lastUpdated: v.number(),
  }).index("chatId", ["chatId"]),
});
