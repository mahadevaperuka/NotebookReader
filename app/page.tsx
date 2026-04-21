"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation } from "convex/react";
import { api } from "../convex/_generated/api";
import MoonIcon from "../components/icons/moon-icon";
import BulbSvg from "../components/icons/bulb-svg";

export default function Home() {
  const router = useRouter();
  const chats = useQuery(api.chats.list);
  const createChatMutation = useMutation(api.chats.create);
  const createMainChatMutation = useMutation(api.chatIndex.createMainChat);

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

  // Auto-create main chat if it doesn't exist
  useEffect(() => {
    if (chats && !chats.find((c) => c.isMain)) {
      createMainChatMutation();
    }
  }, [chats, createMainChatMutation]);

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
    const title = newChatTitle.trim() || `Chat ${(chats?.length ?? 0)}`;
    try {
      const chatId = await createChatMutation({ title });
      setNewChatTitle("");
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
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  // Separate main chat from standard chats
  const standardChats = chats
    ? chats.filter((c) => !c.isMain).sort((a, b) => b.updatedAt - a.updatedAt)
    : null;
    
  const mainChat = chats ? chats.find((c) => c.isMain) : null;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
            <span className="text-primary-foreground text-sm font-bold">N</span>
          </div>
          <h1 className="text-xl font-semibold">NotebookReader</h1>
        </div>
        <button
          onClick={toggleTheme}
          className="p-2 text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors rounded-lg group"
          title={darkMode ? "Switch to light mode" : "Switch to dark mode"}
        >
          {darkMode ? (
            <BulbSvg size={20} className="text-muted-foreground group-hover:text-foreground" />
          ) : (
            <MoonIcon size={20} className="text-muted-foreground group-hover:text-foreground" />
          )}
        </button>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-8">
        {mainChat && (
          <div className="mb-10">
            <button
              onClick={() => router.push(`/chat/${mainChat._id}`)}
              className="w-full flex items-center justify-between p-6 bg-primary/10 border border-primary/20 rounded-xl hover:bg-primary/15 transition-all text-left relative overflow-hidden group"
            >
              <div className="absolute top-0 right-0 w-32 h-32 bg-primary/10 rounded-full blur-2xl -mr-10 -mt-10 pointer-events-none" />
              <div>
                <h2 className="text-xl font-semibold text-primary mb-1">Global Search Assistant</h2>
                <p className="text-sm text-primary/80">Search your past conversations, ask questions across documents, and navigate your chats.</p>
              </div>
              <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center group-hover:scale-110 transition-transform">
                <span className="text-primary text-xl">&rarr;</span>
              </div>
            </button>
          </div>
        )}

        <div className="mb-6">
          <h2 className="text-2xl font-semibold mb-1">Document Chats</h2>
          <p className="text-muted-foreground text-sm">Upload documents and chat with them independently</p>
        </div>

        <div className="flex gap-2 mb-8">
          <input
            type="text"
            placeholder="New chat title..."
            value={newChatTitle}
            onChange={(e) => setNewChatTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && createNewChat()}
            className="flex-1 px-4 py-2.5 bg-card border border-border text-card-foreground placeholder:text-muted-foreground rounded-lg"
          />
          <button
            onClick={createNewChat}
            className="px-5 py-2.5 bg-primary text-primary-foreground hover:bg-accent transition-colors font-medium rounded-lg"
          >
            New Chat
          </button>
        </div>

        <div className="space-y-2">
          {standardChats === null ? (
            <div className="text-center py-12 text-muted-foreground">Loading chats...</div>
          ) : standardChats.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              No document chats yet. Create one to get started!
            </div>
          ) : (
            standardChats.map((chat) => (
              <button
                key={chat._id}
                onClick={() => router.push(`/chat/${chat._id}`)}
                className="w-full text-left px-4 py-3.5 bg-card border border-border hover:border-primary/40 hover:bg-secondary transition-all rounded-lg group"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-2 h-2 rounded-full bg-muted-foreground/40" />
                    <span className="font-medium">
                      {chat.title}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-muted-foreground text-sm">
                      {formatDate(chat.updatedAt)}
                    </span>
                    <span className="text-muted-foreground group-hover:text-primary transition-colors">&rarr;</span>
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </main>
    </div>
  );
}
