import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { isClientUser, upsertUserFromProfile } from "./users";

describe("upsertUserFromProfile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects an empty email without touching the db", async () => {
    await expect(
      upsertUserFromProfile({ id: "sub-1", email: "   " }),
    ).rejects.toThrow("Email is required to sign in");
    expect(db.query.users.findFirst).not.toHaveBeenCalled();
  });

  it("inserts a new row and returns the IdP id", async () => {
    vi.mocked(db.query.users.findFirst).mockResolvedValue(undefined);
    const values = vi.fn().mockResolvedValue(undefined);
    vi.mocked(db.insert).mockReturnValue({ values } as never);

    const id = await upsertUserFromProfile({
      id: "oidc-sub",
      email: "Alex@Relay.dev",
      name: "Alex",
      image: "https://example.com/a.png",
    });

    expect(id).toBe("oidc-sub");
    expect(values).toHaveBeenCalledWith({
      id: "oidc-sub",
      name: "Alex",
      email: "alex@relay.dev",
      emailVerified: true,
      image: "https://example.com/a.png",
    });
  });

  it("reuses an existing email and keeps the original id", async () => {
    vi.mocked(db.query.users.findFirst).mockResolvedValue({
      id: "seed-user-1",
      email: "test@relay.dev",
    } as never);
    const set = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
    vi.mocked(db.update).mockReturnValue({ set } as never);

    const id = await upsertUserFromProfile({
      id: "different-oidc-sub",
      email: "test@relay.dev",
      name: "Test User",
      image: null,
    });

    expect(id).toBe("seed-user-1");
    expect(db.insert).not.toHaveBeenCalled();
    expect(set).toHaveBeenCalledWith({
      name: "Test User",
      image: null,
      emailVerified: true,
      updatedAt: expect.any(Date),
    });
  });
});

describe("isClientUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("is true when the user has a client membership row", async () => {
    vi.mocked(db.query.companyMembers.findFirst).mockResolvedValue({
      id: "row-1",
    } as never);
    await expect(isClientUser("user-1")).resolves.toBe(true);
  });

  it("is false without a client membership row", async () => {
    vi.mocked(db.query.companyMembers.findFirst).mockResolvedValue(undefined);
    await expect(isClientUser("user-1")).resolves.toBe(false);
  });

  it("skips the query for an empty user id", async () => {
    await expect(isClientUser("")).resolves.toBe(false);
    expect(db.query.companyMembers.findFirst).not.toHaveBeenCalled();
  });
});
