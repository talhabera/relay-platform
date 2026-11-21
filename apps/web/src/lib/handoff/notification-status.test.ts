import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { db } from "@/db";
import {
  statusesBefore,
  updateHandoffNotificationStatus,
} from "./notification-status";

const dialect = new PgDialect();
const AT = new Date("2026-10-03T10:00:00Z");

let set: ReturnType<typeof vi.fn>;
let where: ReturnType<typeof vi.fn>;
let returning: ReturnType<typeof vi.fn>;

beforeEach(() => {
  returning = vi.fn().mockResolvedValue([{ id: "req-1" }]);
  where = vi.fn(() => ({ returning }));
  set = vi.fn(() => ({ where }));
  vi.mocked(db.update).mockImplementation((() => ({ set })) as never);
});

function renderedWhere() {
  return dialect.sqlToQuery(where.mock.calls[0][0] as SQL);
}

describe("statusesBefore (forward-only order)", () => {
  it("moves sent < delivered < read, and failed is terminal", () => {
    expect(statusesBefore("sent")).toEqual([]);
    expect(statusesBefore("delivered")).toEqual(["sent"]);
    expect(statusesBefore("read")).toEqual(["sent", "delivered"]);
    expect(statusesBefore("failed")).toEqual(["sent", "delivered", "read"]);
    // Nothing may replace failed.
    for (const next of ["sent", "delivered", "read", "failed"] as const) {
      expect(statusesBefore(next)).not.toContain("failed");
    }
  });

  it("rejects an out-of-order update (delivered after read)", () => {
    expect(statusesBefore("delivered")).not.toContain("read");
    expect(statusesBefore("read")).not.toContain("read");
  });
});

describe("updateHandoffNotificationStatus", () => {
  it.each(["delivered", "read"] as const)(
    "records %s on the company's request by wamid",
    async (status) => {
      const ok = await updateHandoffNotificationStatus({
        waMessageId: "wamid.N1",
        companyId: "company-1",
        status,
        statusAt: AT,
      });

      expect(ok).toBe(true);
      expect(set).toHaveBeenCalledWith(
        expect.objectContaining({
          notificationStatus: status,
          notificationStatusAt: AT,
          notificationError: null,
        }),
      );
      const { sql, params } = renderedWhere();
      expect(sql).toContain('"notification_message_id" = $1');
      expect(sql).toContain('"company_id" = $2');
      expect(params.slice(0, 2)).toEqual(["wamid.N1", "company-1"]);
      // Only earlier statuses may be replaced.
      expect(params.slice(2)).toEqual(statusesBefore(status));
    },
  );

  it("records failed with its error", async () => {
    await updateHandoffNotificationStatus({
      waMessageId: "wamid.N1",
      companyId: "company-1",
      status: "failed",
      statusAt: AT,
      error: { code: 131026, title: "Message undeliverable" },
    });

    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        notificationStatus: "failed",
        notificationError: { code: 131026, title: "Message undeliverable" },
      }),
    );
    expect(renderedWhere().params.slice(2)).toEqual(["sent", "delivered", "read"]);
  });

  it("guards a late sent so it only lands on a request with no status", async () => {
    await updateHandoffNotificationStatus({
      waMessageId: "wamid.N1",
      companyId: "company-1",
      status: "sent",
      statusAt: AT,
    });
    const { sql, params } = renderedWhere();
    expect(sql).toContain('"notification_status" is null');
    expect(params).toEqual(["wamid.N1", "company-1"]);
  });

  it("reports false for an out-of-order or unknown wamid (no row matched)", async () => {
    returning.mockResolvedValue([]);
    const ok = await updateHandoffNotificationStatus({
      waMessageId: "wamid.UNKNOWN",
      companyId: "company-1",
      status: "delivered",
      statusAt: AT,
    });
    expect(ok).toBe(false);
  });
});
