(function () {
  "use strict";

  // Relay customer widget. Embedded on client sites with either
  //   <script src="https://app.relay.ai/widget.js" data-widget-id="..."></script>
  // or the dynamic loader at /company-widget/{widgetId}. Both stay supported.
  //
  // The UI lives in a Shadow DOM so host-page CSS cannot leak in and ours
  // cannot leak out. Design tokens are inlined below (docs/design/tokens.json,
  // Figma page 07 widget-mobile/* and widget-desktop/*).

  // ── State ───────────────────────────────────────────────────────────────────
  var widgetId = null;
  var config = {};
  var messages = [];
  var visitorId = null;
  var chatId = null;
  var isOpen = false;
  var isLoading = false;
  var baseUrl = "";
  // Newest message id the server gave us (human replies, synced transcript).
  // Cursor for /messages and /events.
  var lastServerId = null;
  var eventSource = null;
  var handoffStatus = null;
  // Handoff states (S62): the person named on the request, whether they are
  // typing, and where the "joined the chat" line sits in the transcript.
  var handoffPerson = null;
  var personTyping = false;
  var joinedAfterId = null;
  var lastTypingPost = 0;
  var isOnline = true;

  // Pre-redesign defaults. A config that still carries these values is
  // treated as "not customised" so it renders with Relay tokens.
  var LEGACY_PRIMARY = "#6366f1";
  var LEGACY_WELCOME = "Hi there! How can I help you today?";
  var DEFAULT_TITLE = "Chat with us";
  // Customer typing is posted at most this often during a takeover; the
  // server forgets it after 6 s (lib/handoff/typing.ts).
  var TYPING_POST_INTERVAL_MS = 3000;
  var EMPTY_HEADING = "Hi, how can we help?";

  // ── DOM refs ────────────────────────────────────────────────────────────────
  var host, root, container, button, panel, messagesEl, emptyEl, inputEl, sendBtn;
  var typingIndicator, newChatBtn, offlineEl, handoffEl, joinedEl;
  var nodesById = {};

  // ── Utilities ───────────────────────────────────────────────────────────────

  function generateId() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      var v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function getThemeMode() {
    if (config.theme === "light") return "light";
    if (config.theme === "dark") return "dark";
    // auto: follow system preference
    if (
      window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)").matches
    ) {
      return "dark";
    }
    return "light";
  }

  function hexToRgb(hex) {
    var result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!result) return null;
    return {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16),
    };
  }

  function contrastColor(hex) {
    var rgb = hexToRgb(hex);
    if (!rgb) return "#ffffff";
    var luminance = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
    return luminance > 0.5 ? "#000000" : "#ffffff";
  }

  function customPrimary() {
    var c = config.primaryColor;
    if (!c || !hexToRgb(c)) return null;
    if (String(c).toLowerCase() === LEGACY_PRIMARY) return null;
    return c;
  }

  function initials(name) {
    var words = String(name || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (words.length === 0) return "";
    var first = words[0].charAt(0);
    var second = words.length > 1 ? words[1].charAt(0) : words[0].charAt(1);
    return (first + (second || "")).toUpperCase();
  }

  function formatMarkdown(text) {
    var html = String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    // Extract code blocks into placeholders
    var codeBlocks = [];
    html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, function (_m, _lang, code) {
      var idx = codeBlocks.length;
      codeBlocks.push(
        '<pre class="relay-code-block"><code>' + code.trim() + "</code></pre>"
      );
      return "\x00CB" + idx + "\x00";
    });

    // Extract inline code into placeholders
    var inlineCodes = [];
    html = html.replace(/`([^`]+)`/g, function (_m, code) {
      var idx = inlineCodes.length;
      inlineCodes.push('<code class="relay-inline-code">' + code + "</code>");
      return "\x00IC" + idx + "\x00";
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
    html = html.replace(/\x00IC(\d+)\x00/g, function (_m, idx) {
      return inlineCodes[parseInt(idx, 10)];
    });
    html = html.replace(/\x00CB(\d+)\x00/g, function (_m, idx) {
      return codeBlocks[parseInt(idx, 10)];
    });

    return html;
  }

  // ── Storage ─────────────────────────────────────────────────────────────────

  function saveState() {
    if (!config.persistThread) return;
    try {
      if (chatId) {
        localStorage.setItem("relay_chat_" + widgetId, chatId);
      }
      if (lastServerId) {
        localStorage.setItem("relay_cursor_" + widgetId, lastServerId);
      }
      localStorage.setItem("relay_messages_" + widgetId, JSON.stringify(messages));
    } catch (_e) {
      // localStorage may be full or unavailable
    }
  }

  function loadState() {
    if (!config.persistThread) return;
    try {
      chatId = localStorage.getItem("relay_chat_" + widgetId) || null;
      lastServerId = localStorage.getItem("relay_cursor_" + widgetId) || null;
      var saved = localStorage.getItem("relay_messages_" + widgetId);
      if (saved) {
        var parsed = JSON.parse(saved);
        messages = Array.isArray(parsed) ? parsed : [];
      }
    } catch (_e) {
      messages = [];
    }
    // A stream cut off by a page unload cannot resume.
    messages.forEach(function (m) {
      if (m && m.streaming) {
        delete m.streaming;
        m.error = "interrupted";
      }
    });
    // The pre-redesign widget stored the welcome text as the first assistant
    // message. The welcome now lives in the empty state, so drop it.
    if (
      messages.length > 0 &&
      messages[0] &&
      messages[0].role === "assistant" &&
      messages[0].content === config.welcomeMessage
    ) {
      messages.shift();
    }
  }

  function clearState() {
    try {
      localStorage.removeItem("relay_chat_" + widgetId);
      localStorage.removeItem("relay_messages_" + widgetId);
      localStorage.removeItem("relay_cursor_" + widgetId);
    } catch (_e) {
      // ignore
    }
    disconnectEvents();
    chatId = null;
    lastServerId = null;
    messages = [];
    setHandoff(null);
  }

  // ── Config Fetch ────────────────────────────────────────────────────────────

  function applyConfigDefaults(raw, companyName) {
    var c = raw || {};
    c.companyName = companyName || c.companyName || "";
    c.primaryColor = c.primaryColor || LEGACY_PRIMARY;
    c.position = c.position || "bottom-right";
    c.welcomeMessage =
      c.welcomeMessage !== undefined && c.welcomeMessage !== null
        ? c.welcomeMessage
        : LEGACY_WELCOME;
    c.title = c.title || DEFAULT_TITLE;
    c.theme = c.theme || "auto";
    c.showBranding = c.showBranding !== undefined ? c.showBranding : true;
    c.autoOpen = c.autoOpen !== undefined ? c.autoOpen : false;
    c.autoOpenDelay = c.autoOpenDelay || 3000;
    c.persistThread = c.persistThread !== undefined ? c.persistThread : true;
    return c;
  }

  function fetchConfig() {
    return fetch(baseUrl + "/api/widget/" + widgetId + "/config")
      .then(function (res) {
        if (!res.ok) throw new Error("Config fetch failed: " + res.status);
        return res.json();
      })
      .then(function (data) {
        config = applyConfigDefaults(data.config, data.companyName);
      })
      .catch(function (err) {
        console.error("[Relay Widget] Failed to load config:", err);
        config = applyConfigDefaults({}, "");
      });
  }

  // ── Styles ──────────────────────────────────────────────────────────────────

  // Semantic tokens, light then dark (docs/design/tokens.json).
  var TOKENS = {
    light: {
      "--background": "#ffffff",
      "--foreground": "#151b25",
      "--card": "#ffffff",
      "--surface-raised": "#f7f8fa",
      "--primary": "#147f6b",
      "--primary-foreground": "#ffffff",
      "--primary-soft": "#147f6b1a",
      "--primary-soft-foreground": "#0f5a4d",
      "--primary-glow": "#1a9e854d",
      "--muted-foreground": "#4a5769",
      "--accent": "#eef0f4",
      "--border": "#dde1e8",
      "--border-strong": "#c4cad5",
      "--ring": "#1a9e85",
      "--destructive": "#d13c3c",
      "--shadow": "#0b0f1614",
      "--shadow-strong": "#0b0f1629",
    },
    dark: {
      "--background": "#080c0e",
      "--foreground": "#eef3f4",
      "--card": "#0d1316",
      "--surface-raised": "#121a1d",
      "--primary": "#2dd4bf",
      "--primary-foreground": "#080c0e",
      "--primary-soft": "#2dd4bf1f",
      "--primary-soft-foreground": "#2dd4bf",
      "--primary-glow": "#2dd4bf66",
      "--muted-foreground": "#8a9a9e",
      "--accent": "#1a2427",
      "--border": "#1a2427",
      "--border-strong": "#34454a",
      "--ring": "#2dd4bf",
      "--destructive": "#e05a5a",
      "--shadow": "#00000066",
      "--shadow-strong": "#000000a3",
    },
  };

  function tokenBlock(map) {
    var out = [];
    for (var k in map) {
      if (Object.prototype.hasOwnProperty.call(map, k)) {
        out.push("  " + k + ": " + map[k] + ";");
      }
    }
    return out.join("\n");
  }

  function buildCss() {
    var isRight = config.position !== "bottom-left";
    var side = isRight ? "right" : "left";
    var primary = customPrimary();
    var primaryOverride = primary
      ? "  --primary: " +
        primary +
        "; --primary-foreground: " +
        contrastColor(primary) +
        "; --ring: " +
        primary +
        ";"
      : "";

    return [
      ":host { all: initial; }",

      "#relay-widget-container {",
      tokenBlock(TOKENS.light),
      "  --radius-sm: 6px; --radius-lg: 10px; --radius-xl: 12px; --radius-2xl: 16px; --radius-full: 999px;",
      "  --elevation-2: 0px 2px 6px 0px var(--shadow), 0px 12px 32px 0px var(--shadow-strong);",
      "  --elevation-3: 0px 4px 12px 0px var(--shadow), 0px 24px 64px 0px var(--shadow-strong);",
      "  --focus-ring: 0px 0px 0px 3px var(--primary-glow);",
      "  --font-sans: Geist, 'Geist Sans', ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;",
      "  --font-mono: 'Geist Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;",
      "  color-scheme: light;",
      primaryOverride,
      "}",
      "#relay-widget-container[data-theme='dark'] {",
      tokenBlock(TOKENS.dark),
      "  color-scheme: dark;",
      primaryOverride,
      "}",

      ":where(#relay-widget-container), :where(#relay-widget-container) * {",
      "  box-sizing: border-box; margin: 0; padding: 0;",
      "  font-family: var(--font-sans); -webkit-font-smoothing: antialiased;",
      "}",
      ":where(#relay-widget-container) { font-size: 14px; line-height: 20px; color: var(--foreground); }",
      ":where(#relay-widget-container) button { font: inherit; color: inherit; background: none; border: none; cursor: pointer; }",
      ":where(#relay-widget-container) button:focus-visible, :where(#relay-widget-container) textarea:focus-visible { outline: none; box-shadow: var(--focus-ring); }",

      /* Launcher: 56px teal circle, message-circle glyph, elevation/2 */
      "#relay-widget-btn {",
      "  position: fixed; bottom: 16px; " + side + ": 16px; z-index: 2147483646;",
      "  width: 56px; height: 56px; border-radius: var(--radius-full);",
      "  background: var(--primary); color: var(--primary-foreground);",
      "  display: flex; align-items: center; justify-content: center;",
      "  box-shadow: var(--elevation-2);",
      "  transition: transform 0.15s ease, box-shadow 0.15s ease;",
      "}",
      "#relay-widget-btn:hover { transform: translateY(-1px); }",
      "#relay-widget-btn:focus-visible { box-shadow: var(--elevation-2), var(--focus-ring); }",
      "#relay-widget-btn svg { width: 24px; height: 24px; }",
      "#relay-widget-container.relay-is-open #relay-widget-btn { display: none; }",

      /* Panel: card surface, radius 2xl, elevation/3. Desktop 400x600. */
      "#relay-widget-panel {",
      "  position: fixed; bottom: 16px; " + side + ": 16px; z-index: 2147483647;",
      "  width: 400px; height: 600px; max-height: calc(100vh - 32px);",
      "  max-width: calc(100vw - 32px);",
      "  background: var(--card); color: var(--foreground);",
      "  border: 1px solid var(--border); border-radius: var(--radius-2xl);",
      "  box-shadow: var(--elevation-3);",
      "  display: flex; flex-direction: column; overflow: hidden;",
      "  visibility: hidden; opacity: 0; transform: translateY(12px);",
      "  transition: opacity 0.2s ease, transform 0.2s ease, visibility 0s linear 0.2s;",
      "  pointer-events: none;",
      "}",
      "#relay-widget-panel.relay-open {",
      "  visibility: visible; opacity: 1; transform: none; pointer-events: auto;",
      "  transition: opacity 0.2s ease, transform 0.2s ease, visibility 0s;",
      "}",

      /* Header: initials avatar, title block, close */
      "#relay-widget-header {",
      "  display: flex; align-items: center; gap: 12px; flex-shrink: 0;",
      "  padding: 12px 12px 12px 16px;",
      "  background: var(--card); color: var(--foreground);",
      "  border-bottom: 1px solid var(--border);",
      "}",
      ".relay-avatar {",
      "  width: 32px; height: 32px; flex-shrink: 0; border-radius: var(--radius-full);",
      "  display: flex; align-items: center; justify-content: center; overflow: hidden;",
      "  background: var(--primary-soft); color: var(--primary-soft-foreground);",
      "  font-size: 12px; line-height: 16px;",
      "}",
      ".relay-avatar img { width: 100%; height: 100%; object-fit: cover; display: block; }",
      ".relay-title-block { flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; }",
      "#relay-widget-header-title {",
      "  font-size: 14px; line-height: 20px; font-weight: 500; color: var(--foreground);",
      "  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;",
      "}",
      ".relay-subtitle {",
      "  font-size: 12px; line-height: 16px; color: var(--muted-foreground);",
      "  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;",
      "}",
      "#relay-widget-header-actions { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }",
      ".relay-icon-btn {",
      "  width: 32px; height: 32px; border-radius: var(--radius-full);",
      "  display: flex; align-items: center; justify-content: center;",
      "  color: var(--foreground); transition: background-color 0.15s;",
      "}",
      ".relay-icon-btn:hover { background: var(--accent); }",
      ".relay-icon-btn svg { width: 16px; height: 16px; }",
      ".relay-icon-btn[hidden] { display: none; }",

      /* Messages */
      "#relay-widget-messages {",
      "  flex: 1 1 0; min-height: 0; overflow-y: auto; padding: 16px;",
      "  display: flex; flex-direction: column; gap: 12px;",
      "  overscroll-behavior: contain;",
      "}",
      "#relay-widget-messages::-webkit-scrollbar { width: 6px; }",
      "#relay-widget-messages::-webkit-scrollbar-track { background: transparent; }",
      "#relay-widget-messages::-webkit-scrollbar-thumb { background: var(--border-strong); border-radius: 3px; }",

      /* Open-empty state */
      ".relay-empty { display: flex; flex-direction: column; gap: 12px; }",
      ".relay-empty[hidden] { display: none; }",
      ".relay-empty-title { font-size: 18px; line-height: 24px; font-weight: 600; color: var(--foreground); }",
      ".relay-empty-body { font-size: 14px; line-height: 20px; color: var(--muted-foreground); white-space: pre-wrap; }",
      ".relay-chips { display: flex; flex-wrap: wrap; gap: 8px; }",
      ".relay-chip {",
      "  height: 24px; padding: 0 8px; display: inline-flex; align-items: center;",
      "  border: 1px solid var(--border); border-radius: var(--radius-full);",
      "  background: var(--card); color: var(--foreground);",
      "  font-size: 12px; line-height: 16px; white-space: nowrap;",
      "  transition: background-color 0.15s;",
      "}",
      ".relay-chip:hover { background: var(--accent); }",

      /* Offline state (07 widget-mobile/offline, widget-desktop/offline) */
      ".relay-offline { display: flex; flex-direction: column; gap: 8px; }",
      ".relay-offline[hidden] { display: none; }",
      ".relay-offline-title { font-size: 18px; line-height: 24px; font-weight: 600; color: var(--foreground); }",
      ".relay-offline-body { font-size: 14px; line-height: 20px; color: var(--muted-foreground); }",
      "#relay-widget-container[data-offline] #relay-widget-send {",
      "  background: var(--primary-soft); color: var(--primary-soft-foreground);",
      "}",

      /* Message bubbles */
      ".relay-msg { display: flex; flex-direction: column; gap: 4px; width: 100%; }",
      ".relay-msg-user { align-items: flex-end; }",
      ".relay-msg-assistant { align-items: flex-start; }",
      ".relay-msg-bubble {",
      "  max-width: 326px; padding: 8px 12px;",
      "  font-size: 14px; line-height: 20px;",
      "  overflow-wrap: anywhere; white-space: pre-wrap;",
      "}",
      ".relay-msg-user .relay-msg-bubble {",
      "  background: var(--primary); color: var(--primary-foreground);",
      "  border-radius: var(--radius-xl) var(--radius-xl) var(--radius-sm) var(--radius-xl);",
      "}",
      ".relay-msg-assistant .relay-msg-bubble {",
      "  background: var(--surface-raised); color: var(--foreground);",
      "  border: 1px solid var(--border);",
      "  border-radius: var(--radius-xl) var(--radius-xl) var(--radius-xl) var(--radius-sm);",
      "}",
      ".relay-msg-author { font-size: 12px; line-height: 16px; color: var(--muted-foreground); }",
      ".relay-msg-meta {",
      "  display: inline-flex; align-items: center; gap: 6px;",
      "  font-size: 12px; line-height: 16px; color: var(--muted-foreground);",
      "}",
      ".relay-msg-meta-typing::before {",
      "  content: ''; width: 6px; height: 6px; border-radius: var(--radius-full);",
      "  background: var(--primary); flex-shrink: 0;",
      "}",
      "button.relay-msg-meta-error { color: var(--destructive); font-size: 12px; line-height: 16px; }",
      "button.relay-msg-meta-error:hover { text-decoration: underline; }",
      ".relay-msg-meta svg { width: 14px; height: 14px; flex-shrink: 0; }",
      ".relay-msg-bubble strong { font-weight: 600; }",
      ".relay-msg-bubble em { font-style: italic; }",
      ".relay-msg-bubble del { text-decoration: line-through; }",
      ".relay-msg-bubble .relay-inline-code {",
      "  font-family: var(--font-mono); font-size: 13px;",
      "  padding: 1px 4px; border-radius: 4px; background: var(--accent);",
      "}",
      ".relay-msg-bubble .relay-code-block {",
      "  font-family: var(--font-mono); font-size: 13px; line-height: 18px;",
      "  margin: 8px 0; padding: 8px 12px; border-radius: var(--radius-sm);",
      "  background: var(--accent); overflow-x: auto; white-space: pre-wrap;",
      "}",
      ".relay-msg-bubble .relay-code-block code { font-family: inherit; background: none; padding: 0; }",

      /* Typing indicator */
      "#relay-typing {",
      "  align-self: flex-start; display: none; align-items: center; gap: 4px;",
      "  padding: 12px; border: 1px solid var(--border); background: var(--surface-raised);",
      "  border-radius: var(--radius-xl) var(--radius-xl) var(--radius-xl) var(--radius-sm);",
      "}",
      "#relay-typing.relay-active { display: flex; }",
      ".relay-typing-dot {",
      "  width: 6px; height: 6px; border-radius: var(--radius-full);",
      "  background: var(--muted-foreground);",
      "  animation: relay-typing 1.4s ease-in-out infinite;",
      "}",
      ".relay-typing-dot:nth-child(2) { animation-delay: 0.2s; }",
      ".relay-typing-dot:nth-child(3) { animation-delay: 0.4s; }",
      "@keyframes relay-typing {",
      "  0%, 60%, 100% { opacity: 0.35; transform: translateY(0); }",
      "  30% { opacity: 1; transform: translateY(-3px); }",
      "}",

      /* Handoff states (07 widget-mobile and widget-desktop handoff-waiting, -human-replied, -taken-over) */
      ".relay-avatar-sm { width: 24px; height: 24px; font-size: 10px; line-height: 12px; }",
      ".relay-msg-human-head {",
      "  display: flex; align-items: center; gap: 8px; max-width: 100%;",
      "  font-size: 12px; line-height: 16px;",
      "}",
      ".relay-msg-human-head .relay-msg-author { color: var(--foreground); }",
      ".relay-msg-time { color: var(--muted-foreground); flex-shrink: 0; }",
      "#relay-handoff { display: flex; flex-direction: column; gap: 8px; }",
      "#relay-handoff[hidden] { display: none; }",
      ".relay-handoff-line {",
      "  display: flex; align-items: center; gap: 8px;",
      "  font-size: 12px; line-height: 16px; color: var(--muted-foreground);",
      "}",
      ".relay-handoff-line svg { width: 14px; height: 14px; flex-shrink: 0; }",
      ".relay-spin { animation: relay-spin 1s linear infinite; }",
      "@keyframes relay-spin { to { transform: rotate(360deg); } }",
      ".relay-handoff-joined {",
      "  align-self: center; display: inline-flex; align-items: center; gap: 6px;",
      "  font-size: 12px; line-height: 16px; color: var(--muted-foreground); text-align: center;",
      "}",
      ".relay-handoff-joined svg { width: 14px; height: 14px; flex-shrink: 0; }",
      ".relay-handoff-typing-dot {",
      "  width: 6px; height: 6px; border-radius: var(--radius-full);",
      "  background: var(--primary); flex-shrink: 0;",
      "}",

      /* Composer: bordered box, textarea, Send button */
      "#relay-widget-input-area { flex-shrink: 0; }",
      ".relay-composer-box {",
      "  display: flex; flex-direction: column; gap: 12px; padding: 12px;",
      "  background: var(--card); border: 1px solid var(--border);",
      "  border-radius: var(--radius-lg);",
      "  transition: border-color 0.15s, box-shadow 0.15s;",
      "}",
      ".relay-composer-box:focus-within { border-color: var(--ring); box-shadow: var(--focus-ring); }",
      "#relay-widget-input {",
      "  display: block; width: 100%; resize: none; border: none; outline: none;",
      "  background: transparent; color: var(--foreground);",
      "  font-size: 14px; line-height: 20px; min-height: 20px; max-height: 100px;",
      "}",
      "#relay-widget-input:focus-visible { box-shadow: none; }",
      "#relay-widget-input::placeholder { color: var(--muted-foreground); opacity: 1; }",
      ".relay-composer-row { display: flex; align-items: center; gap: 8px; }",
      "#relay-widget-branding {",
      "  flex: 1 1 0; min-width: 0; font-size: 12px; line-height: 16px;",
      "  color: var(--muted-foreground);",
      "}",
      "#relay-widget-branding a { color: inherit; text-decoration: none; font-weight: 500; }",
      "#relay-widget-branding a:hover { text-decoration: underline; }",
      "#relay-widget-send {",
      "  height: 32px; padding: 0 12px; border-radius: var(--radius-lg);",
      "  display: inline-flex; align-items: center; justify-content: center; gap: 8px;",
      "  background: var(--primary); color: var(--primary-foreground);",
      "  font-size: 14px; line-height: 20px; transition: opacity 0.15s;",
      "}",
      "#relay-widget-send:disabled { opacity: 0.5; cursor: not-allowed; }",

      /* Mobile: panel fills the viewport */
      "@media (max-width: 480px) {",
      "  #relay-widget-panel {",
      "    top: 0; bottom: 0; left: 0; right: 0;",
      "    width: 100%; height: 100%; max-width: 100%; max-height: 100%;",
      "  }",
      "  .relay-msg-bubble { max-width: 85%; }",
      "  #relay-widget-input { font-size: 16px; }",
      "}",

      "@media (prefers-reduced-motion: reduce) {",
      "  #relay-widget-panel, #relay-widget-btn { transition: none; }",
      "  .relay-typing-dot, .relay-spin { animation: none; }",
      "}",
    ].join("\n");
  }

  function injectStyles() {
    var style = document.createElement("style");
    style.id = "relay-widget-styles";
    style.textContent = buildCss();
    root.appendChild(style);

    // Custom CSS keeps targeting the same #relay-widget-* ids, now inside the
    // shadow root.
    if (config.customCss) {
      var customStyle = document.createElement("style");
      customStyle.id = "relay-widget-custom-styles";
      customStyle.textContent = config.customCss;
      root.appendChild(customStyle);
    }
  }

  function applyTheme() {
    if (container) container.setAttribute("data-theme", getThemeMode());
  }

  // ── SVG Icons (lucide 0.563.0, stroke 1.75) ─────────────────────────────────

  function lucide(paths) {
    return (
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      paths +
      "</svg>"
    );
  }

  var ICON_MESSAGE_CIRCLE = lucide(
    '<path d="M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719"/>'
  );
  var ICON_X = lucide('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>');
  var ICON_CIRCLE_ALERT = lucide(
    '<circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/>'
  );
  var ICON_LOADER_CIRCLE = lucide('<path d="M21 12a9 9 0 1 1-6.219-8.56"/>');
  var ICON_USER_CHECK = lucide(
    '<path d="m16 11 2 2 4-4"/><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>'
  );
  var ICON_SQUARE_PEN = lucide(
    '<path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z"/>'
  );

  // ── DOM Creation ────────────────────────────────────────────────────────────

  function el(tag, attrs, text) {
    var node = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        if (Object.prototype.hasOwnProperty.call(attrs, k)) {
          if (k === "className") node.className = attrs[k];
          else node.setAttribute(k, attrs[k]);
        }
      }
    }
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function displayName() {
    return config.companyName || config.title || DEFAULT_TITLE;
  }

  function subtitleText() {
    if (config.subtitle) return config.subtitle;
    if (config.companyName && config.title) return config.title;
    return "";
  }

  function createHeader() {
    var header = el("div", { id: "relay-widget-header" });

    var avatar = el("div", { className: "relay-avatar", "aria-hidden": "true" });
    if (config.avatarUrl) {
      var img = el("img", { src: config.avatarUrl, alt: "" });
      img.addEventListener("error", function () {
        avatar.textContent = initials(displayName());
      });
      avatar.appendChild(img);
    } else {
      avatar.textContent = initials(displayName());
    }

    var titleBlock = el("div", { className: "relay-title-block" });
    titleBlock.appendChild(el("div", { id: "relay-widget-header-title" }, displayName()));
    var sub = subtitleText();
    if (sub) titleBlock.appendChild(el("div", { className: "relay-subtitle" }, sub));

    var actions = el("div", { id: "relay-widget-header-actions" });

    newChatBtn = el("button", {
      type: "button",
      className: "relay-icon-btn",
      "aria-label": "New conversation",
      title: "New conversation",
    });
    newChatBtn.innerHTML = ICON_SQUARE_PEN;
    newChatBtn.addEventListener("click", function () {
      clearState();
      renderMessages();
      inputEl.focus();
    });

    var closeBtn = el("button", {
      type: "button",
      className: "relay-icon-btn",
      "aria-label": "Close chat",
      title: "Close",
    });
    closeBtn.innerHTML = ICON_X;
    closeBtn.addEventListener("click", close);

    actions.appendChild(newChatBtn);
    actions.appendChild(closeBtn);

    header.appendChild(avatar);
    header.appendChild(titleBlock);
    header.appendChild(actions);
    return header;
  }

  function quickReplies() {
    var list = Array.isArray(config.quickReplies) ? config.quickReplies : [];
    return list
      .filter(function (q) {
        return typeof q === "string" && q.trim();
      })
      .slice(0, 4);
  }

  function createEmptyState() {
    var wrap = el("div", { className: "relay-empty" });
    wrap.appendChild(
      el("div", { className: "relay-empty-title" }, config.welcomeTitle || EMPTY_HEADING)
    );
    var body = config.welcomeMessage;
    if (body && body !== LEGACY_WELCOME) {
      wrap.appendChild(el("p", { className: "relay-empty-body" }, body));
    }
    var replies = quickReplies();
    if (replies.length) {
      var chips = el("div", { className: "relay-chips" });
      replies.forEach(function (text) {
        var chip = el("button", { type: "button", className: "relay-chip" }, text);
        chip.addEventListener("click", function () {
          submit(text);
        });
        chips.appendChild(chip);
      });
      wrap.appendChild(chips);
    }
    return wrap;
  }

  function createComposer() {
    var area = el("div", { id: "relay-widget-input-area" });
    var box = el("div", { className: "relay-composer-box" });

    inputEl = el("textarea", {
      id: "relay-widget-input",
      placeholder: "Write a message…",
      rows: "1",
      "aria-label": "Message",
    });
    inputEl.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    });
    inputEl.addEventListener("input", function () {
      inputEl.style.height = "auto";
      inputEl.style.height = Math.min(inputEl.scrollHeight, 100) + "px";
      postTyping();
    });

    var row = el("div", { className: "relay-composer-row" });
    var branding = el("div", { id: "relay-widget-branding" });
    if (config.showBranding) {
      branding.innerHTML =
        'Powered by <a href="https://relay.ai" target="_blank" rel="noopener noreferrer">Relay</a>';
    }
    sendBtn = el("button", { id: "relay-widget-send", type: "button" }, "Send");
    sendBtn.addEventListener("click", handleSend);

    row.appendChild(branding);
    row.appendChild(sendBtn);
    box.appendChild(inputEl);
    box.appendChild(row);
    area.appendChild(box);
    return area;
  }

  function createWidget() {
    // Host element in the page. Everything visible lives in its shadow root.
    host = document.createElement("div");
    host.id = "relay-widget-root";
    root = host.attachShadow ? host.attachShadow({ mode: "open" }) : host;

    injectStyles();

    container = el("div", { id: "relay-widget-container" });
    applyTheme();

    button = el("button", {
      id: "relay-widget-btn",
      type: "button",
      "aria-label": "Open chat",
      "aria-expanded": "false",
    });
    button.innerHTML = ICON_MESSAGE_CIRCLE;
    button.addEventListener("click", open);

    panel = el("div", {
      id: "relay-widget-panel",
      role: "dialog",
      "aria-label": displayName(),
      "aria-hidden": "true",
    });
    panel.addEventListener("keydown", function (e) {
      if (e.key === "Escape") close();
    });

    messagesEl = el("div", {
      id: "relay-widget-messages",
      role: "log",
      "aria-live": "polite",
    });
    emptyEl = createEmptyState();
    messagesEl.appendChild(emptyEl);
    offlineEl = el("div", { className: "relay-offline", role: "status", hidden: "" });
    offlineEl.appendChild(el("div", { className: "relay-offline-title" }, "You are offline"));
    offlineEl.appendChild(
      el(
        "p",
        { className: "relay-offline-body" },
        "Your messages will be sent as soon as the connection is back."
      )
    );
    messagesEl.appendChild(offlineEl);

    handoffEl = el("div", { id: "relay-handoff", role: "status", hidden: "" });
    messagesEl.appendChild(handoffEl);

    typingIndicator = el("div", { id: "relay-typing", "aria-label": "Typing" });
    for (var i = 0; i < 3; i++) {
      typingIndicator.appendChild(el("span", { className: "relay-typing-dot" }));
    }
    messagesEl.appendChild(typingIndicator);

    panel.appendChild(createHeader());
    panel.appendChild(messagesEl);
    panel.appendChild(createComposer());

    container.appendChild(panel);
    container.appendChild(button);
    root.appendChild(container);
    document.body.appendChild(host);

    loadState();
    isOnline = !(typeof navigator !== "undefined" && navigator.onLine === false);
    setOnline(isOnline);
    renderMessages();
    window.addEventListener("online", function () {
      setOnline(true);
      flushQueue();
      if (isOpen) syncMissed();
    });
    window.addEventListener("offline", function () {
      setOnline(false);
      disconnectEvents();
    });
    flushQueue();

    if (config.autoOpen) {
      setTimeout(function () {
        if (!isOpen) open();
      }, config.autoOpenDelay || 3000);
    }

    if (config.theme === "auto" && window.matchMedia) {
      var mq = window.matchMedia("(prefers-color-scheme: dark)");
      var onChange = function () {
        applyTheme();
      };
      if (mq.addEventListener) mq.addEventListener("change", onChange);
      else if (mq.addListener) mq.addListener(onChange);
    }
  }

  // ── Message Rendering ───────────────────────────────────────────────────────

  // Status line under a bubble: streaming, failed, waiting for connection.
  function metaFor(msg) {
    if (msg.streaming) return { kind: "typing", text: "Typing…" };
    if (msg.error === "interrupted") {
      return { kind: "error", text: "Reply interrupted. Tap to retry." };
    }
    if (msg.error === "failed") return { kind: "error", text: "Message not sent. Tap to retry." };
    if (msg.status === "queued") return { kind: "muted", text: "Waiting for connection" };
    return null;
  }

  function renderMeta(wrapper, msg) {
    var old = wrapper.querySelectorAll(".relay-msg-meta");
    for (var i = 0; i < old.length; i++) wrapper.removeChild(old[i]);
    var meta = metaFor(msg);
    if (!meta) return;
    var node;
    if (meta.kind === "error") {
      node = el("button", { type: "button", className: "relay-msg-meta relay-msg-meta-error" });
      node.innerHTML = ICON_CIRCLE_ALERT;
      node.appendChild(el("span", null, meta.text));
      node.addEventListener("click", function () {
        retry(msg.id);
      });
    } else {
      node = el("div", { className: "relay-msg-meta relay-msg-meta-" + meta.kind }, meta.text);
    }
    wrapper.appendChild(node);
  }

  function isHuman(msg) {
    return !!msg && msg.author === "human" && !!msg.authorDisplayName;
  }

  function timeLabel(iso) {
    var d = iso ? new Date(iso) : null;
    if (!d || isNaN(d.getTime())) return "";
    var h = d.getHours();
    var m = d.getMinutes();
    return (h < 10 ? "0" : "") + h + ":" + (m < 10 ? "0" : "") + m;
  }

  // "MA  Markus Albrecht · Acme GmbH  11:49" above a person's reply
  // (07 widget-*/handoff-human-replied). Not repeated for their follow-ups.
  function humanHead(msg) {
    var head = el("div", { className: "relay-msg-human-head" });
    head.appendChild(
      el(
        "div",
        { className: "relay-avatar relay-avatar-sm", "aria-hidden": "true" },
        initials(msg.authorDisplayName)
      )
    );
    var label = msg.authorDisplayName;
    if (config.companyName) label += " · " + config.companyName;
    head.appendChild(el("span", { className: "relay-msg-author" }, label));
    var time = timeLabel(msg.createdAt);
    if (time) head.appendChild(el("span", { className: "relay-msg-time" }, time));
    return head;
  }

  function messageNode(msg, prev) {
    var side = msg.role === "user" ? "user" : "assistant";
    var wrapper = el("div", { className: "relay-msg relay-msg-" + side });
    if (msg.id) wrapper.setAttribute("data-msg-id", msg.id);
    if (isHuman(msg) && !(isHuman(prev) && prev.authorDisplayName === msg.authorDisplayName)) {
      wrapper.appendChild(humanHead(msg));
    }
    var bubble = el("div", { className: "relay-msg-bubble" });
    bubble.innerHTML =
      side === "assistant" ? formatMarkdown(msg.content || "") : escapeHtml(msg.content || "");
    wrapper.appendChild(bubble);
    renderMeta(wrapper, msg);
    if (msg.id) nodesById[msg.id] = wrapper;
    return { wrapper: wrapper, bubble: bubble };
  }

  function refreshMeta(msg) {
    var wrapper = msg && nodesById[msg.id];
    if (wrapper) renderMeta(wrapper, msg);
  }

  function syncChrome() {
    var hasMessages = messages.length > 0;
    if (hasMessages || !isOnline) emptyEl.setAttribute("hidden", "");
    else emptyEl.removeAttribute("hidden");
    if (offlineEl) {
      if (isOnline) offlineEl.setAttribute("hidden", "");
      else offlineEl.removeAttribute("hidden");
    }
    if (newChatBtn) {
      if (hasMessages) newChatBtn.removeAttribute("hidden");
      else newChatBtn.setAttribute("hidden", "");
    }
  }

  function renderMessages() {
    var nodes = messagesEl.querySelectorAll(".relay-msg");
    for (var i = 0; i < nodes.length; i++) {
      messagesEl.removeChild(nodes[i]);
    }
    nodesById = {};
    var events = messagesEl.querySelectorAll(".relay-handoff-joined");
    for (var j = 0; j < events.length; j++) messagesEl.removeChild(events[j]);
    var prev = null;
    var placed = false;
    if (joinedEl && joinedAfterId === "") {
      messagesEl.insertBefore(joinedEl, handoffEl);
      placed = true;
    }
    messages.forEach(function (msg) {
      messagesEl.insertBefore(messageNode(msg, prev).wrapper, handoffEl);
      if (joinedEl && msg.id === joinedAfterId) {
        messagesEl.insertBefore(joinedEl, handoffEl);
        placed = true;
      }
      prev = msg;
    });
    // Joined before any message, or the anchor was replaced by a server copy.
    if (joinedEl && !placed) messagesEl.insertBefore(joinedEl, handoffEl);
    syncChrome();
    scrollToBottom();
  }

  function appendMessageToDOM(msg, before) {
    var at = findMessage(msg.id);
    var node = messageNode(msg, at > 0 ? messages[at - 1] : null);
    messagesEl.insertBefore(node.wrapper, before || handoffEl);
    syncChrome();
    scrollToBottom();
    return node.bubble;
  }

  function findMessage(id) {
    for (var i = 0; i < messages.length; i++) {
      if (messages[i].id === id) return i;
    }
    return -1;
  }

  function toLocalMessage(msg) {
    var m = {
      id: msg.id,
      role: msg.role === "user" ? "user" : "assistant",
      content: msg.content || "",
      createdAt: msg.createdAt || new Date().toISOString(),
    };
    if (msg.author) m.author = msg.author;
    if (msg.authorDisplayName) m.authorDisplayName = msg.authorDisplayName;
    return m;
  }

  // Adds a message that arrived from outside the request/stream cycle (human
  // replies via /api/widget/[id]/events or /messages). Skips duplicates.
  function addIncomingMessage(msg) {
    if (!msg || !msg.id) return;
    if (findMessage(msg.id) !== -1) return;
    var m = toLocalMessage(msg);
    messages.push(m);
    lastServerId = m.id;
    appendMessageToDOM(m);
    saveState();
    if (isHuman(m) && personTyping) {
      personTyping = false;
      renderHandoff();
    }
  }

  // Folds the server transcript from /messages into the local one. The server
  // copy wins for everything after the cursor (local copies of streamed
  // replies carry browser ids); messages still waiting for a connection stay.
  function reconcile(serverMessages, cursorId) {
    if (!Array.isArray(serverMessages) || serverMessages.length === 0) return;
    var idx = cursorId ? findMessage(cursorId) : -1;
    if (cursorId && idx === -1) {
      serverMessages.forEach(addIncomingMessage);
      return;
    }
    var serverIds = {};
    var incoming = serverMessages.map(function (m) {
      serverIds[m.id] = true;
      return toLocalMessage(m);
    });
    var queued = messages.filter(function (m) {
      return m.status === "queued" && !serverIds[m.id];
    });
    messages = messages.slice(0, idx + 1).concat(incoming, queued);
    lastServerId = incoming[incoming.length - 1].id;
    renderMessages();
    saveState();
  }

  function updateStreamingBubble(bubbleEl, content) {
    bubbleEl.innerHTML = formatMarkdown(content);
    scrollToBottom();
  }

  function scrollToBottom() {
    var raf = window.requestAnimationFrame || function (fn) { return setTimeout(fn, 0); };
    raf(function () {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    });
  }

  // ── Connection & handoff state ──────────────────────────────────────────────

  function setOnline(online) {
    isOnline = online;
    if (container) {
      if (online) container.removeAttribute("data-offline");
      else container.setAttribute("data-offline", "");
    }
    if (emptyEl) syncChrome();
  }

  // open / answered / taken_over / expired / handed_back from the handoff
  // runtime, exposed as data-handoff. `person` is the colleague named on the
  // request, used until their own messages carry a name.
  function setHandoff(status, person) {
    var previous = handoffStatus;
    handoffStatus = status || null;
    if (person) handoffPerson = person;
    if (handoffStatus === "taken_over" && previous !== "taken_over") {
      var last = messages.length ? messages[messages.length - 1] : null;
      joinedAfterId = last ? last.id : "";
      joinedEl = null;
    }
    if (handoffStatus !== "taken_over") personTyping = false;
    if (!handoffStatus) {
      handoffPerson = null;
      joinedAfterId = null;
      joinedEl = null;
    }
    if (!container) return;
    if (handoffStatus) container.setAttribute("data-handoff", handoffStatus);
    else container.removeAttribute("data-handoff");
    renderHandoff();
  }

  function personName() {
    for (var i = messages.length - 1; i >= 0; i--) {
      if (isHuman(messages[i])) return messages[i].authorDisplayName;
    }
    return handoffPerson || "A colleague";
  }

  function handoffLine(icon, text, extraClass) {
    var line = el("div", { className: "relay-handoff-line" + (extraClass ? " " + extraClass : "") });
    if (icon) {
      var glyph = el("span", { className: "relay-handoff-glyph", "aria-hidden": "true" });
      glyph.innerHTML = icon;
      line.appendChild(glyph);
    }
    line.appendChild(el("span", null, text));
    return line;
  }

  // The status under the transcript: "Asking a colleague at Acme…" while the
  // request is open (handoff-waiting), "<name> is typing…" during a takeover
  // (handoff-taken-over), and the "joined the chat" line in the transcript.
  function renderHandoff() {
    if (!handoffEl) return;
    handoffEl.textContent = "";
    if (handoffStatus === "open") {
      var company = config.companyName;
      handoffEl.appendChild(
        handoffLine(
          ICON_LOADER_CIRCLE,
          company ? "Asking a colleague at " + company + "…" : "Asking a colleague…",
          "relay-handoff-waiting"
        )
      );
    } else if (handoffStatus === "taken_over" && personTyping) {
      var name = personName();
      var row = el("div", { className: "relay-handoff-line relay-handoff-typing" });
      row.appendChild(
        el("div", { className: "relay-avatar relay-avatar-sm", "aria-hidden": "true" }, initials(name))
      );
      row.appendChild(el("span", { className: "relay-handoff-typing-dot", "aria-hidden": "true" }));
      row.appendChild(el("span", null, name + " is typing…"));
      handoffEl.appendChild(row);
    }
    if (handoffEl.children.length) {
      handoffEl.removeAttribute("hidden");
    } else {
      handoffEl.setAttribute("hidden", "");
    }

    if (joinedAfterId !== null && !joinedEl) {
      var who = personName();
      joinedEl = el("div", { className: "relay-handoff-joined", role: "note" });
      var icon = el("span", { "aria-hidden": "true" });
      icon.innerHTML = ICON_USER_CHECK;
      joinedEl.appendChild(icon);
      joinedEl.appendChild(
        el(
          "span",
          null,
          config.companyName
            ? who + " from " + config.companyName + " joined the chat"
            : who + " joined the chat"
        )
      );
      renderMessages();
    } else if (joinedAfterId === null && messagesEl) {
      var stale = messagesEl.querySelectorAll(".relay-handoff-joined");
      for (var i = 0; i < stale.length; i++) messagesEl.removeChild(stale[i]);
    }
    scrollToBottom();
  }

  // Customer typing while a person has taken over, for the quick-link page.
  function postTyping() {
    if (handoffStatus !== "taken_over" || !chatId || !isOnline) return;
    if (!inputEl.value.trim()) return;
    var now = Date.now();
    if (now - lastTypingPost < TYPING_POST_INTERVAL_MS) return;
    lastTypingPost = now;
    fetch(baseUrl + "/api/widget/" + widgetId + "/typing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatId: chatId }),
    }).catch(function () {
      // Typing presence is best effort.
    });
  }

  function widgetQuery(withCursor) {
    var q = "?chatId=" + encodeURIComponent(chatId);
    if (withCursor && lastServerId) q += "&after=" + encodeURIComponent(lastServerId);
    return q;
  }

  // Missed messages on (re)open, then the live stream while the panel is open.
  function syncMissed() {
    if (!chatId || !isOnline) return Promise.resolve();
    var cursor = lastServerId;
    return fetch(baseUrl + "/api/widget/" + widgetId + "/messages" + widgetQuery(true))
      .then(function (res) {
        if (!res.ok) return null;
        return res.json();
      })
      .then(function (data) {
        if (!data) return;
        if (!isLoading) reconcile(data.messages, cursor);
        setHandoff(data.handoff, data.handoffPerson);
        connectEvents();
      })
      .catch(function (err) {
        console.error("[Relay Widget] Sync failed:", err);
      });
  }

  function connectEvents() {
    if (eventSource || !chatId || !isOpen || !isOnline) return;
    if (typeof EventSource === "undefined") return;
    var es = new EventSource(
      baseUrl + "/api/widget/" + widgetId + "/events" + widgetQuery(true)
    );
    eventSource = es;
    es.addEventListener("message", function (e) {
      try {
        addIncomingMessage(JSON.parse(e.data));
      } catch (_e) {
        // ignore malformed event
      }
    });
    es.addEventListener("handoff", function (e) {
      try {
        var data = JSON.parse(e.data);
        setHandoff(data.status, data.person);
      } catch (_e) {
        // ignore malformed event
      }
    });
    es.addEventListener("typing", function (e) {
      try {
        personTyping = !!JSON.parse(e.data).person && handoffStatus === "taken_over";
        renderHandoff();
      } catch (_e) {
        // ignore malformed event
      }
    });
    es.addEventListener("error", function () {
      // The browser reconnects on its own (Last-Event-ID) unless it gave up.
      if (es.readyState === 2 && eventSource === es) eventSource = null;
    });
  }

  function disconnectEvents() {
    if (!eventSource) return;
    eventSource.close();
    eventSource = null;
  }

  // ── Open / close ────────────────────────────────────────────────────────────

  function open() {
    if (isOpen) return;
    isOpen = true;
    panel.classList.add("relay-open");
    container.classList.add("relay-is-open");
    panel.setAttribute("aria-hidden", "false");
    button.setAttribute("aria-expanded", "true");
    try {
      inputEl.focus({ preventScroll: true });
    } catch (_e) {
      inputEl.focus();
    }
    scrollToBottom();
    syncMissed();
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    panel.classList.remove("relay-open");
    container.classList.remove("relay-is-open");
    panel.setAttribute("aria-hidden", "true");
    button.setAttribute("aria-expanded", "false");
    button.focus();
    disconnectEvents();
  }

  function toggle() {
    if (isOpen) close();
    else open();
  }

  // ── Send & Stream ───────────────────────────────────────────────────────────

  function handleSend() {
    var content = inputEl.value.trim();
    if (!content || isLoading) return;
    inputEl.value = "";
    inputEl.style.height = "auto";
    submit(content);
  }

  function submit(content) {
    if (!content || isLoading) return;
    var userMsg = {
      id: generateId(),
      role: "user",
      content: content,
      createdAt: new Date().toISOString(),
    };
    // Offline: keep it and send when the connection is back.
    if (!isOnline) userMsg.status = "queued";
    messages.push(userMsg);
    appendMessageToDOM(userMsg);
    saveState();
    if (isOnline) sendMessage(userMsg);
  }

  // Sends the oldest message still waiting for a connection, one at a time:
  // the worker stores only the last user message of each request.
  function flushQueue() {
    if (isLoading || !isOnline) return;
    for (var i = 0; i < messages.length; i++) {
      if (messages[i].role === "user" && messages[i].status === "queued") {
        sendMessage(messages[i]);
        return;
      }
    }
  }

  function retry(id) {
    if (isLoading) return;
    var idx = findMessage(id);
    if (idx === -1) return;
    var msg = messages[idx];
    var userMsg = msg;
    if (msg.role !== "user") {
      // Drop the partial reply and ask again for the message before it.
      messages.splice(idx, 1);
      userMsg = null;
      for (var i = idx - 1; i >= 0; i--) {
        if (messages[i].role === "user") {
          userMsg = messages[i];
          break;
        }
      }
      renderMessages();
      saveState();
      if (!userMsg) return;
    }
    delete userMsg.error;
    if (!isOnline) {
      userMsg.status = "queued";
      refreshMeta(userMsg);
      saveState();
      return;
    }
    refreshMeta(userMsg);
    sendMessage(userMsg);
  }

  // AI SDK UIMessage shape: the conversation up to and including `upTo`,
  // without unsent, failed or cut-off messages.
  function buildUIMessages(upTo) {
    var out = [];
    for (var i = 0; i < messages.length; i++) {
      var m = messages[i];
      var isTarget = m === upTo;
      if ((m.role === "user" || m.role === "assistant") && (isTarget || (!m.status && !m.error))) {
        out.push({
          id: m.id,
          role: m.role,
          content: m.content,
          parts: [{ type: "text", text: m.content }],
          createdAt: m.createdAt,
        });
      }
      if (isTarget) break;
    }
    return out;
  }

  function sendMessage(userMsg) {
    isLoading = true;
    sendBtn.disabled = true;
    delete userMsg.status;
    delete userMsg.error;
    refreshMeta(userMsg);
    typingIndicator.classList.add("relay-active");
    scrollToBottom();

    var payload = {
      messages: buildUIMessages(userMsg),
      visitorId: visitorId,
    };
    if (chatId) payload.chatId = chatId;
    var reply = null;

    fetch(baseUrl + "/api/widget/" + widgetId + "/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then(function (response) {
        if (!response.ok) {
          throw new Error("Chat request failed: " + response.status);
        }
        var newChatId = response.headers.get("X-Chat-Id");
        if (newChatId) {
          chatId = newChatId;
          saveState();
        }
        var handoffHeader = response.headers.get("X-Handoff-State");
        if (handoffHeader) setHandoff(handoffHeader);
        return streamResponse(response, userMsg, function (msg) {
          reply = msg;
        });
      })
      .catch(function (err) {
        console.error("[Relay Widget] Send error:", err);
        if (reply) {
          delete reply.streaming;
          reply.error = "interrupted";
          refreshMeta(reply);
        } else if (typeof navigator !== "undefined" && navigator.onLine === false) {
          setOnline(false);
          userMsg.status = "queued";
          refreshMeta(userMsg);
        } else {
          userMsg.error = "failed";
          refreshMeta(userMsg);
        }
        saveState();
      })
      .finally(function () {
        isLoading = false;
        sendBtn.disabled = false;
        typingIndicator.classList.remove("relay-active");
        if (isOpen) connectEvents();
        flushQueue();
      });
  }

  // Parses one stream line: { text } for a text delta, { error } for a stream
  // error, or null. Understands the AI SDK v6 UI message stream (SSE
  // `data: {"type":"text-delta"}`) and the older `0:"text"` data stream protocol.
  function parseStreamLine(line) {
    if (line.indexOf("data:") === 0) {
      var data = line.slice(5).trim();
      if (!data || data === "[DONE]") return null;
      try {
        var evt = JSON.parse(data);
        if (evt && evt.type === "text-delta") {
          return { text: typeof evt.delta === "string" ? evt.delta : evt.textDelta || "" };
        }
        if (evt && evt.type === "error") {
          return { error: evt.errorText || "stream error" };
        }
      } catch (_e) {
        // ignore malformed event
      }
      return null;
    }

    var colonIndex = line.indexOf(":");
    if (colonIndex === -1) return null;
    var type = line.substring(0, colonIndex);
    var value = line.substring(colonIndex + 1);
    if (type === "0") {
      try {
        return { text: JSON.parse(value) };
      } catch (_e) {
        return { text: value };
      }
    }
    if (type === "3" || type === "e") return { error: value };
    return null;
  }

  // Streams the reply into a bubble. Rejects when the stream breaks or carries
  // an error event; `onReply` gets the reply message once it exists so the
  // caller can mark it interrupted.
  function streamResponse(response, userMsg, onReply) {
    var reader = response.body.getReader();
    var decoder = new TextDecoder();
    var buffer = "";
    var streamError = null;
    var assistantMsg = {
      id: generateId(),
      role: "assistant",
      content: "",
      createdAt: new Date().toISOString(),
      streaming: true,
    };
    var bubbleEl = null;

    function handle(parsed) {
      if (!parsed) return;
      if (parsed.error) {
        streamError = parsed.error;
        return;
      }
      if (!parsed.text) return;
      if (!bubbleEl) {
        typingIndicator.classList.remove("relay-active");
        // Right after its question, ahead of messages still queued.
        var at = messages.indexOf(userMsg) + 1;
        if (at === 0) at = messages.length;
        var next = messages[at];
        messages.splice(at, 0, assistantMsg);
        bubbleEl = appendMessageToDOM(assistantMsg, next && nodesById[next.id]);
        onReply(assistantMsg);
      }
      assistantMsg.content += parsed.text;
      updateStreamingBubble(bubbleEl, assistantMsg.content);
    }

    function processChunk() {
      return reader.read().then(function (result) {
        if (result.done) {
          if (buffer.trim()) handle(parseStreamLine(buffer.trim()));
          if (streamError) throw new Error("[stream] " + streamError);
          if (bubbleEl) {
            delete assistantMsg.streaming;
            refreshMeta(assistantMsg);
          }
          saveState();
          return;
        }
        buffer += decoder.decode(result.value, { stream: true });
        var lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (var i = 0; i < lines.length; i++) {
          var line = lines[i].trim();
          if (line) handle(parseStreamLine(line));
        }
        return processChunk();
      });
    }

    return processChunk();
  }

  // ── Init ────────────────────────────────────────────────────────────────────

  function init() {
    var scripts = document.querySelectorAll("script[data-widget-id]");
    var script = scripts[scripts.length - 1]; // Last one in case of multiple

    if (!script) {
      console.error("[Relay Widget] No script tag with data-widget-id found");
      return;
    }

    widgetId = script.getAttribute("data-widget-id");
    if (!widgetId) {
      console.error("[Relay Widget] Empty data-widget-id attribute");
      return;
    }

    if (document.getElementById("relay-widget-root")) return; // already booted

    var src = script.getAttribute("src") || "";
    try {
      baseUrl = new URL(src, window.location.href).origin;
    } catch (_e) {
      baseUrl = "";
    }

    try {
      visitorId = localStorage.getItem("relay_visitor_id");
      if (!visitorId) {
        visitorId = generateId();
        localStorage.setItem("relay_visitor_id", visitorId);
      }
    } catch (_e) {
      visitorId = generateId();
    }

    fetchConfig().then(function () {
      createWidget();
      window.RelayWidget = {
        open: open,
        close: close,
        toggle: toggle,
        addMessage: addIncomingMessage,
      };
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
