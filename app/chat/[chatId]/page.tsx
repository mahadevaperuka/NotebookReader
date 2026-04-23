"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter, useParams } from "next/navigation";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
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
  const chats = useQuery(api.chats.list);
  const chat = useQuery(
    api.chats.getById,
    chatId ? { id: chatId as Id<"chats"> } : "skip"
  );

  const addMessage = useMutation(api.chats.addMessage);
  const deleteChatMutation = useMutation(api.chats.deleteChat);
  const createChatMutation = useMutation(api.chats.create);
  const clearMessages = useMutation(api.chats.clearMessages);

  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [darkMode, setDarkMode] = useState(false);
  const [uploadPhase, setUploadPhase] = useState<"idle" | "reading" | "uploading" | "done">("idle");
  const [mounted, setMounted] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [previewDoc, setPreviewDoc] = useState<{ filename: string; content: string } | null>(null);
  const [dragOver, setDragOver] = useState(false);
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

      // Update dynamic memory index in the background (fire and forget)
      if (!chat?.isMain) {
        fetch("/api/index-chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chatId }),
          keepalive: true,
        }).catch((err) => console.error("Failed to index chat:", err));
      }

    } catch (error) {
      console.error("Chat error:", error);
      setStreamingContent("Sorry, I encountered an error. Please try again.");
    } finally {
      setStreaming(false);
      setStreamingContent("");
    }
  };

  const processFile = async (file: File) => {
    const allowed = [".pdf", ".docx", ".txt", ".md"];
    const ext = "." + file.name.split(".").pop()?.toLowerCase();
    if (!allowed.includes(ext)) {
      alert(`Unsupported file type. Allowed: ${allowed.join(", ")}`);
      return;
    }

    setUploadPhase("uploading");
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("chatId", chatId);

      const response = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error ?? "Upload failed");
      }

      setUploadPhase("done");
      setTimeout(() => setUploadPhase("idle"), 1500);
    } catch (error) {
      console.error("Upload error:", error);
      alert(error instanceof Error ? error.message : "Failed to upload file");
      setUploadPhase("idle");
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    await processFile(file);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) await processFile(file);
  };

  const goHome = () => router.push("/");

  const createNewChat = async () => {
    try {
      const newChatId = await createChatMutation({ title: "New Document Chat" });
      router.push(`/chat/${newChatId}`);
    } catch (error) {
      console.error("Failed to create chat:", error);
    }
  };

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    
    if (days === 0) return "Today";
    if (days === 1) return "Yesterday";
    if (days < 7) return `${days} d`;
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };

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

  // Sort chats for sidebar
  const standardChats = chats
    ? chats.filter((c) => !c.isMain).sort((a, b) => b.updatedAt - a.updatedAt)
    : [];
  const mainChat = chats ? chats.find((c) => c.isMain) : null;

  return (
    <div className="h-screen overflow-hidden bg-background text-foreground flex relative">
      {/* SIDEBAR (Desktop) */}
      <aside className={`w-[260px] border-r border-border bg-secondary/20 flex-col shrink-0 ${sidebarOpen ? "hidden md:flex" : "hidden"}`}>
        <div className="p-4 border-b border-border">
          <button
            onClick={createNewChat}
            className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-card text-foreground border-2 border-[#3674B5] dark:border-[#578FCA] font-medium active:scale-[0.98] shadow-[4px_4px_0px_0px_#3674B5] dark:shadow-[4px_4px_0px_0px_#578FCA] hover:translate-x-1 hover:translate-y-1 hover:shadow-none transition-all"
          >
            <span className="text-xl leading-none font-medium">+</span> New Chat
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-4">
          {mainChat && (
            <div>
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-2">Navigation</div>
              <button
                onClick={() => router.push(`/chat/${mainChat._id}`)}
                className={`w-full text-left px-3 py-2 transition-colors flex items-center gap-2 ${
                  chatId === mainChat._id 
                    ? "bg-primary/10 text-primary font-medium" 
                    : "hover:bg-secondary/50 text-foreground"
                }`}
              >
                <div className={`w-2 h-2 rounded-full ${chatId === mainChat._id ? "bg-primary" : "bg-primary/40"}`} />
                <span className="truncate">Search Assistant</span>
              </button>
            </div>
          )}

          <div>
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-2">Recent Docs</div>
            <div className="space-y-0.5">
              {standardChats.map((c) => (
                <button
                  key={c._id}
                  onClick={() => router.push(`/chat/${c._id}`)}
                  className={`w-full text-left px-3 py-2 transition-colors flex justify-between items-center group ${
                    chatId === c._id 
                      ? "bg-secondary text-foreground font-medium" 
                      : "hover:bg-secondary/50 text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <span className="truncate flex-1">{c.title || "Untitled Chat"}</span>
                  <span className="text-[10px] opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pl-2">
                    {formatDate(c.updatedAt)}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </aside>

      {/* MAIN CHAT */}
      <main
        className="flex-1 flex flex-col min-w-0 relative"
        onDragOver={(e) => { e.preventDefault(); if (!chat.isMain && uploadPhase === "idle") setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
      >
        {dragOver && (
          <div className="absolute inset-0 z-20 border-4 border-dashed border-[#3674B5] dark:border-[#578FCA] bg-primary/5 flex items-center justify-center pointer-events-none">
            <div className="text-xl font-bold text-primary">Drop PDF to upload</div>
          </div>
        )}
        <header className="border-b border-border px-6 py-3 flex items-center justify-between shrink-0 bg-background/80 backdrop-blur-md z-10">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="p-2 text-muted-foreground hover:text-foreground transition-colors group hidden md:flex border border-transparent hover:border-border hover:bg-secondary"
              title="Toggle Sidebar"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square" strokeLinejoin="miter"><rect x="3" y="3" width="18" height="18"/><line x1="9" y1="3" x2="9" y2="21"/></svg>
            </button>
            <button
              onClick={goHome}
              className="p-2 text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors group border border-transparent hover:border-border md:hidden"
              title="Go back"
            >
              <ArrowBackIcon size={20} className="group-hover:-translate-x-0.5 transition-transform" />
            </button>
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${chat.isMain ? "bg-primary" : "bg-muted-foreground/40"}`} />
              <h1 className="text-lg font-semibold truncate max-w-[200px] sm:max-w-md">
                {chat.isMain ? "Global Search Assistant" : chat.title || "Chat"}
              </h1>
              {chat.isMain && (
                <span className="hidden sm:inline-block text-xs px-2 py-0.5 bg-primary/10 text-primary rounded-full font-medium">
                  Main
                </span>
              )}
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            {chat.isMain && (
              <button
                onClick={() => clearMessages({ chatId: chatId as Id<"chats"> })}
                className="p-2 text-muted-foreground hover:text-foreground transition-colors text-sm font-medium flex items-center gap-1.5 border border-transparent hover:border-border hover:bg-secondary"
                title="Clear search history"
              >
                <TrashIcon size={16} />
                <span className="hidden sm:inline">Clear</span>
              </button>
            )}
            {!chat.isMain && (
              <button
                onClick={handleDelete}
                className="p-2 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors group text-sm font-medium flex items-center gap-2"
                title="Delete chat"
              >
                <TrashIcon size={18} className="group-hover:text-destructive" />
                <span className="hidden sm:inline">Delete</span>
              </button>
            )}
            <button
              onClick={toggleTheme}
              className="p-2 text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors group"
              title={darkMode ? "Switch to light mode" : "Switch to dark mode"}
            >
              {darkMode ? (
                <BulbSvg size={20} className="text-muted-foreground group-hover:text-foreground" />
              ) : (
                <MoonIcon size={20} className="text-muted-foreground group-hover:text-foreground" />
              )}
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-6 pb-8">
          <div className="max-w-3xl mx-auto w-full">
            {chat.documents && chat.documents.length > 0 && (
              <div className="mb-6 p-3 bg-card border border-border shadow-sm">
                <div className="text-sm font-medium mb-2 text-muted-foreground">Documents referenced — click to preview</div>
                <div className="flex flex-wrap gap-2">
                  {chat.documents.map((doc: any, i: number) => (
                    <button
                      key={i}
                      onClick={() => setPreviewDoc({ filename: doc.filename, content: doc.content })}
                      className="px-3 py-1 bg-primary/10 text-primary text-sm font-medium border border-primary/20 hover:bg-primary/20 transition-colors"
                    >
                      {doc.filename}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {chat.messages?.length === 0 && !streaming && (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <div className="w-16 h-16 bg-secondary flex items-center justify-center mb-4">
                  <span className="text-2xl">👋</span>
                </div>
                <h3 className="text-xl font-medium mb-2">{chat.isMain ? "Search Assistant" : "New Document Chat"}</h3>
                <p className="text-muted-foreground max-w-md">
                  {chat.isMain
                    ? "Ask me to find specific topics or files across all your past conversations."
                    : "Upload a PDF document to begin chatting with it."
                  }
                </p>
              </div>
            )}

            {chat.messages?.map((msg: any, i: number) => (
              <div key={i} className={`mb-6 flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[85%] px-5 py-4 ${
                  msg.role === "user" 
                    ? "bg-primary text-primary-foreground" 
                    : "bg-secondary text-secondary-foreground border border-border shadow-sm"
                }`}>
                  {msg.role === "assistant" ? (
                    <div className="prose prose-sm md:prose-base max-w-none prose-p:leading-relaxed prose-pre:bg-black/10 dark:prose-pre:bg-black/40 prose-pre:backdrop-blur-sm prose-a:text-primary dark:prose-a:text-indigo-400 prose-p:text-current prose-headings:text-current prose-strong:text-current prose-li:text-current text-current">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {msg.content}
                      </ReactMarkdown>
                    </div>
                  ) : (
                    <div className="whitespace-pre-wrap">{msg.content}</div>
                  )}
                </div>
              </div>
            ))}

            {streaming && (
              <div className="mb-6 flex justify-start">
                <div className="max-w-[85%] px-5 py-4 bg-secondary text-secondary-foreground border border-border shadow-sm">
                  {streamingContent ? (
                    <div className="prose prose-sm md:prose-base max-w-none prose-p:leading-relaxed prose-p:text-current prose-headings:text-current prose-strong:text-current prose-li:text-current text-current">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {streamingContent + " █"}
                      </ReactMarkdown>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 h-6">
                      <span className="w-2 h-2 bg-muted-foreground/40 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                      <span className="w-2 h-2 bg-muted-foreground/40 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                      <span className="w-2 h-2 bg-muted-foreground/40 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                    </div>
                  )}
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* INPUT AREA */}
        <div className="border-t border-border px-6 py-4 shrink-0 bg-background/80 backdrop-blur-md">
          <div className="flex gap-3 max-w-3xl mx-auto w-full">
            <label
              className={`flex flex-col items-center justify-center w-12 h-12 shrink-0 bg-card text-foreground border-2 border-[#3674B5] dark:border-[#578FCA] shadow-[4px_4px_0px_0px_#3674B5] dark:shadow-[4px_4px_0px_0px_#578FCA] hover:translate-x-1 hover:translate-y-1 hover:shadow-none transition-all group ${uploadPhase === "idle" ? "cursor-pointer" : "cursor-default"}`}
              title={uploadPhase === "uploading" ? "Uploading..." : uploadPhase === "done" ? "Done!" : "Upload PDF, DOCX, TXT, MD"}
            >
              {uploadPhase === "idle" && <UploadIcon size={20} className="group-hover:scale-110 transition-transform" />}
              {uploadPhase === "uploading" && (
                <span className="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin" />
              )}
              {uploadPhase === "done" && <span className="text-lg leading-none">✓</span>}
              {uploadPhase !== "idle" && (
                <span className="text-[8px] font-bold leading-none mt-0.5 uppercase tracking-tight">
                  {uploadPhase === "uploading" ? "Save" : "Done"}
                </span>
              )}
              <input
                type="file"
                accept=".pdf,.docx,.txt,.md"
                onChange={handleFileUpload}
                className="hidden"
                disabled={uploadPhase !== "idle"}
              />
            </label>
            <div className="flex-1 relative flex items-center">
              <input
                type="text"
                placeholder={chat.isMain ? "Ask about past conversations..." : "Ask a question about your documents..."}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendMessage()}
                disabled={streaming}
                className="w-full pl-5 pr-14 py-3.5 bg-card border border-border text-card-foreground placeholder:text-muted-foreground disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-primary/20 shadow-sm transition-all"
              />
              <button
                onClick={sendMessage}
                disabled={streaming || !input.trim()}
                className="absolute right-1.5 z-10 flex items-center justify-center w-9 h-9 shrink-0 bg-card text-foreground font-medium disabled:opacity-50 disabled:cursor-not-allowed border-2 border-[#3674B5] dark:border-[#578FCA] shadow-[2px_2px_0px_0px_#3674B5] dark:shadow-[2px_2px_0px_0px_#578FCA] hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-none transition-all"
                title="Send Message"
              >
                <SendHorizontalIcon size={18} className="translate-x-0.5 group-hover:translate-x-1 transition-transform" />
              </button>
            </div>
          </div>
        </div>
      </main>

      {/* DOCUMENT PREVIEW MODAL */}
      {previewDoc && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={() => setPreviewDoc(null)}
        >
          <div
            className="relative w-full max-w-2xl max-h-[80vh] mx-4 bg-background border-2 border-[#3674B5] dark:border-[#578FCA] shadow-[8px_8px_0px_0px_#3674B5] dark:shadow-[8px_8px_0px_0px_#578FCA] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0">
              <span className="font-bold truncate pr-4">{previewDoc.filename}</span>
              <button
                onClick={() => setPreviewDoc(null)}
                className="shrink-0 px-3 py-1 border-2 border-[#3674B5] dark:border-[#578FCA] shadow-[2px_2px_0px_0px_#3674B5] dark:shadow-[2px_2px_0px_0px_#578FCA] hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-none transition-all text-sm font-medium"
              >
                Close
              </button>
            </div>
            <div className="overflow-y-auto px-5 py-4 text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed font-mono">
              {previewDoc.content.slice(0, 3000)}
              {previewDoc.content.length > 3000 && (
                <span className="block mt-4 text-xs text-muted-foreground/60 italic">
                  … {Math.round((previewDoc.content.length - 3000) / 1000)}k more characters not shown
                </span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

