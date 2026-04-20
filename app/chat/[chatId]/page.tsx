"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter, useParams } from "next/navigation";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../convex/_generated/api";
import { extractTextFromPDF } from "../../../lib/pdf-client";

const convex = new ConvexHttpClient(
  process.env.NEXT_PUBLIC_CONVEX_URL || "https://superb-bison-966.convex.cloud"
);

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface Chat {
  _id: string;
  title: string;
  isMain: boolean;
  messages: Array<{ role: string; content: string; timestamp: number }>;
  documents: Array<{ _id: string; filename: string }> | null;
}

export default function ChatPage() {
  const router = useRouter();
  const params = useParams();
  const chatId = params?.chatId as string;

  const [chat, setChat] = useState<Chat | null>(null);
  const [loading, setLoading] = useState(true);
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
    if (chatId) {
      loadChat();
    }
  }, [chatId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat?.messages, streamingContent]);

  const loadChat = async () => {
    try {
      const chatData: any = await convex.query(api.chats.getById, { id: chatId as any });
      setChat(chatData);
    } catch (error) {
      console.error("Failed to load chat:", error);
    } finally {
      setLoading(false);
    }
  };

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

  const sendMessage = async () => {
    if (!input.trim() || streaming) return;

    const userMessage = input.trim();
    setInput("");
    setStreaming(true);
    setStreamingContent("");

    const newMessages = [
      ...(chat?.messages || []),
      { role: "user", content: userMessage, timestamp: Date.now() },
    ];
    setChat({ ...chat!, messages: newMessages as any });

    try {
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

      await convex.mutation(api.chats.addMessage, {
        chatId: chatId as any,
        role: "user",
        content: userMessage,
      });

      await convex.mutation(api.chats.addMessage, {
        chatId: chatId as any,
        role: "assistant",
        content: fullContent,
      });

      loadChat();
    } catch (error) {
      console.error("Chat error:", error);
      setStreamingContent("Sorry, I encountered an error. Please try again.");
    } finally {
      setStreaming(false);
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

      loadChat();
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
        Loading...
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-foreground">
        Loading...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <header className="border-b border-border px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={goHome}
            className="px-4 py-2 bg-secondary text-secondary-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
          >
            ← Home
          </button>
          <h1 className="text-lg font-semibold">
            {chat?.isMain ? "🏠 Main Chat" : chat?.title || "Chat"}
          </h1>
        </div>
        <button
          onClick={toggleTheme}
          className="w-10 h-10 flex items-center justify-center bg-secondary text-secondary-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
        >
          {darkMode ? "☀️" : "🌙"}
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {chat?.documents && chat.documents.length > 0 && (
          <div className="mb-4 p-3 bg-card border border-border">
            <div className="text-sm font-medium mb-2">Documents:</div>
            <div className="flex flex-wrap gap-2">
              {chat.documents.map((doc: any, i: number) => (
                <span key={i} className="px-2 py-1 bg-secondary text-secondary-foreground text-sm">
                  📄 {doc.filename}
                </span>
              ))}
            </div>
          </div>
        )}

        {chat?.messages?.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            {chat.isMain
              ? "Ask me about your past conversations! Try: 'Did we talk about X?'"
              : "Start a conversation or upload a document to begin."
            }
          </div>
        )}

        {chat?.messages?.map((msg: any, i: number) => (
          <div key={i} className="mb-4">
            <div className={`font-medium text-sm mb-1 ${msg.role === "user" ? "text-primary" : "text-muted-foreground"}`}>
              {msg.role === "user" ? "You" : "Assistant"}
            </div>
            <div className={`px-4 py-3 ${msg.role === "user" ? "bg-card border border-border" : "bg-secondary text-secondary-foreground"}`}>
              {msg.content}
            </div>
          </div>
        ))}

        {streaming && (
          <div className="mb-4">
            <div className="font-medium text-sm text-muted-foreground mb-1">Assistant</div>
            <div className="px-4 py-3 bg-secondary text-secondary-foreground">
              {streamingContent}
              <span className="animate-pulse">▊</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <div className="border-t border-border px-6 py-4">
        <div className="flex gap-2 max-w-3xl mx-auto">
          <label className="px-4 py-3 bg-secondary text-secondary-foreground hover:bg-accent hover:text-accent-foreground transition-colors cursor-pointer">
            {uploading ? "Uploading..." : "📎"}
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
            placeholder={chat?.isMain ? "Ask about past conversations..." : "Ask about your documents..."}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && sendMessage()}
            disabled={streaming}
            className="flex-1 px-4 py-3 bg-card border border-border text-card-foreground placeholder:text-muted-foreground disabled:opacity-50"
          />
          <button
            onClick={sendMessage}
            disabled={streaming || !input.trim()}
            className="px-6 py-3 bg-primary text-primary-foreground hover:bg-accent transition-colors font-medium disabled:opacity-50"
          >
            {streaming ? "..." : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}
