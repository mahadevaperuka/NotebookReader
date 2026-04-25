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

    return messageId;
  },
});

export const clearMessages = mutation({
  args: { chatId: v.id("chats") },
  handler: async (ctx, args) => {
    const messages = await ctx.db
      .query("messages")
      .withIndex("chatId", (q) => q.eq("chatId", args.chatId))
      .collect();

    for (const msg of messages) {
      await ctx.db.delete(msg._id);
    }
  },
});

export const removeDocument = mutation({
  args: {
    chatId: v.id("chats"),
    documentId: v.id("documents"),
  },
  handler: async (ctx, args) => {
    // Remove the chatDocuments link
    const link = await ctx.db
      .query("chatDocuments")
      .withIndex("chatId", (q) => q.eq("chatId", args.chatId))
      .filter((q) => q.eq(q.field("documentId"), args.documentId))
      .first();

    if (link) await ctx.db.delete(link._id);

    // Delete the document's chunks
    const chunks = await ctx.db
      .query("chunks")
      .withIndex("documentId", (q) => q.eq("documentId", args.documentId))
      .collect();

    for (const chunk of chunks) {
      await ctx.db.delete(chunk._id);
    }

    // Delete the document itself
    await ctx.db.delete(args.documentId);
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
