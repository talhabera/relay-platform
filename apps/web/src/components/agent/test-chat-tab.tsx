"use client";

import { useState, useRef, useEffect } from "react";
import { toast } from "sonner";
import {
  Send,
  Trash2,
  Bot,
  User,
  Loader2,
  MessageSquare,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Chip, StatusChip } from "@/components/v2/primitives";
import { useChatWithAgent } from "@/hooks/use-chat-with-agent";
import { isToolUIPart, getToolName, type UIMessage } from "ai";

function getTextFromParts(parts: UIMessage["parts"]): string {
  return parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");
}

function formatMarkdown(text: string): string {
  let html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Extract code blocks into placeholders
  const codeBlocks: string[] = [];
  html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (_m, _lang, code) => {
    const idx = codeBlocks.length;
    codeBlocks.push(
      '<pre class="my-2 rounded-md bg-muted-foreground/10 p-3 overflow-x-auto"><code class="text-xs font-mono">' +
        code.trim() +
        "</code></pre>"
    );
    return `\x00CB${idx}\x00`;
  });

  // Extract inline code into placeholders
  const inlineCodes: string[] = [];
  html = html.replace(/`([^`]+)`/g, (_m, code) => {
    const idx = inlineCodes.length;
    inlineCodes.push(
      '<code class="rounded bg-muted-foreground/10 px-1.5 py-0.5 text-xs font-mono">' +
        code +
        "</code>"
    );
    return `\x00IC${idx}\x00`;
  });

  // Bold, italic, strikethrough
  html = html
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/__(.+?)__/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/_(.+?)_/g, "<em>$1</em>")
    .replace(/~~(.+?)~~/g, "<del>$1</del>");

  // Line breaks
  html = html.replace(/\n/g, "<br>");

  // Restore placeholders
  html = html.replace(/\x00IC(\d+)\x00/g, (_m, idx) => inlineCodes[+idx]);
  html = html.replace(/\x00CB(\d+)\x00/g, (_m, idx) => codeBlocks[+idx]);

  return html;
}

function getToolNamesFromParts(parts: UIMessage["parts"]): string[] {
  return parts.filter(isToolUIPart).map(getToolName);
}

type TestChatTabProps = {
  agentId: string;
  agentName: string;
  companyId: string;
};

export function TestChatTab({ agentId, agentName, companyId }: TestChatTabProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [input, setInput] = useState("");

  const { messages, sendMessage, status, setMessages, error } = useChatWithAgent({
    agentId,
    companyId,
  });

  const isStreaming = status === "streaming";

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    if (error) {
      toast.error("Failed to get response");
    }
  }, [error]);

  function clearChat() {
    setMessages([]);
    toast.success("Chat cleared");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || isStreaming) return;

    const text = input.trim();
    setInput("");
    await sendMessage({ text });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Test Chat</h3>
          <p className="text-sm text-muted-foreground">
            Send test messages to see how your agent responds.
          </p>
        </div>
        {messages.length > 0 && (
          <Button variant="outline" size="sm" onClick={clearChat}>
            <Trash2 className="mr-2 h-3.5 w-3.5" />
            Clear Chat
          </Button>
        )}
      </div>

      <Card className="flex flex-col" style={{ height: "500px" }}>
        <CardHeader className="border-b py-3">
          <div className="flex items-center gap-2">
            <Bot className="h-4 w-4 text-primary" />
            <CardTitle className="text-sm">{agentName}</CardTitle>
            <StatusChip tone="draft">Test Mode</StatusChip>
          </div>
        </CardHeader>
        <CardContent className="flex-1 p-0 overflow-hidden">
          <ScrollArea className="h-full p-4" ref={scrollRef}>
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full py-12 text-center">
                <MessageSquare className="h-8 w-8 text-muted-foreground mb-3" />
                <p className="text-sm font-medium">Start a conversation</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Type a message below to test your agent.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {messages.map((message) => {
                  const textContent = getTextFromParts(message.parts);
                  const toolsUsed = getToolNamesFromParts(message.parts);

                  return (
                    <div
                      key={message.id}
                      className={`flex gap-3 ${
                        message.role === "user" ? "justify-end" : "justify-start"
                      }`}
                    >
                      {message.role === "assistant" && (
                        <div className="rounded-full bg-primary/10 p-1.5 h-fit">
                          <Bot className="h-3.5 w-3.5 text-primary" />
                        </div>
                      )}
                      <div
                        className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                          message.role === "user"
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted"
                        }`}
                      >
                        <div
                          className="[&_pre]:whitespace-pre-wrap"
                          dangerouslySetInnerHTML={{
                            __html: formatMarkdown(textContent),
                          }}
                        />
                        {toolsUsed.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-2 pt-2 border-t border-border/50">
                            <span className="text-xs text-muted-foreground">
                              Tools used:
                            </span>
                            {toolsUsed.map((tool, idx) => (
                              <Chip asStatic key={`${tool}-${idx}`}>
                                {tool}
                              </Chip>
                            ))}
                          </div>
                        )}
                      </div>
                      {message.role === "user" && (
                        <div className="rounded-full bg-muted p-1.5 h-fit">
                          <User className="h-3.5 w-3.5" />
                        </div>
                      )}
                    </div>
                  );
                })}
                {isStreaming && (
                  <div className="flex gap-3 justify-start">
                    <div className="rounded-full bg-primary/10 p-1.5 h-fit">
                      <Bot className="h-3.5 w-3.5 text-primary" />
                    </div>
                    <div className="bg-muted rounded-lg px-3 py-2">
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    </div>
                  </div>
                )}
              </div>
            )}
          </ScrollArea>
        </CardContent>
        <div className="border-t p-3">
          <form onSubmit={handleSubmit} className="flex gap-2">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type a message..."
              disabled={isStreaming}
              className="flex-1"
            />
            <Button type="submit" size="icon" disabled={isStreaming || !input.trim()}>
              <Send className="h-4 w-4" />
            </Button>
          </form>
        </div>
      </Card>
    </div>
  );
}
