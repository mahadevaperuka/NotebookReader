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
    .index("documentId", ["documentId"]),
});
