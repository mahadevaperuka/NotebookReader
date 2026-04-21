"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter, useParams } from "next/navigation";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { extractTextFromPDF } from "../../../lib/pdf-client";
import SendHorizontalIcon from "../../../components/icons/send-horizontal-icon";
import UploadIcon from "../../../components/icons/upload-icon";
import MoonIcon from "../../../components/icons/moon-icon";
import BulbSvg from "../../../components/icons/bulb-svg";
import ArrowBackIcon from "../../../components/icons/arrow-back-icon";
import TrashIcon from "../../../components/icons/trash-icon";

export default function ChatPage() {
  const router = useRouter();
  const params = useParams();
  const chatId = params?.chatId as string;

  // Convex hooks for real-time data
  const chat = useQuery(
    api.chats.getById,
    chatId ? { id: chatId as Id<"chats"> } : "skip"
  );

  const addMessage = useMutation(api.chats.addMessage);
  const deleteChatMutation = useMutation(api.chats.deleteChat);

  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [darkMode, setDarkMode] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [mounted, setMounted] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
    if (typeof window !== "undefined") {
      const savedTheme = localStorage.getItem("theme");
      if (savedTheme === "dark" || (!savedTheme && window.matchMedia("(prefers-color-scheme: dark)").matches)) {
        setDarkMode(true);
        document.documentElement.classList.add("dark");
      }
    }
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat?.messages, streamingContent]);

  const toggleTheme = () => {
    const newMode = !darkMode;
    setDarkMode(newMode);
    if (newMode) {
      document.documentElement.classList.add("dark");
      localStorage.setItem("theme", "dark");
    } else {
      document.documentElement.classList.remove("dark");
      localStorage.setItem("theme", "light");
    }
  };

  const handleDelete = async () => {
    if (confirm("Are you sure you want to delete this chat?")) {
      await deleteChatMutation({ id: chatId as Id<"chats"> });
      router.push("/");
    }
  };

  const sendMessage = async () => {
    if (!input.trim() || streaming) return;

    const userMessage = input.trim();
    setInput("");
    setStreaming(true);
    setStreamingContent("");

    try {
      // Save user message immediately (before streaming) so it's not lost
      await addMessage({
        chatId: chatId as Id<"chats">,
        role: "user",
        content: userMessage,
      });

      let fullContent = "";
      
      const response = await fetch(`/api/chat/${chatId}`, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: [{ role: "user", content: userMessage }],
          documentIds: chat?.documents?.map((d: any) => d._id) || [],
        }),
      });

      if (!response.ok) {
        throw new Error("API error: " + response.status);
      }

      if (!response.body) throw new Error("No response");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value || value.length === 0) continue;

        buffer += decoder.decode(value, { stream: true });
        // SSE events are delimited by double newlines
        const events = buffer.split("\n\n");
        // Keep the last (potentially incomplete) event in the buffer
        buffer = events.pop() || "";
        
        for (const event of events) {
          const line = event.trim();
          if (!line || line === "data: [DONE]") continue;
          if (!line.startsWith("data: ")) continue;
          try {
            const parsed = JSON.parse(line.slice(6));
            if (parsed.type === "token" && parsed.content) {
              fullContent += parsed.content;
              setStreamingContent(fullContent);
            } else if (parsed.type === "message" && parsed.content) {
              fullContent += parsed.content;
              setStreamingContent(fullContent);
            } else if (parsed.type === "error") {
              fullContent += `\n\nError: ${parsed.content}`;
              setStreamingContent(fullContent);
            }
          } catch { }
        }
      }

      // Save assistant message after streaming completes
      await addMessage({
        chatId: chatId as Id<"chats">,
        role: "assistant",
        content: fullContent,
      });

    } catch (error) {
      console.error("Chat error:", error);
      setStreamingContent("Sorry, I encountered an error. Please try again.");
    } finally {
      setStreaming(false);
      setStreamingContent("");
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith(".pdf")) {
      alert("Please select a PDF file");
      return;
    }

    setUploading(true);
    try {
      const text = await extractTextFromPDF(file);

      const formData = new FormData();
      formData.append("text", text);
      formData.append("filename", file.name);
      formData.append("chatId", chatId);

      const response = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) throw new Error("Upload failed");

      const result = await response.json();
      console.log("Upload result:", result);

      // No need for manual reload — Convex hooks auto-update
    } catch (error) {
      console.error("Upload error:", error);
      alert("Failed to upload file");
    } finally {
      setUploading(false);
    }
  };

  const goHome = () => router.push("/");

  if (!mounted) {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (chat === undefined) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-foreground">
        <div className="text-muted-foreground">Loading chat...</div>
      </div>
    );
  }

  if (chat === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-foreground">
        <div className="text-muted-foreground">Chat not found</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <header className="border-b border-border px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={goHome}
            className="p-2 text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors rounded-lg group"
            title="Go back"
          >
            <ArrowBackIcon size={20} className="group-hover:-translate-x-0.5 transition-transform" />
          </button>
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${chat.isMain ? "bg-primary" : "bg-muted-foreground/40"}`} />
            <h1 className="text-lg font-semibold">
              {chat.isMain ? "Main Chat" : chat.title || "Chat"}
            </h1>
            {chat.isMain && (
              <span className="text-xs px-2 py-0.5 bg-primary/10 text-primary rounded-full font-medium">
                Main
              </span>
            )}
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          {!chat.isMain && (
            <button
              onClick={handleDelete}
              className="p-2 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors rounded-lg group text-sm font-medium flex items-center gap-2"
              title="Delete chat"
            >
              <TrashIcon size={18} className="group-hover:text-destructive" />
              <span className="hidden sm:inline">Delete</span>
            </button>
          )}
          <button
            onClick={toggleTheme}
            className="p-2 text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors rounded-lg group"
            title={darkMode ? "Switch to light mode" : "Switch to dark mode"}
          >
            {darkMode ? (
              <BulbSvg size={20} className="text-amber-400 group-hover:text-amber-300" />
            ) : (
              <MoonIcon size={20} className="text-slate-600 group-hover:text-slate-800" />
            )}
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {chat.documents && chat.documents.length > 0 && (
          <div className="mb-4 p-3 bg-card border border-border rounded-lg">
            <div className="text-sm font-medium mb-2 text-muted-foreground">Documents</div>
            <div className="flex flex-wrap gap-2">
              {chat.documents.map((doc: any, i: number) => (
                <span key={i} className="px-3 py-1 bg-primary/10 text-primary text-sm rounded-full font-medium">
                  {doc.filename}
                </span>
              ))}
            </div>
          </div>
        )}

        {chat.messages?.length === 0 && !streaming && (
          <div className="text-center py-12 text-muted-foreground">
            {chat.isMain
              ? "Ask me about your past conversations. Try: \"Did we talk about X?\""
              : "Start a conversation or upload a document to begin."
            }
          </div>
        )}

        {chat.messages?.map((msg: any, i: number) => (
          <div key={i} className="mb-4">
            <div className={`font-medium text-xs mb-1.5 uppercase tracking-wide ${msg.role === "user" ? "text-primary" : "text-muted-foreground"}`}>
              {msg.role === "user" ? "You" : "Assistant"}
            </div>
            <div className={`px-4 py-3 rounded-lg ${msg.role === "user" ? "bg-card border border-border" : "bg-secondary text-secondary-foreground"}`}>
              {msg.content}
            </div>
          </div>
        ))}

        {streaming && (
          <div className="mb-4">
            <div className="font-medium text-xs text-muted-foreground mb-1.5 uppercase tracking-wide">Assistant</div>
            <div className="px-4 py-3 bg-secondary text-secondary-foreground rounded-lg">
              {streamingContent}
              <span className="inline-block w-2 h-4 bg-primary ml-0.5 animate-pulse" />
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <div className="border-t border-border px-6 py-4">
        <div className="flex gap-2 max-w-3xl mx-auto">
          <label className="flex items-center justify-center w-12 h-12 shrink-0 bg-secondary text-secondary-foreground hover:bg-accent hover:text-accent-foreground transition-colors cursor-pointer rounded-full border border-border group" title="Upload Document">
            {uploading ? (
              <span className="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin"></span>
            ) : (
              <UploadIcon size={20} className="group-hover:text-amber-500" />
            )}
            <input
              type="file"
              accept=".pdf"
              onChange={handleFileUpload}
              className="hidden"
              disabled={uploading}
            />
          </label>
          <input
            type="text"
            placeholder={chat.isMain ? "Ask about past conversations..." : "Ask about your documents..."}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && sendMessage()}
            disabled={streaming}
            className="flex-1 px-5 py-3 bg-card border border-border text-card-foreground placeholder:text-muted-foreground disabled:opacity-50 rounded-full focus:outline-none focus:ring-2 focus:ring-primary/20 shadow-sm"
          />
          <button
            onClick={sendMessage}
            disabled={streaming || !input.trim()}
            className="flex items-center justify-center w-12 h-12 shrink-0 bg-primary text-primary-foreground hover:bg-primary/90 transition-all font-medium disabled:opacity-50 disabled:cursor-not-allowed rounded-full shadow-md hover:shadow-lg group"
            title="Send Message"
          >
            {streaming ? (
              <span className="w-2 h-2 bg-current rounded-full animate-bounce"></span>
            ) : (
              <SendHorizontalIcon size={20} className="ml-1" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
