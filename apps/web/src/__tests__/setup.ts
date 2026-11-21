import { vi } from "vitest";

vi.stubEnv("WORKER_URL", "http://worker:3001");
vi.stubEnv("WORKER_SECRET", "test-secret");

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    query: {
      companies: { findFirst: vi.fn(), findMany: vi.fn() },
      agents: { findFirst: vi.fn(), findMany: vi.fn() },
      workflows: { findFirst: vi.fn(), findMany: vi.fn() },
      workflowStages: { findFirst: vi.fn(), findMany: vi.fn() },
      channels: { findFirst: vi.fn(), findMany: vi.fn() },
      instagramComments: { findFirst: vi.fn(), findMany: vi.fn() },
      integrations: { findFirst: vi.fn(), findMany: vi.fn() },
      widgetConfigs: { findFirst: vi.fn() },
      knowledgeBase: { findMany: vi.fn(), findFirst: vi.fn() },
      chats: { findFirst: vi.fn(), findMany: vi.fn() },
      companyMembers: { findFirst: vi.fn(), findMany: vi.fn() },
      operatorAgentEditors: { findFirst: vi.fn(), findMany: vi.fn() },
      checkpoints: { findFirst: vi.fn(), findMany: vi.fn() },
      agentQuestions: { findFirst: vi.fn(), findMany: vi.fn(async () => []) },
      companyRecords: { findFirst: vi.fn(), findMany: vi.fn() },
      agentVersions: { findFirst: vi.fn(), findMany: vi.fn() },
      sessionFiles: { findFirst: vi.fn(), findMany: vi.fn() },
      cronJobs: { findFirst: vi.fn(), findMany: vi.fn() },
      cronRuns: { findFirst: vi.fn(), findMany: vi.fn() },
      messages: { findMany: vi.fn(), findFirst: vi.fn() },
      tokenUsage: { findFirst: vi.fn() },
      users: { findFirst: vi.fn() },
    },
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(() => [{ id: "test-id" }]),
        onConflictDoUpdate: vi.fn(),
        onConflictDoNothing: vi.fn(),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn().mockResolvedValue([]),
        })),
      })),
    })),
    delete: vi.fn(() => ({
      where: vi.fn(),
    })),
  },
}));

vi.mock("@relay/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@relay/db")>();
  return {
    ...actual,
    db: mockDb,
  };
});

vi.mock("@/db", () => ({
  db: mockDb,
}));

// Rate limits allow by default; a test that exercises a 429 overrides
// `enforceSurface` with mockResolvedValueOnce. The pure helpers stay real.
vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>();
  return {
    ...actual,
    enforceSurface: vi.fn(async () => ({ ok: true, release: async () => {} })),
    assertWithinLimits: vi.fn(async () => {}),
  };
});

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
  handlers: { GET: vi.fn(), POST: vi.fn() },
}));

// Mock auth-server
vi.mock("@/lib/auth-server", () => ({
  getSession: vi.fn(),
  requireSession: vi.fn(),
}));

// Mock next/headers
vi.mock("next/headers", () => ({
  headers: vi.fn(() => new Headers()),
}));

// Mock AI modules
vi.mock("@/lib/ai/provider", () => ({
  getModel: vi.fn(() => "mock-model"),
}));

vi.mock("@/lib/ai/system-prompt", () => ({
  buildSystemPrompt: vi.fn(() => "You are a test assistant"),
}));

vi.mock("@/lib/operator/system-prompt", () => ({
  buildOperatorSystemPrompt: vi.fn(() => "You are a test operator"),
}));

vi.mock("@/lib/ai/chat-persistence", () => ({
  createChatSession: vi.fn(() => "chat-123"),
  saveUserMessage: vi.fn(),
  saveAssistantMessage: vi.fn(),
  getChatHistory: vi.fn(() => []),
  getUserChats: vi.fn(() => []),
  getVisitorChats: vi.fn(() => []),
}));
