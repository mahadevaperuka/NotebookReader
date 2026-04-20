"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";

const convex = new ConvexHttpClient(
  process.env.NEXT_PUBLIC_CONVEX_URL || "https://superb-bison-966.convex.cloud"
);

interface Chat {
  _id: string;
  title: string;
  isMain: boolean;
  createdAt: number;
  updatedAt: number;
}

export default function Home() {
  const router = useRouter();
  const [chats, setChats] = useState<Chat[]>([]);
  const [loading, setLoading] = useState(true);
  const [darkMode, setDarkMode] = useState(false);
  const [newChatTitle, setNewChatTitle] = useState("");
  const [mounted, setMounted] = useState(false);

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
    loadChats();
  }, []);

  const loadChats = async () => {
    try {
      let allChats = await convex.query(api.chats.list);
      
      const mainChat = allChats.find((c: Chat) => c.isMain);
      if (!mainChat) {
        await convex.mutation(api.chatIndex.createMainChat, {});
        allChats = await convex.query(api.chats.list);
      }
      
      const main = allChats.find((c: Chat) => c.isMain);
      const others = allChats.filter((c: Chat) => !c.isMain).sort((a: Chat, b: Chat) => b.updatedAt - a.updatedAt);
      
      if (main) {
        setChats([main, ...others]);
      } else {
        setChats(others);
      }
    } catch (error) {
      console.error("Failed to load chats:", error);
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

  const createNewChat = async () => {
    const title = newChatTitle.trim() || `Chat ${chats.length}`;
    try {
      const chatId = await convex.mutation(api.chats.create, { title });
      router.push(`/chat/${chatId}`);
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
    if (days < 7) return `${days} days ago`;
    return date.toLocaleDateString();
  };

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
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border px-6 py-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">NotebookReader</h1>
        <button
          onClick={toggleTheme}
          className="w-10 h-10 flex items-center justify-center bg-secondary text-secondary-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
        >
          {darkMode ? "☀️" : "🌙"}
        </button>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-8">
        <div className="mb-8">
          <h2 className="text-2xl font-semibold mb-2">Your Chats</h2>
          <p className="text-muted-foreground">Select a chat or create a new one</p>
        </div>

        <div className="flex gap-2 mb-8">
          <input
            type="text"
            placeholder="New chat title..."
            value={newChatTitle}
            onChange={(e) => setNewChatTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && createNewChat()}
            className="flex-1 px-4 py-3 bg-card border border-border text-card-foreground placeholder:text-muted-foreground"
          />
          <button
            onClick={createNewChat}
            className="px-6 py-3 bg-primary text-primary-foreground hover:bg-accent transition-colors font-medium"
          >
            New Chat
          </button>
        </div>

        <div className="space-y-2">
          {chats.map((chat) => (
            <button
              key={chat._id}
              onClick={() => router.push(`/chat/${chat._id}`)}
              className="w-full text-left px-4 py-4 bg-card border border-border hover:bg-secondary transition-colors"
            >
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-medium">
                    {chat.isMain ? "🏠 " : ""}
                    {chat.title}
                  </span>
                  <span className="text-muted-foreground text-sm ml-2">
                    {formatDate(chat.updatedAt)}
                  </span>
                </div>
                <span className="text-muted-foreground">→</span>
              </div>
            </button>
          ))}

          {chats.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              No chats yet. Create one to get started!
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
