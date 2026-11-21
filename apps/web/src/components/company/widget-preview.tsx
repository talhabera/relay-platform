"use client";

import { useState } from "react";
import type { WidgetConfig } from "@/types";

type WidgetPreviewProps = {
  config: Partial<WidgetConfig> & {
    title?: string | null;
    primaryColor?: string | null;
    position?: string | null;
    welcomeMessage?: string | null;
    theme?: string | null;
    showBranding?: boolean | null;
  };
  companyName?: string;
};

function contrastColor(hex: string): string {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return "#ffffff";
  const r = parseInt(result[1], 16);
  const g = parseInt(result[2], 16);
  const b = parseInt(result[3], 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? "#000000" : "#ffffff";
}

export function WidgetPreview({
  config,
  companyName = "Your Company",
}: WidgetPreviewProps) {
  const [isOpen, setIsOpen] = useState(true);

  const primaryColor = config.primaryColor ?? "#6366f1";
  const textOnPrimary = contrastColor(primaryColor);
  const title = config.title ?? "Chat with us";
  const welcomeMessage =
    config.welcomeMessage ?? "Hi there! How can I help you today?";
  const theme = config.theme ?? "auto";
  const showBranding = config.showBranding ?? true;
  const position = config.position ?? "bottom-right";
  const isRight = position !== "bottom-left";

  // Determine theme colors
  const isDark = theme === "dark";
  const panelBg = isDark ? "#1e1e2e" : "#ffffff";
  const messageBg = isDark ? "#2a2a3c" : "#f3f4f6";
  const messageText = isDark ? "#e2e2f0" : "#1f2937";
  const inputBg = isDark ? "#2a2a3c" : "#ffffff";
  const inputBorder = isDark ? "#3a3a4c" : "#e5e7eb";
  const borderColor = isDark ? "#3a3a4c" : "#e5e7eb";
  const timestampColor = "#9ca3af";
  const mockBg = isDark ? "#111827" : "#f9fafb";

  return (
    <div className="relative rounded-xl border bg-muted/30 overflow-hidden">
      {/* Mock website background */}
      <div
        className="relative p-6"
        style={{
          background: mockBg,
          minHeight: 480,
        }}
      >
        {/* Mock website content */}
        <div className="space-y-3 opacity-30">
          <div
            className="h-6 rounded"
            style={{ background: borderColor, width: "60%" }}
          />
          <div
            className="h-4 rounded"
            style={{ background: borderColor, width: "90%" }}
          />
          <div
            className="h-4 rounded"
            style={{ background: borderColor, width: "75%" }}
          />
          <div
            className="h-4 rounded"
            style={{ background: borderColor, width: "85%" }}
          />
          <div className="h-32 rounded" style={{ background: borderColor }} />
          <div
            className="h-4 rounded"
            style={{ background: borderColor, width: "70%" }}
          />
        </div>

        {/* Chat panel preview */}
        {isOpen && (
          <div
            className="absolute transition-all duration-200"
            style={{
              bottom: 72,
              [isRight ? "right" : "left"]: 16,
              width: 320,
              maxHeight: 380,
              background: panelBg,
              borderRadius: 14,
              boxShadow: "0 8px 30px rgba(0,0,0,0.15)",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              border: `1px solid ${borderColor}`,
            }}
          >
            {/* Header */}
            <div
              style={{
                background: primaryColor,
                color: textOnPrimary,
                padding: "12px 14px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                flexShrink: 0,
              }}
            >
              <span style={{ fontSize: 14, fontWeight: 600 }}>{title}</span>
              <button
                onClick={() => setIsOpen(false)}
                style={{
                  background: "transparent",
                  border: "none",
                  color: textOnPrimary,
                  cursor: "pointer",
                  padding: 2,
                  opacity: 0.8,
                  fontSize: 16,
                  lineHeight: 1,
                }}
                aria-label="Close preview"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="4 14 10 14 10 20" />
                  <polyline points="20 10 14 10 14 4" />
                  <line x1="14" y1="10" x2="21" y2="3" />
                  <line x1="3" y1="21" x2="10" y2="14" />
                </svg>
              </button>
            </div>

            {/* Messages */}
            <div
              style={{
                flex: 1,
                padding: 14,
                display: "flex",
                flexDirection: "column",
                gap: 10,
                overflow: "hidden",
              }}
            >
              {/* Welcome message (assistant) */}
              <div
                style={{
                  alignSelf: "flex-start",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-start",
                  maxWidth: "85%",
                }}
              >
                <div
                  style={{
                    background: messageBg,
                    color: messageText,
                    padding: "8px 12px",
                    borderRadius: 12,
                    borderBottomLeftRadius: 4,
                    fontSize: 13,
                    lineHeight: 1.5,
                  }}
                >
                  {welcomeMessage}
                </div>
                <span
                  style={{
                    fontSize: 10,
                    color: timestampColor,
                    marginTop: 3,
                    paddingLeft: 4,
                  }}
                >
                  just now
                </span>
              </div>

              {/* Example user message */}
              <div
                style={{
                  alignSelf: "flex-end",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-end",
                  maxWidth: "85%",
                }}
              >
                <div
                  style={{
                    background: primaryColor,
                    color: textOnPrimary,
                    padding: "8px 12px",
                    borderRadius: 12,
                    borderBottomRightRadius: 4,
                    fontSize: 13,
                    lineHeight: 1.5,
                  }}
                >
                  Hello! I have a question.
                </div>
                <span
                  style={{
                    fontSize: 10,
                    color: timestampColor,
                    marginTop: 3,
                    paddingRight: 4,
                  }}
                >
                  just now
                </span>
              </div>

              {/* Example assistant response */}
              <div
                style={{
                  alignSelf: "flex-start",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-start",
                  maxWidth: "85%",
                }}
              >
                <div
                  style={{
                    background: messageBg,
                    color: messageText,
                    padding: "8px 12px",
                    borderRadius: 12,
                    borderBottomLeftRadius: 4,
                    fontSize: 13,
                    lineHeight: 1.5,
                  }}
                >
                  Of course! I&apos;d be happy to help. What would you like to
                  know?
                </div>
                <span
                  style={{
                    fontSize: 10,
                    color: timestampColor,
                    marginTop: 3,
                    paddingLeft: 4,
                  }}
                >
                  just now
                </span>
              </div>
            </div>

            {/* Input area */}
            <div
              style={{
                padding: "10px 14px",
                borderTop: `1px solid ${borderColor}`,
                display: "flex",
                gap: 8,
                alignItems: "center",
                flexShrink: 0,
                background: panelBg,
              }}
            >
              <div
                style={{
                  flex: 1,
                  border: `1px solid ${inputBorder}`,
                  borderRadius: 20,
                  padding: "8px 14px",
                  fontSize: 13,
                  color: timestampColor,
                  background: inputBg,
                }}
              >
                Type a message...
              </div>
              <div
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: "50%",
                  background: primaryColor,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke={textOnPrimary}
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="22" y1="2" x2="11" y2="13" />
                  <polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              </div>
            </div>

            {/* Branding */}
            {showBranding && (
              <div
                style={{
                  textAlign: "center",
                  padding: 6,
                  fontSize: 10,
                  color: timestampColor,
                  borderTop: `1px solid ${borderColor}`,
                  background: panelBg,
                  flexShrink: 0,
                }}
              >
                Powered by{" "}
                <span style={{ fontWeight: 500 }}>Relay</span>
              </div>
            )}
          </div>
        )}

        {/* Floating button */}
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="transition-transform hover:scale-110"
          style={{
            position: "absolute",
            bottom: 16,
            [isRight ? "right" : "left"]: 16,
            width: 48,
            height: 48,
            borderRadius: "50%",
            border: "none",
            background: primaryColor,
            color: textOnPrimary,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
          }}
          aria-label={isOpen ? "Close chat preview" : "Open chat preview"}
        >
          {isOpen ? (
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          ) : (
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.17L4 17.17V4h16v12z" />
              <path d="M7 9h2v2H7zm4 0h2v2h-2zm4 0h2v2h-2z" />
            </svg>
          )}
        </button>
      </div>

      {/* Label */}
      <div className="px-4 py-2 text-center text-xs text-muted-foreground border-t">
        Widget Preview &mdash; {companyName}
      </div>
    </div>
  );
}
