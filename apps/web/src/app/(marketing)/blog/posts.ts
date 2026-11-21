/**
 * Blog posts as static TS (Figma 09 `blog-index`, `blog-post`). No CMS (plan NON-GOALS): a new
 * post is a new entry here. Newest first; the first post of a listing is the featured card.
 */

import type { IconName } from "@/components/v2/primitives";

export const BLOG_FILTERS = ["Lead engine", "Operator", "Customer agents", "Product"] as const;

export type BlogFilter = (typeof BLOG_FILTERS)[number];
export type BlogCategory = BlogFilter | "Industry" | "Tutorial";

export type PostBlock =
  | { type: "paragraph"; text: string }
  | { type: "subhead"; text: string }
  /** The Lead engine preview (same illustration as the landing hero) with a caption. */
  | { type: "lead-engine-figure"; caption: string }
  | { type: "callout"; text: string };

export type BlogAuthor = { name: string; initials: string };

export type BlogPost = {
  slug: string;
  title: string;
  /** Card excerpt and the article lead. */
  excerpt: string;
  category: BlogCategory;
  /** ISO date, `YYYY-MM-DD`. */
  date: string;
  author: BlogAuthor;
  /** Cover tile glyph. */
  icon: IconName;
  body: readonly PostBlock[];
};

const TALHA: BlogAuthor = { name: "Talha Bera", initials: "TB" };

export const BLOG_POSTS: readonly BlogPost[] = [
  {
    slug: "how-one-agency-runs-a-lead-engine-for-every-client",
    title: "How one agency runs a lead engine for every client",
    excerpt:
      "Acme GmbH set a target of 10 qualified leads a week. Lead Gatherer found 146, Lead Qualifier kept 44, Mail Marketer contacted 31 and 9 replied. Here is how the agency runs it, and where it stops for approval.",
    category: "Lead engine",
    date: "2026-09-24",
    author: TALHA,
    icon: "workflow",
    body: [
      {
        type: "paragraph",
        text: "Acme GmbH asks its agency one question every week: how many qualified leads did we get? The target is 10. This week, 21–27 Sep 2026, the answer so far is 6 delivered, at €41 per qualified lead and a lead quality score of 82.",
      },
      { type: "subhead", text: "Four stages, one workflow" },
      {
        type: "paragraph",
        text: "The lead engine is one workflow per client company. Lead Gatherer searches Google Places, Hunter and Snov for offices that fit the client’s ideal customer. Lead Qualifier scores each lead against the client’s criteria. Mail Marketer drafts the outreach. Qualified leads that reply go to the client, each with the reason it fits.",
      },
      {
        type: "lead-engine-figure",
        caption:
          "Acme GmbH this week: 146 gathered, 44 qualified, 31 contacted with 9 replies, 6 delivered to the client.",
      },
      { type: "subhead", text: "Where it stops for you" },
      {
        type: "paragraph",
        text: "Nothing goes out until someone approves it. Before the sequence to 44 leads starts, Mail Marketer stops at a checkpoint that shows exactly what will be sent, to whom and when. You approve, ask for changes, or discard.",
      },
      {
        type: "callout",
        text: "Inbound leads from the client’s website widget, WhatsApp and Instagram join the same Qualify queue, so customer agents feed the lead engine too.",
      },
      { type: "subhead", text: "What the agency sees" },
      {
        type: "paragraph",
        text: "Three numbers per client, every week: qualified leads delivered against target, lead quality score, and cost per qualified lead. For Acme this week that is 6 of 10, a quality score of 82, and €41. Everything waiting on you sits in one Needs you list.",
      },
    ],
  },
  {
    slug: "why-two-kinds-of-agent",
    title: "Why two kinds of agent",
    excerpt:
      "Customer agents answer your clients’ customers. Operator agents work for your team. The kind is set at create and never changes.",
    category: "Product",
    date: "2026-09-12",
    author: TALHA,
    icon: "bot",
    body: [
      {
        type: "paragraph",
        text: "Every agent in Relay is one of two kinds. A customer agent talks to your clients’ customers on the website widget, WhatsApp, Instagram or Shopify. An operator agent works for your team inside the company: it runs versioned sessions with the tools you enable.",
      },
      { type: "subhead", text: "Set once, at create" },
      {
        type: "paragraph",
        text: "The kind is chosen when the agent is created and never changes. There is no conversion between kinds, so a channel-facing agent can never pick up an internal tool by accident, and an operator agent never answers on a public channel.",
      },
      {
        type: "callout",
        text: "Need both for one client? Create one of each. They share nothing but the company they belong to.",
      },
    ],
  },
  {
    slug: "approvals-belong-to-the-person-who-started-the-work",
    title: "Approvals belong to the person who started the work",
    excerpt:
      "A checkpoint goes to whoever started the session. Members without approval rights get a read-only view.",
    category: "Operator",
    date: "2026-09-04",
    author: TALHA,
    icon: "clipboard-check",
    body: [
      {
        type: "paragraph",
        text: "When an operator session reaches a checkpoint, it asks the person who started it. They see what the agent wants to do and approve it, ask for changes, or discard it.",
      },
      { type: "subhead", text: "Read-only for everyone else" },
      {
        type: "paragraph",
        text: "Other company members can open the session and follow along. Without approval rights they get a read-only view: the transcript and the checkpoint, but no buttons.",
      },
    ],
  },
  {
    slug: "versioning-operators-without-breaking-live-runs",
    title: "Versioning operators without breaking live runs",
    excerpt:
      "Edit a draft while v1 keeps running. Publish when it is ready; running sessions finish on the version they started.",
    category: "Operator",
    date: "2026-08-28",
    author: TALHA,
    icon: "git-branch",
    body: [
      {
        type: "paragraph",
        text: "Operator agents are versioned. Instructions and tools live on a version, and only one version is live at a time.",
      },
      { type: "subhead", text: "Draft, then publish" },
      {
        type: "paragraph",
        text: "Edit a draft while v1 keeps running. When the draft is ready, publish it and new sessions start on it. Sessions already running finish on the version they started, so a change never lands halfway through a run.",
      },
    ],
  },
  {
    slug: "how-ai-agents-are-reshaping-customer-support-in-2026",
    title: "How AI agents are reshaping customer support in 2026",
    excerpt:
      "What changes when an agency runs the same knowledge across widget, WhatsApp and Instagram.",
    category: "Industry",
    date: "2026-02-05",
    author: TALHA,
    icon: "message-square",
    body: [
      {
        type: "paragraph",
        text: "Customers ask the same questions on every channel. When an agency keeps one body of knowledge per agent and puts that agent on the website widget, WhatsApp and Instagram, the answers stay the same wherever the question arrives.",
      },
      {
        type: "paragraph",
        text: "The work that changes is the agency’s: less copying answers between inboxes, more time on the conversations that need a person.",
      },
    ],
  },
  {
    slug: "getting-started-with-multi-channel-deployment",
    title: "Getting started with multi-channel deployment",
    excerpt: "Create a customer agent, attach a channel, and keep operator work separate.",
    category: "Tutorial",
    date: "2026-01-28",
    author: TALHA,
    icon: "globe",
    body: [
      { type: "subhead", text: "Create a customer agent" },
      {
        type: "paragraph",
        text: "Give it a persona, instructions and knowledge. Knowledge belongs to the agent, so what you add here is what it answers from.",
      },
      { type: "subhead", text: "Attach a channel" },
      {
        type: "paragraph",
        text: "Embed the website widget, or connect WhatsApp, Instagram or Shopify. One customer agent can answer on several channels.",
      },
      {
        type: "callout",
        text: "Operator work stays separate: internal tools belong on operator agents, never on a customer agent.",
      },
    ],
  },
  {
    slug: "named-http-endpoints-on-an-operator-agent",
    title: "Named HTTP endpoints on an operator agent",
    excerpt: "The model fills arguments. URLs and header secrets stay on the server.",
    category: "Operator",
    date: "2025-12-20",
    author: TALHA,
    icon: "link",
    body: [
      {
        type: "paragraph",
        text: "An operator agent can call your own APIs through named HTTP endpoints. You define the endpoint once: its name, URL, method and headers.",
      },
      {
        type: "paragraph",
        text: "During a session the model only picks the endpoint by name and fills its arguments. The URL and any header secrets stay on the server and never reach the model, the browser or logs.",
      },
    ],
  },
];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** `2026-09-24` -> `24 Sep 2026` (Figma meta format, timezone-free). */
export function formatPostDate(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

/** Minutes at 200 words a minute, at least 1. */
export function readMinutes(post: BlogPost): number {
  const words = [post.excerpt, ...post.body.map((b) => ("text" in b ? b.text : b.caption))]
    .join(" ")
    .split(/\s+/)
    .filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

export function getPost(slug: string): BlogPost | undefined {
  return BLOG_POSTS.find((post) => post.slug === slug);
}

export function isBlogFilter(value: unknown): value is BlogFilter {
  return typeof value === "string" && (BLOG_FILTERS as readonly string[]).includes(value);
}

/** Grid cards per page under the featured card. */
export const BLOG_PAGE_SIZE = 6;

export type BlogIndex = {
  category: BlogFilter | null;
  page: number;
  featured: BlogPost | null;
  grid: readonly BlogPost[];
  hasOlder: boolean;
};

/** Listing for `/blog?category=&page=`: page 1 shows the featured post plus six; later pages six each. */
export function blogIndex({ category, page }: { category?: string; page?: string }): BlogIndex {
  const filter = isBlogFilter(category) ? category : null;
  const pageNumber = Math.max(1, Number.parseInt(page ?? "1", 10) || 1);
  const posts = filter ? BLOG_POSTS.filter((post) => post.category === filter) : BLOG_POSTS;
  const [first = null, ...rest] = posts;
  const start = (pageNumber - 1) * BLOG_PAGE_SIZE;
  return {
    category: filter,
    page: pageNumber,
    featured: pageNumber === 1 ? first : null,
    grid: rest.slice(start, start + BLOG_PAGE_SIZE),
    hasOlder: rest.length > start + BLOG_PAGE_SIZE,
  };
}

/** Three other posts, same category first, then newest. */
export function relatedPosts(slug: string, limit = 3): BlogPost[] {
  const current = getPost(slug);
  const others = BLOG_POSTS.filter((post) => post.slug !== slug);
  const same = others.filter((post) => post.category === current?.category);
  const rest = others.filter((post) => post.category !== current?.category);
  return [...same, ...rest].slice(0, limit);
}
