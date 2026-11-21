import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

/**
 * public/widget.js runs on customer sites, so the embed contract must not
 * break: a <script data-widget-id> tag plus the /api/widget/[id]/config
 * response shape. This boots the script in a vm against a minimal fake DOM.
 */

const WIDGET_SRC = readFileSync(
  join(__dirname, "../../public/widget.js"),
  "utf-8",
);

type Listener = (e: unknown) => void;

class FakeNode {
  tagName: string;
  id = "";
  className = "";
  children: FakeNode[] = [];
  parent: FakeNode | null = null;
  attrs: Record<string, string> = {};
  listeners: Record<string, Listener[]> = {};
  style: Record<string, string> = {};
  shadowRoot: FakeNode | null = null;
  value = "";
  disabled = false;
  scrollTop = 0;
  scrollHeight = 0;
  private text = "";
  innerHTML = "";

  constructor(tag: string) {
    this.tagName = tag.toUpperCase();
  }
  get classList() {
    const set = () => new Set(this.className.split(/\s+/).filter(Boolean));
    return {
      add: (c: string) => {
        const s = set();
        s.add(c);
        this.className = [...s].join(" ");
      },
      remove: (c: string) => {
        const s = set();
        s.delete(c);
        this.className = [...s].join(" ");
      },
      contains: (c: string) => set().has(c),
    };
  }
  get textContent() {
    return this.text + this.children.map((c) => c.textContent).join("");
  }
  set textContent(v: string) {
    this.text = v;
    this.children = [];
  }
  setAttribute(k: string, v: string) {
    if (k === "id") this.id = v;
    this.attrs[k] = String(v);
  }
  getAttribute(k: string) {
    if (k === "id") return this.id || null;
    return k in this.attrs ? this.attrs[k] : null;
  }
  removeAttribute(k: string) {
    delete this.attrs[k];
  }
  hasAttribute(k: string) {
    return k in this.attrs;
  }
  addEventListener(type: string, fn: Listener) {
    (this.listeners[type] ??= []).push(fn);
  }
  dispatch(type: string, e: unknown = {}) {
    for (const fn of this.listeners[type] ?? []) fn(e);
  }
  appendChild(n: FakeNode) {
    n.parent = this;
    this.children.push(n);
    return n;
  }
  insertBefore(n: FakeNode, ref: FakeNode | null) {
    n.parent = this;
    const i = ref ? this.children.indexOf(ref) : -1;
    if (i < 0) this.children.push(n);
    else this.children.splice(i, 0, n);
    return n;
  }
  removeChild(n: FakeNode) {
    this.children = this.children.filter((c) => c !== n);
    return n;
  }
  attachShadow() {
    this.shadowRoot = new FakeNode("#shadow-root");
    return this.shadowRoot;
  }
  focus() {}
  all(): FakeNode[] {
    return this.children.flatMap((c) => [c, ...c.all()]);
  }
  find(pred: (n: FakeNode) => boolean): FakeNode | undefined {
    for (const c of this.children) {
      if (pred(c)) return c;
      const inShadow = c.shadowRoot?.find(pred);
      if (inShadow) return inShadow;
      const deep = c.find(pred);
      if (deep) return deep;
    }
    return undefined;
  }
  querySelectorAll(sel: string) {
    if (sel.startsWith(".")) {
      const c = sel.slice(1);
      return this.all().filter((n) => n.classList.contains(c));
    }
    return [];
  }
}

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  readyState = 1;
  listeners: Record<string, Listener[]> = {};
  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, fn: Listener) {
    (this.listeners[type] ??= []).push(fn);
  }
  emit(type: string, data: unknown, id?: string) {
    for (const fn of this.listeners[type] ?? []) fn({ data: JSON.stringify(data), lastEventId: id });
  }
  close() {
    this.readyState = 2;
  }
}

type FetchInit = { method?: string; body?: string };
type FakeResponse = {
  ok: boolean;
  status: number;
  json?: () => Promise<unknown>;
  headers?: { get: (k: string) => string | null };
  body?: { getReader: () => { read: () => Promise<{ done: boolean; value?: Uint8Array }> } };
};

/** A chat response whose body yields `chunks`, then fails if `failAfter`. */
function streamResponse(
  chunks: string[],
  opts: { headers?: Record<string, string>; failAfter?: boolean } = {},
): FakeResponse {
  const enc = new TextEncoder();
  let i = 0;
  return {
    ok: true,
    status: 200,
    headers: { get: (k: string) => opts.headers?.[k] ?? null },
    body: {
      getReader: () => ({
        read: () => {
          if (i < chunks.length) return Promise.resolve({ done: false, value: enc.encode(chunks[i++]) });
          if (opts.failAfter) return Promise.reject(new TypeError("network error"));
          return Promise.resolve({ done: true });
        },
      }),
    },
  };
}

function jsonResponse(body: unknown, status = 200): FakeResponse {
  return { ok: status < 400, status, json: () => Promise.resolve(body) };
}

function bootWidget(opts: {
  configResponse: unknown;
  configOk?: boolean;
  scriptAttrs: Record<string, string>;
  storage?: Record<string, string>;
  online?: boolean;
  route?: (url: string, init?: FetchInit) => FakeResponse | Promise<FakeResponse> | undefined;
}) {
  const body = new FakeNode("body");
  const head = new FakeNode("head");
  const script = new FakeNode("script");
  for (const [k, v] of Object.entries(opts.scriptAttrs)) script.setAttribute(k, v);
  const store: Record<string, string> = { ...(opts.storage ?? {}) };
  const fetchCalls: string[] = [];
  const fetchInits: (FetchInit | undefined)[] = [];
  const navigator = { onLine: opts.online ?? true };
  const windowListeners: Record<string, Listener[]> = {};

  const document = {
    readyState: "complete",
    body,
    head,
    currentScript: script,
    createElement: (tag: string) => new FakeNode(tag),
    getElementById: (id: string) =>
      body.find((n) => n.id === id) ?? head.find((n) => n.id === id) ?? null,
    querySelectorAll: (sel: string) =>
      sel === "script[data-widget-id]" && script.getAttribute("data-widget-id") !== null
        ? [script]
        : [],
    addEventListener: () => {},
  };

  const window = {
    location: { href: "https://customer.example/page" },
    matchMedia: () => ({ matches: false, addEventListener: () => {} }),
    requestAnimationFrame: (fn: () => void) => fn(),
    addEventListener: (type: string, fn: Listener) => {
      (windowListeners[type] ??= []).push(fn);
    },
  } as Record<string, unknown>;
  const fireWindow = (type: string) => {
    for (const fn of windowListeners[type] ?? []) fn({});
  };

  const context = vm.createContext({
    window,
    document,
    console: { error: () => {}, log: () => {} },
    localStorage: {
      getItem: (k: string) => (k in store ? store[k] : null),
      setItem: (k: string, v: string) => {
        store[k] = String(v);
      },
      removeItem: (k: string) => {
        delete store[k];
      },
    },
    fetch: (url: string, init?: FetchInit) => {
      fetchCalls.push(url);
      fetchInits.push(init);
      const routed = opts.route?.(url, init);
      if (routed) return Promise.resolve(routed);
      return Promise.resolve({
        ok: opts.configOk ?? true,
        status: opts.configOk === false ? 500 : 200,
        json: () => Promise.resolve(opts.configResponse),
      });
    },
    crypto: { randomUUID: () => "uuid-" + Math.random().toString(16).slice(2) },
    setTimeout,
    URL,
    navigator,
    EventSource: FakeEventSource,
    TextDecoder,
  });
  window.document = document;

  // Same wrapper /company-widget/[id] prepends for the dynamic snippet.
  vm.runInContext(WIDGET_SRC, context);

  const shadow = () => body.find((n) => n.id === "relay-widget-root")?.shadowRoot ?? null;
  const byId = (id: string) => shadow()?.find((n) => n.id === id);
  const msgNodes = () => shadow()!.all().filter((n) => n.classList.contains("relay-msg"));
  return {
    body,
    shadow,
    byId,
    fetchCalls,
    fetchInits,
    store,
    window,
    navigator,
    fireWindow,
    msgNodes,
  };
}

const flush = async (n = 5) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
};

const LEGACY_CONFIG = {
  companyName: "Acme GmbH",
  config: {
    primaryColor: "#6366f1",
    position: "bottom-right",
    welcomeMessage: "Hi there! How can I help you today?",
    title: "Chat with us",
    avatarUrl: null,
    theme: "auto",
    showBranding: true,
    autoOpen: false,
    autoOpenDelay: 3000,
    persistThread: true,
    customCss: "#relay-widget-btn { width: 60px; }",
  },
};

describe("widget.js embed contract", () => {
  it("boots from the old data-widget-id embed and config shape", async () => {
    const w = bootWidget({
      configResponse: LEGACY_CONFIG,
      scriptAttrs: {
        src: "https://app.relay.ai/widget.js",
        "data-widget-id": "w_123",
      },
    });
    await flush();

    expect(w.fetchCalls[0]).toBe("https://app.relay.ai/api/widget/w_123/config");
    const root = w.body.find((n) => n.id === "relay-widget-root");
    expect(root?.shadowRoot).toBeTruthy();

    // Launcher, panel and the legacy element ids customCss relies on.
    for (const id of [
      "relay-widget-btn",
      "relay-widget-panel",
      "relay-widget-header",
      "relay-widget-messages",
      "relay-widget-input",
      "relay-widget-send",
      "relay-widget-branding",
    ]) {
      expect(w.byId(id), id).toBeTruthy();
    }

    // Custom CSS lands inside the shadow root.
    const custom = w.byId("relay-widget-custom-styles");
    expect(custom?.textContent).toContain("#relay-widget-btn");

    // Header shows the company name and initials.
    expect(w.byId("relay-widget-header-title")?.textContent).toBe("Acme GmbH");
    expect(w.byId("relay-widget-header")?.textContent).toContain("AG");

    // Legacy indigo default is not applied over the teal tokens.
    const styles = w.byId("relay-widget-styles")?.textContent ?? "";
    expect(styles).not.toContain("#6366f1");
    expect(styles).toContain("#147f6b");
    expect(styles).toContain("#2dd4bf");
  });

  it("opens and closes the panel from the launcher", async () => {
    const w = bootWidget({
      configResponse: LEGACY_CONFIG,
      scriptAttrs: { src: "/widget.js", "data-widget-id": "w_1" },
    });
    await flush();
    const panel = w.byId("relay-widget-panel")!;
    expect(panel.classList.contains("relay-open")).toBe(false);
    w.byId("relay-widget-btn")!.dispatch("click");
    expect(panel.classList.contains("relay-open")).toBe(true);
    expect(w.byId("relay-widget-container")!.classList.contains("relay-is-open")).toBe(true);
    panel.dispatch("keydown", { key: "Escape" });
    expect(panel.classList.contains("relay-open")).toBe(false);
    expect(typeof (w.window.RelayWidget as { open: unknown }).open).toBe("function");
  });

  it("still boots with defaults when the config request fails", async () => {
    const w = bootWidget({
      configResponse: {},
      configOk: false,
      scriptAttrs: { src: "/company-widget/w_9", "data-widget-id": "w_9" },
    });
    await flush();
    expect(w.byId("relay-widget-btn")).toBeTruthy();
    expect(w.byId("relay-widget-header-title")?.textContent).toBe("Chat with us");
  });

  it("applies a custom primary colour from config", async () => {
    const w = bootWidget({
      configResponse: {
        companyName: "Acme",
        config: { ...LEGACY_CONFIG.config, primaryColor: "#ff8800", customCss: null },
      },
      scriptAttrs: { src: "/widget.js", "data-widget-id": "w_2" },
    });
    await flush();
    expect(w.byId("relay-widget-styles")?.textContent).toContain("--primary: #ff8800");
  });

  it("restores a persisted thread and drops the legacy welcome bubble", async () => {
    const w = bootWidget({
      configResponse: LEGACY_CONFIG,
      scriptAttrs: { src: "/widget.js", "data-widget-id": "w_3" },
      storage: {
        relay_chat_w_3: "chat_1",
        relay_messages_w_3: JSON.stringify([
          { id: "a", role: "assistant", content: "Hi there! How can I help you today?" },
          { id: "b", role: "user", content: "Where is my order?" },
          { id: "c", role: "assistant", content: "It shipped." },
        ]),
      },
    });
    await flush();
    const msgs = w.shadow()!.all().filter((n) => n.classList.contains("relay-msg"));
    expect(msgs.map((n) => n.getAttribute("data-msg-id"))).toEqual(["b", "c"]);
  });
});

const CHAT = "11111111-1111-4111-8111-111111111111";
const delta = (text: string) => `data: ${JSON.stringify({ type: "text-delta", id: "t", delta: text })}\n\n`;
const metaText = (n: FakeNode | undefined) =>
  n?.find((c) => c.classList.contains("relay-msg-meta"))?.textContent ?? null;
const bubble = (n: FakeNode | undefined) =>
  n?.find((c) => c.classList.contains("relay-msg-bubble"))?.innerHTML ?? "";
const ids = (w: ReturnType<typeof bootWidget>) => w.msgNodes().map((n) => n.getAttribute("data-msg-id"));
const chatCalls = (w: ReturnType<typeof bootWidget>) =>
  w.fetchCalls.filter((u) => u.endsWith("/chat")).length;

function send(w: ReturnType<typeof bootWidget>, text: string) {
  w.byId("relay-widget-input")!.value = text;
  w.byId("relay-widget-send")!.dispatch("click");
}

describe("widget.js human message delivery (S34 routes)", () => {
  it("fetches missed messages after the cursor on open, then streams events", async () => {
    FakeEventSource.instances = [];
    const w = bootWidget({
      configResponse: LEGACY_CONFIG,
      scriptAttrs: { src: "https://app.relay.ai/widget.js", "data-widget-id": "w_h" },
      storage: {
        relay_chat_w_h: CHAT,
        relay_cursor_w_h: "srv-1",
        relay_messages_w_h: JSON.stringify([
          { id: "srv-1", role: "assistant", content: "Markus here", author: "human" },
          { id: "local-u", role: "user", content: "Thanks" },
          { id: "local-a", role: "assistant", content: "Glad to help" },
        ]),
      },
      route: (url) =>
        url.includes("/messages?")
          ? jsonResponse({
              messages: [
                { id: "srv-2", role: "user", content: "Thanks", author: null },
                { id: "srv-3", role: "assistant", content: "Glad to help", author: "agent" },
              ],
              handoff: "answered",
            })
          : undefined,
    });
    await flush();
    w.byId("relay-widget-btn")!.dispatch("click");
    await flush();

    expect(w.fetchCalls).toContain(
      `https://app.relay.ai/api/widget/w_h/messages?chatId=${CHAT}&after=srv-1`,
    );
    expect(ids(w)).toEqual(["srv-1", "srv-2", "srv-3"]);
    expect(w.byId("relay-widget-container")!.getAttribute("data-handoff")).toBe("answered");
    expect(w.store.relay_cursor_w_h).toBe("srv-3");
    const es = FakeEventSource.instances.at(-1)!;
    expect(es.url).toBe(`https://app.relay.ai/api/widget/w_h/events?chatId=${CHAT}&after=srv-3`);
  });

  it("appends a person's message from the event stream once and tracks handoff", async () => {
    FakeEventSource.instances = [];
    const w = bootWidget({
      configResponse: LEGACY_CONFIG,
      scriptAttrs: { src: "/widget.js", "data-widget-id": "w_e" },
      storage: { relay_chat_w_e: CHAT },
      route: (url) => (url.includes("/messages?") ? jsonResponse({ messages: [], handoff: null }) : undefined),
    });
    await flush();
    w.byId("relay-widget-btn")!.dispatch("click");
    await flush();
    expect(w.fetchCalls.some((u) => u.includes(`/messages?chatId=${CHAT}`) && !u.includes("after="))).toBe(true);
    const es = FakeEventSource.instances.at(-1)!;
    expect(es.url).toBe(`https://customer.example/api/widget/w_e/events?chatId=${CHAT}`);

    const human = {
      id: "srv-9",
      role: "assistant",
      content: "Hi, Markus from Acme here.",
      author: "human",
      authorDisplayName: "Markus Albrecht",
      createdAt: "2026-10-03T10:00:00.000Z",
    };
    es.emit("message", human, "srv-9");
    es.emit("message", human, "srv-9");
    es.emit("handoff", { status: "taken_over" });

    expect(ids(w)).toEqual(["srv-9"]);
    expect(w.msgNodes()[0].textContent).toContain("Markus Albrecht");
    expect(w.byId("relay-widget-container")!.getAttribute("data-handoff")).toBe("taken_over");
    expect(w.store.relay_cursor_w_e).toBe("srv-9");

    w.byId("relay-widget-panel")!.dispatch("keydown", { key: "Escape" });
    expect(es.readyState).toBe(2);
  });

  it("replaces local copies with the server transcript when there is no cursor", async () => {
    const w = bootWidget({
      configResponse: LEGACY_CONFIG,
      scriptAttrs: { src: "/widget.js", "data-widget-id": "w_r" },
      storage: {
        relay_chat_w_r: CHAT,
        relay_messages_w_r: JSON.stringify([
          { id: "local-u", role: "user", content: "Quote?" },
          { id: "local-a", role: "assistant", content: "Sure" },
        ]),
      },
      route: (url) =>
        url.includes("/messages?")
          ? jsonResponse({
              messages: [
                { id: "s1", role: "user", content: "Quote?" },
                { id: "s2", role: "assistant", content: "Sure", author: "agent" },
                { id: "s3", role: "assistant", content: "Markus: done", author: "human", authorDisplayName: "Markus" },
              ],
              handoff: "answered",
            })
          : undefined,
    });
    await flush();
    w.byId("relay-widget-btn")!.dispatch("click");
    await flush();
    expect(ids(w)).toEqual(["s1", "s2", "s3"]);
  });

  it("keeps the local thread when the chat is not found", async () => {
    const w = bootWidget({
      configResponse: LEGACY_CONFIG,
      scriptAttrs: { src: "/widget.js", "data-widget-id": "w_n" },
      storage: {
        relay_chat_w_n: CHAT,
        relay_messages_w_n: JSON.stringify([{ id: "local-u", role: "user", content: "Hi" }]),
      },
      route: (url) => (url.includes("/messages?") ? jsonResponse({ error: "Chat not found" }, 404) : undefined),
    });
    await flush();
    FakeEventSource.instances = [];
    w.byId("relay-widget-btn")!.dispatch("click");
    await flush();
    expect(ids(w)).toEqual(["local-u"]);
    expect(FakeEventSource.instances).toHaveLength(0);
  });
});

describe("widget.js streaming, error and offline states", () => {
  it("shows Typing… under the reply while it streams and clears it at the end", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const enc = new TextEncoder();
    let step = 0;
    const w = bootWidget({
      configResponse: LEGACY_CONFIG,
      scriptAttrs: { src: "/widget.js", "data-widget-id": "w_s" },
      route: (url) =>
        url.endsWith("/chat")
          ? {
              ok: true,
              status: 200,
              headers: { get: (k: string) => (k === "X-Chat-Id" ? CHAT : null) },
              body: {
                getReader: () => ({
                  read: () => {
                    step++;
                    if (step === 1) return Promise.resolve({ done: false, value: enc.encode(delta("Of course.")) });
                    if (step === 2) return gate.then(() => ({ done: false, value: enc.encode(delta(" Thursday?")) }));
                    return Promise.resolve({ done: true });
                  },
                }),
              },
            }
          : undefined,
    });
    await flush();
    send(w, "Quote please");
    await flush();
    const reply = w.msgNodes()[1];
    expect(bubble(reply)).toContain("Of course.");
    expect(metaText(reply)).toBe("Typing…");
    release();
    await flush();
    expect(bubble(reply)).toContain("Of course. Thursday?");
    expect(metaText(reply)).toBeNull();
    expect(w.store.relay_chat_w_s).toBe(CHAT);
  });

  it("marks a broken stream as interrupted and retries on tap", async () => {
    let call = 0;
    const w = bootWidget({
      configResponse: LEGACY_CONFIG,
      scriptAttrs: { src: "/widget.js", "data-widget-id": "w_i" },
      route: (url) => {
        if (!url.endsWith("/chat")) return undefined;
        call++;
        return call === 1
          ? streamResponse([delta("Of course. For 1,200 m²")], { failAfter: true })
          : streamResponse([delta("Full answer.")]);
      },
    });
    await flush();
    send(w, "Quote please");
    await flush();
    const partial = w.msgNodes()[1];
    expect(metaText(partial)).toBe("Reply interrupted. Tap to retry.");

    partial.find((c) => c.classList.contains("relay-msg-meta-error"))!.dispatch("click");
    await flush();
    expect(chatCalls(w)).toBe(2);
    const nodes = w.msgNodes();
    expect(nodes).toHaveLength(2);
    expect(bubble(nodes[1])).toContain("Full answer.");
    expect(metaText(nodes[1])).toBeNull();
    const body = JSON.parse(w.fetchInits.at(-1)!.body!);
    expect(body.messages.map((m: { content: string }) => m.content)).toEqual(["Quote please"]);
  });

  it("treats a v6 error event as an interrupted reply", async () => {
    const w = bootWidget({
      configResponse: LEGACY_CONFIG,
      scriptAttrs: { src: "/widget.js", "data-widget-id": "w_v" },
      route: (url) =>
        url.endsWith("/chat")
          ? streamResponse([delta("Partial"), `data: ${JSON.stringify({ type: "error", errorText: "overloaded" })}\n\n`])
          : undefined,
    });
    await flush();
    send(w, "Hi");
    await flush();
    expect(metaText(w.msgNodes()[1])).toBe("Reply interrupted. Tap to retry.");
  });

  it("marks the message as not sent when the request fails online", async () => {
    const w = bootWidget({
      configResponse: LEGACY_CONFIG,
      scriptAttrs: { src: "/widget.js", "data-widget-id": "w_f" },
      route: (url) => (url.endsWith("/chat") ? jsonResponse({ error: "x" }, 500) : undefined),
    });
    await flush();
    send(w, "Hi");
    await flush();
    const nodes = w.msgNodes();
    expect(nodes).toHaveLength(1);
    expect(metaText(nodes[0])).toBe("Message not sent. Tap to retry.");
  });

  it("queues messages while offline and sends them in order when back online", async () => {
    const w = bootWidget({
      configResponse: LEGACY_CONFIG,
      scriptAttrs: { src: "/widget.js", "data-widget-id": "w_o" },
      online: false,
      route: (url) => (url.endsWith("/chat") ? streamResponse([delta("Got it.")]) : undefined),
    });
    await flush();
    const container = w.byId("relay-widget-container")!;
    expect(container.hasAttribute("data-offline")).toBe(true);
    const offline = w.shadow()!.find((n) => n.classList.contains("relay-offline"))!;
    expect(offline.hasAttribute("hidden")).toBe(false);
    expect(offline.textContent).toContain("You are offline");

    send(w, "First");
    send(w, "Second");
    await flush();
    expect(chatCalls(w)).toBe(0);
    expect(w.msgNodes().map(metaText)).toEqual(["Waiting for connection", "Waiting for connection"]);
    expect(JSON.parse(w.store.relay_messages_w_o)).toHaveLength(2);

    w.navigator.onLine = true;
    w.fireWindow("online");
    await flush(10);
    expect(container.hasAttribute("data-offline")).toBe(false);
    expect(offline.hasAttribute("hidden")).toBe(true);
    expect(chatCalls(w)).toBe(2);
    const first = JSON.parse(w.fetchInits.find((i) => i?.method === "POST")!.body!);
    expect(first.messages.map((m: { content: string }) => m.content)).toEqual(["First"]);
    const second = JSON.parse(w.fetchInits.filter((i) => i?.method === "POST")[1]!.body!);
    expect(second.messages.map((m: { content: string }) => m.content)).toEqual(["First", "Got it.", "Second"]);
    expect(w.msgNodes().map(metaText)).toEqual([null, null, null, null]);
  });

  it("queues instead of failing when the connection drops during send", async () => {
    const w = bootWidget({
      configResponse: LEGACY_CONFIG,
      scriptAttrs: { src: "/widget.js", "data-widget-id": "w_d" },
      route: (url) => {
        if (!url.endsWith("/chat")) return undefined;
        w.navigator.onLine = false;
        return Promise.reject(new TypeError("Failed to fetch")) as never;
      },
    });
    await flush();
    send(w, "Hi");
    await flush();
    expect(metaText(w.msgNodes()[0])).toBe("Waiting for connection");
    expect(w.byId("relay-widget-container")!.hasAttribute("data-offline")).toBe(true);
  });
});

describe("widget.js handoff states (S62)", () => {
  const byClass = (w: ReturnType<typeof bootWidget>, c: string) =>
    w.shadow()!.all().find((n) => n.classList.contains(c));
  const visible = (n: FakeNode | undefined) => !!n && !n.hasAttribute("hidden");

  function openWith(widget: string, handoff: unknown, messages: unknown[] = []) {
    FakeEventSource.instances = [];
    const w = bootWidget({
      configResponse: LEGACY_CONFIG,
      scriptAttrs: { src: "https://app.relay.ai/widget.js", "data-widget-id": widget },
      storage: { [`relay_chat_${widget}`]: CHAT },
      route: (url) => {
        if (url.includes("/messages?")) return jsonResponse({ messages, ...(handoff as object) });
        if (url.endsWith("/typing")) return { ok: true, status: 204 };
        return undefined;
      },
    });
    return w;
  }

  it("shows the waiting line while a colleague is asked, and hides it once answered", async () => {
    const w = openWith("w_wait", { handoff: "open" });
    await flush();
    w.byId("relay-widget-btn")!.dispatch("click");
    await flush();

    const tail = w.byId("relay-handoff")!;
    expect(visible(tail)).toBe(true);
    expect(tail.textContent).toBe("Asking a colleague at Acme GmbH…");

    FakeEventSource.instances.at(-1)!.emit("handoff", { status: "answered" });
    expect(w.byId("relay-widget-container")!.getAttribute("data-handoff")).toBe("answered");
    expect(visible(w.byId("relay-handoff"))).toBe(false);
  });

  it("heads a person's reply with their initials, name, company and time", async () => {
    const w = openWith("w_rep", { handoff: "answered" }, [
      { id: "s1", role: "user", content: "Weekend cleaning?" },
      {
        id: "s2",
        role: "assistant",
        content: "Yes, we can.",
        author: "human",
        authorDisplayName: "Markus Albrecht",
        createdAt: "2026-10-03T11:49:00",
      },
      {
        id: "s3",
        role: "assistant",
        content: "And on Sundays too.",
        author: "human",
        authorDisplayName: "Markus Albrecht",
        createdAt: "2026-10-03T11:50:00",
      },
    ]);
    await flush();
    w.byId("relay-widget-btn")!.dispatch("click");
    await flush();

    const [, first, second] = w.msgNodes();
    const head = first.find((n) => n.classList.contains("relay-msg-human-head"))!;
    expect(head.find((n) => n.classList.contains("relay-avatar"))!.textContent).toBe("MA");
    expect(head.find((n) => n.classList.contains("relay-msg-author"))!.textContent).toBe(
      "Markus Albrecht · Acme GmbH",
    );
    expect(head.find((n) => n.classList.contains("relay-msg-time"))!.textContent).toBe("11:49");
    // A follow-up from the same person is not headed again.
    expect(second.find((n) => n.classList.contains("relay-msg-human-head"))).toBeUndefined();
  });

  it("announces the takeover, shows the person typing, and clears it on their message", async () => {
    const w = openWith("w_take", { handoff: null }, [{ id: "s1", role: "user", content: "Great, I'll wait." }]);
    await flush();
    w.byId("relay-widget-btn")!.dispatch("click");
    await flush();
    const es = FakeEventSource.instances.at(-1)!;

    es.emit("handoff", { status: "taken_over", person: "Markus Albrecht" });
    const joined = byClass(w, "relay-handoff-joined")!;
    expect(joined.textContent).toBe("Markus Albrecht from Acme GmbH joined the chat");

    es.emit("typing", { person: true });
    const tail = w.byId("relay-handoff")!;
    expect(visible(tail)).toBe(true);
    expect(tail.textContent).toContain("Markus Albrecht is typing…");
    expect(tail.find((n) => n.classList.contains("relay-avatar"))!.textContent).toBe("MA");

    es.emit(
      "message",
      { id: "s2", role: "assistant", content: "Hi Lukas.", author: "human", authorDisplayName: "Markus Albrecht" },
      "s2",
    );
    expect(visible(w.byId("relay-handoff"))).toBe(false);

    // Transcript order: the customer's message, the joined line, then the person's reply.
    const log = w.byId("relay-widget-messages")!.children;
    const order = log
      .filter((n) => n.classList.contains("relay-msg") || n.classList.contains("relay-handoff-joined"))
      .map((n) => n.getAttribute("data-msg-id") ?? "joined");
    expect(order).toEqual(["s1", "joined", "s2"]);

    es.emit("handoff", { status: "handed_back" });
    expect(byClass(w, "relay-handoff-joined")).toBeDefined();
    expect(visible(w.byId("relay-handoff"))).toBe(false);
  });

  it("posts customer typing during a takeover, at most once every few seconds", async () => {
    const w = openWith("w_typ", { handoff: "taken_over" });
    await flush();
    w.byId("relay-widget-btn")!.dispatch("click");
    await flush();

    const input = w.byId("relay-widget-input")!;
    input.value = "Tue";
    input.dispatch("input");
    input.value = "Tue 29";
    input.dispatch("input");

    const typingCalls = w.fetchCalls
      .map((u, i) => ({ u, init: w.fetchInits[i] }))
      .filter((c) => c.u.endsWith("/typing"));
    expect(typingCalls).toHaveLength(1);
    expect(typingCalls[0].u).toBe("https://app.relay.ai/api/widget/w_typ/typing");
    expect(typingCalls[0].init?.method).toBe("POST");
    expect(JSON.parse(typingCalls[0].init!.body!)).toEqual({ chatId: CHAT });
  });

  it("does not post typing outside a takeover", async () => {
    const w = openWith("w_notyp", { handoff: "open" });
    await flush();
    w.byId("relay-widget-btn")!.dispatch("click");
    await flush();
    const input = w.byId("relay-widget-input")!;
    input.value = "Hello";
    input.dispatch("input");
    expect(w.fetchCalls.filter((u) => u.endsWith("/typing"))).toHaveLength(0);
  });
});
