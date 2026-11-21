import { describe, expect, it } from "vitest";
import { parseCommentEvents, parseDirectMessageEvents } from "./instagram-webhook";

const IG_ACCOUNT_ID = "17841400000000000";

function commentBody(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    object: "instagram",
    entry: [
      {
        id: IG_ACCOUNT_ID,
        time: 1_757_000_000,
        changes: [
          {
            field: "comments",
            value: {
              id: "17900000000000000",
              text: "Bu urun stokta mi?",
              parent_id: "17899999999999999",
              from: { id: "9876543210", username: "alex.creative" },
              media: { id: "17800000000000000", media_product_type: "FEED" },
              ...overrides,
            },
          },
        ],
      },
    ],
  });
}

describe("parseCommentEvents", () => {
  it("maps a comment change into an event", () => {
    expect(parseCommentEvents(commentBody())).toEqual([
      {
        igAccountId: IG_ACCOUNT_ID,
        igCommentId: "17900000000000000",
        igMediaId: "17800000000000000",
        parentIgCommentId: "17899999999999999",
        fromIgUserId: "9876543210",
        fromUsername: "alex.creative",
        content: "Bu urun stokta mi?",
        commentedAt: new Date(1_757_000_000 * 1000),
        raw: {
          id: "17900000000000000",
          text: "Bu urun stokta mi?",
          parent_id: "17899999999999999",
          from: { id: "9876543210", username: "alex.creative" },
          media: { id: "17800000000000000", media_product_type: "FEED" },
        },
      },
    ]);
  });

  it("carries the delivered value through as raw, unmodelled fields included", () => {
    const body = commentBody({
      media: { id: "17800000000000000", media_product_type: "REELS" },
      unmodelled_field: "surprise",
    });
    const [event] = parseCommentEvents(body);
    expect(event.raw).toEqual({
      id: "17900000000000000",
      text: "Bu urun stokta mi?",
      parent_id: "17899999999999999",
      from: { id: "9876543210", username: "alex.creative" },
      media: { id: "17800000000000000", media_product_type: "REELS" },
      unmodelled_field: "surprise",
    });
  });

  it("takes the timestamp from the entry, which the change value lacks", () => {
    const [event] = parseCommentEvents(commentBody());
    expect(event.commentedAt.toISOString()).toBe(
      new Date(1_757_000_000 * 1000).toISOString(),
    );
  });

  it("skips our own reply so the agent cannot answer itself", () => {
    const body = commentBody({ from: { id: IG_ACCOUNT_ID, username: "brand" } });
    expect(parseCommentEvents(body)).toEqual([]);
  });

  it("ignores changes on fields other than comments", () => {
    const body = JSON.stringify({
      entry: [
        {
          id: IG_ACCOUNT_ID,
          time: 1_757_000_000,
          changes: [{ field: "mentions", value: { id: "1" } }],
        },
      ],
    });
    expect(parseCommentEvents(body)).toEqual([]);
  });

  it("skips a change with no comment id or media id", () => {
    const noId = commentBody({ id: undefined });
    const noMedia = commentBody({ media: undefined });
    expect(parseCommentEvents(noId)).toEqual([]);
    expect(parseCommentEvents(noMedia)).toEqual([]);
  });

  it("defaults missing text to an empty string and absent author to null", () => {
    const [event] = parseCommentEvents(
      commentBody({ text: undefined, from: undefined }),
    );
    expect(event.content).toBe("");
    expect(event.fromIgUserId).toBeNull();
    expect(event.fromUsername).toBeNull();
  });

  it("returns a null parent for a top-level comment", () => {
    const [event] = parseCommentEvents(commentBody({ parent_id: undefined }));
    expect(event.parentIgCommentId).toBeNull();
  });

  it("returns nothing for a body that is not JSON", () => {
    expect(parseCommentEvents("<html>nope</html>")).toEqual([]);
  });

  it("returns nothing for JSON without entries", () => {
    expect(parseCommentEvents(JSON.stringify({ object: "instagram" }))).toEqual(
      [],
    );
  });

  // This parser runs on the shared route before the DM branch, so a throw here
  // would 500 a direct message too.
  it("returns an empty list rather than throwing when the parsed body is not an object", () => {
    expect(() => parseCommentEvents("null")).not.toThrow();
    expect(parseCommentEvents("null")).toEqual([]);
  });

  it("returns an empty list rather than throwing when an entry is null", () => {
    expect(() => parseCommentEvents('{"entry":[null]}')).not.toThrow();
    expect(parseCommentEvents('{"entry":[null]}')).toEqual([]);
  });

  it("skips a null element in changes but still returns the valid comment beside it", () => {
    const raw = JSON.stringify({
      object: "instagram",
      entry: [
        {
          id: IG_ACCOUNT_ID,
          time: 1_757_000_000,
          changes: [
            null,
            {
              field: "comments",
              value: {
                id: "17900000000000000",
                text: "Bu urun stokta mi?",
                from: { id: "9876543210", username: "alex.creative" },
                media: { id: "17800000000000000" },
              },
            },
          ],
        },
      ],
    });

    expect(() => parseCommentEvents(raw)).not.toThrow();
    const events = parseCommentEvents(raw);
    expect(events).toHaveLength(1);
    expect(events[0].igCommentId).toBe("17900000000000000");
  });
});

const SENDER_ID = "9876543210";

function dm(message: Record<string, unknown>, sender = SENDER_ID) {
  return JSON.stringify({
    object: "instagram",
    entry: [
      {
        id: IG_ACCOUNT_ID,
        time: 1_757_000_000,
        messaging: [
          {
            sender: { id: sender },
            recipient: { id: IG_ACCOUNT_ID },
            timestamp: 1_757_000_000_000,
            message,
          },
        ],
      },
    ],
  });
}

describe("parseDirectMessageEvents", () => {
  it("flattens a text DM into the fields we store", () => {
    const [event] = parseDirectMessageEvents(
      dm({ mid: "aWdfZG1f", text: "Bu urun stokta mi?" }),
    );

    expect(event).toEqual({
      igAccountId: IG_ACCOUNT_ID,
      mid: "aWdfZG1f",
      fromIgUserId: SENDER_ID,
      content: "Bu urun stokta mi?",
      sentAt: new Date(1_757_000_000_000),
    });
  });

  it("reads the timestamp as milliseconds, not seconds", () => {
    const [event] = parseDirectMessageEvents(dm({ mid: "m1", text: "hi" }));

    // The comments webhook sends seconds in entry.time; messaging sends
    // milliseconds. Multiplying here would land in the year 57000.
    expect(event.sentAt.getUTCFullYear()).toBe(2025);
  });

  it("drops a message we sent, marked is_echo", () => {
    const raw = dm({ mid: "m1", text: "our reply", is_echo: true }, IG_ACCOUNT_ID);

    expect(parseDirectMessageEvents(raw)).toEqual([]);
  });

  // Both echo tests used to send from the account id, so the is_echo branch
  // could be deleted with the suite still green. Meta sets is_echo on a
  // message sent through the API by any app on the page, where the sender is
  // the page rather than this account.
  it("drops an is_echo message even when the sender is not the account", () => {
    const raw = dm({ mid: "m1", text: "our reply", is_echo: true }, "55554444");

    expect(parseDirectMessageEvents(raw)).toEqual([]);
  });

  it("drops a message whose sender is the account itself, even without is_echo", () => {
    const raw = dm({ mid: "m1", text: "our reply" }, IG_ACCOUNT_ID);

    expect(parseDirectMessageEvents(raw)).toEqual([]);
  });

  it("stores a placeholder for an attachment-only DM", () => {
    const [event] = parseDirectMessageEvents(
      dm({ mid: "m1", attachments: [{ type: "image", payload: { url: "https://x" } }] }),
    );

    expect(event.content).toBe("[image]");
  });

  it("drops a DM with neither text nor attachments", () => {
    expect(parseDirectMessageEvents(dm({ mid: "m1" }))).toEqual([]);
  });

  it("drops a DM with no mid", () => {
    expect(parseDirectMessageEvents(dm({ text: "hi" }))).toEqual([]);
  });

  it("ignores a comments delivery, which has changes and no messaging", () => {
    const raw = JSON.stringify({
      object: "instagram",
      entry: [
        {
          id: IG_ACCOUNT_ID,
          time: 1_757_000_000,
          changes: [{ field: "comments", value: { id: "c1", text: "hi" } }],
        },
      ],
    });

    expect(parseDirectMessageEvents(raw)).toEqual([]);
  });

  it("returns an empty list rather than throwing on junk", () => {
    expect(parseDirectMessageEvents("not json")).toEqual([]);
    expect(parseDirectMessageEvents("{}")).toEqual([]);
    expect(parseDirectMessageEvents("")).toEqual([]);
  });

  it("returns an empty list rather than throwing when the parsed body is not an object", () => {
    expect(() => parseDirectMessageEvents("null")).not.toThrow();
    expect(parseDirectMessageEvents("null")).toEqual([]);
  });

  it("returns an empty list rather than throwing when an entry is null", () => {
    expect(() => parseDirectMessageEvents('{"entry":[null]}')).not.toThrow();
    expect(parseDirectMessageEvents('{"entry":[null]}')).toEqual([]);
  });

  it("skips a null element in messaging but still returns the valid DM alongside it", () => {
    const raw = JSON.stringify({
      object: "instagram",
      entry: [
        {
          id: IG_ACCOUNT_ID,
          time: 1_757_000_000,
          messaging: [
            null,
            {
              sender: { id: SENDER_ID },
              recipient: { id: IG_ACCOUNT_ID },
              timestamp: 1_757_000_000_000,
              message: { mid: "m1", text: "hi" },
            },
          ],
        },
      ],
    });

    expect(() => parseDirectMessageEvents(raw)).not.toThrow();
    expect(parseDirectMessageEvents(raw)).toEqual([
      {
        igAccountId: IG_ACCOUNT_ID,
        mid: "m1",
        fromIgUserId: SENDER_ID,
        content: "hi",
        sentAt: new Date(1_757_000_000_000),
      },
    ]);
  });

  it("returns an empty list rather than throwing on a null attachment element", () => {
    const raw = dm({ mid: "m1", attachments: [null] });

    expect(() => parseDirectMessageEvents(raw)).not.toThrow();
    expect(parseDirectMessageEvents(raw)).toEqual([]);
  });
});

describe("parseCommentEvents still ignores messaging deliveries", () => {
  it("returns nothing for a DM payload", () => {
    expect(parseCommentEvents(dm({ mid: "m1", text: "hi" }))).toEqual([]);
  });
});
