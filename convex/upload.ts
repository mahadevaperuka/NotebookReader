import { mutation } from "./_generated/server";
import { v } from "convex/values";
import { extractTextFromPDF, chunkText } from "../lib/pdf";

export const uploadPDF = mutation({
  args: {
    filename: v.string(),
    fileData: v.bytes(),
  },
  handler: async (ctx, args) => {
    const text = await extractTextFromPDF(args.fileData);

    const documentId = await ctx.db.insert("documents", {
      filename: args.filename,
      content: text,
      uploadedAt: Date.now(),
    });

    const chunks = chunkText(text);

    for (let i = 0; i < chunks.length; i++) {
      await ctx.db.insert("chunks", {
        documentId,
        chunkText: chunks[i].chunkText,
        chunkIndex: chunks[i].chunkIndex,
        embedding: [],
      });
    }

    return {
      documentId,
      chunkCount: chunks.length,
      textLength: text.length,
    };
  },
});
