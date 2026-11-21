import type { LeaseRequest, RateCheck } from "./limiter";

/**
 * Which limits guard which entry point. Each surface returns the rate checks
 * to consume and the concurrency leases to hold for the duration of the work.
 * Policy numbers live in `policies.ts`; this file only arranges them.
 *
 * Subjects are namespaced by the smallest scope that makes them unique, so a
 * visitor IP or a WhatsApp sender id in one company never shares a bucket
 * with the same value in another.
 */
export type SurfaceLimits = {
  rate: RateCheck[];
  leases: LeaseRequest[];
  /** Whose Settings overrides apply. Absent = platform defaults. */
  companyId?: string;
};

export const RATE_LIMIT_SURFACES = {
  // --- Customer sessions -------------------------------------------------

  /** Public widget chat. `visitor` is the trusted client IP. */
  widgetChat: (p: { companyId: string; visitor: string }): SurfaceLimits => {
    const visitor = `${p.companyId}:${p.visitor}`;
    return {
      companyId: p.companyId,
      rate: [
        { policy: "widget.visitor.minute", subject: visitor },
        { policy: "widget.visitor.hour", subject: visitor },
        { policy: "widget.company.minute", subject: p.companyId },
      ],
      leases: [
        { policy: "stream.visitor", subject: visitor },
        { policy: "stream.widget.company", subject: p.companyId },
      ],
    };
  },

  /** Dashboard test chat against a customer agent. */
  customerChat: (p: {
    userId: string;
    companyId?: string;
    chatId?: string;
  }): SurfaceLimits => ({
    companyId: p.companyId,
    rate: [{ policy: "customer.chat.user.minute", subject: p.userId }],
    leases: [
      ...(p.chatId ? [{ policy: "stream.chat" as const, subject: p.chatId }] : []),
      { policy: "stream.user", subject: p.userId },
      ...(p.companyId
        ? [{ policy: "stream.company" as const, subject: p.companyId }]
        : []),
    ],
  }),

  /** Inbound WhatsApp / Instagram DM that would trigger an auto-reply. */
  inboundMessage: (p: {
    channelId: string;
    senderId: string;
    companyId?: string;
  }): SurfaceLimits => {
    const sender = `${p.channelId}:${p.senderId}`;
    return {
      companyId: p.companyId,
      rate: [
        { policy: "inbound.sender.minute", subject: sender },
        { policy: "inbound.sender.hour", subject: sender },
        { policy: "inbound.channel.minute", subject: p.channelId },
      ],
      leases: [],
    };
  },

  /** Instagram comment that would trigger an auto-reply. */
  instagramComment: (p: {
    channelId: string;
    authorId: string;
    companyId?: string;
  }): SurfaceLimits => ({
    companyId: p.companyId,
    rate: [
      { policy: "comment.author.hour", subject: `${p.channelId}:${p.authorId}` },
      { policy: "comment.channel.minute", subject: p.channelId },
    ],
    leases: [],
  }),

  // --- Operator sessions -------------------------------------------------

  operatorChat: (p: {
    userId: string;
    companyId: string;
    chatId: string;
  }): SurfaceLimits => ({
    companyId: p.companyId,
    rate: [
      { policy: "operator.chat.user.minute", subject: p.userId },
      { policy: "operator.chat.user.day", subject: p.userId },
      { policy: "operator.chat.company.minute", subject: p.companyId },
    ],
    leases: [
      { policy: "stream.chat", subject: p.chatId },
      { policy: "stream.user", subject: p.userId },
      { policy: "stream.company", subject: p.companyId },
    ],
  }),

  operatorApproval: (p: { userId: string; companyId?: string }): SurfaceLimits => ({
    companyId: p.companyId,
    rate: [{ policy: "operator.approval.user.minute", subject: p.userId }],
    leases: [],
  }),

  // --- Panel chat (master agent) -----------------------------------------

  masterChat: (p: {
    userId: string;
    companyId: string;
    chatId: string;
  }): SurfaceLimits => ({
    companyId: p.companyId,
    rate: [
      { policy: "master.chat.user.minute", subject: p.userId },
      { policy: "master.chat.user.day", subject: p.userId },
    ],
    leases: [
      { policy: "stream.chat", subject: p.chatId },
      { policy: "stream.user", subject: p.userId },
      { policy: "stream.company", subject: p.companyId },
    ],
  }),

  // --- Cron sessions -----------------------------------------------------

  /** Checked by the cron tick before it creates a run. */
  cronRun: (p: { companyId: string; jobId: string }): SurfaceLimits => ({
    companyId: p.companyId,
    rate: [
      { policy: "cron.run.job.hour", subject: p.jobId },
      { policy: "cron.run.company.hour", subject: p.companyId },
    ],
    leases: [],
  }),

  cronApproval: (p: { userId: string; companyId?: string }): SurfaceLimits => ({
    companyId: p.companyId,
    rate: [{ policy: "cron.approval.user.minute", subject: p.userId }],
    leases: [],
  }),

  // --- Human handoff -----------------------------------------------------
  // Platform limits only: the quick link is public and resolves its company
  // only after the token check.

  /**
   * Any quick-link request. `ip` is the trusted client IP; `link` (the token
   * hash) is passed for writes only, so reading never uses up a link's budget.
   */
  handoffLink: (p: { ip: string; link?: string }): SurfaceLimits => ({
    rate: [
      { policy: "handoff.link.ip.minute", subject: p.ip },
      ...(p.link
        ? [{ policy: "handoff.link.write.minute" as const, subject: p.link }]
        : []),
    ],
    leases: [],
  }),

  /** A client user's Answer now (takeover authored by that user). */
  handoffAnswerNow: (p: { userId: string }): SurfaceLimits => ({
    rate: [{ policy: "handoff.answer_now.user.minute", subject: p.userId }],
    leases: [],
  }),

  // --- Report PDFs (S89, S94) -------------------------------------------

  /** `GET /api/reports/shared/[token]`: public, so per trusted client IP. */
  reportPdfShared: (p: { ip: string }): SurfaceLimits => ({
    rate: [{ policy: "report.pdf.shared.ip.minute", subject: p.ip }],
    leases: [],
  }),

  /** Portal PDF download, per signed-in user. */
  reportPdf: (p: { userId: string }): SurfaceLimits => ({
    rate: [{ policy: "report.pdf.user.minute", subject: p.userId }],
    leases: [],
  }),

  // --- Ad clicks -----------------------------------------------------------

  /**
   * Ad click endpoint. `ipSubject` is the salted day-rotating visitor-IP hash
   * (`ipSubject` in `ad-click.ts`), namespaced by company; the global check
   * counts every click for the company. No leases.
   */
  adClick: (p: { ipSubject: string; companyId: string }): SurfaceLimits => ({
    companyId: p.companyId,
    rate: [
      { policy: "adclick.ip.minute", subject: `${p.companyId}:${p.ipSubject}` },
      { policy: "adclick.global.minute", subject: p.companyId },
    ],
    leases: [],
  }),

  // --- Marketing ---------------------------------------------------------

  /** Request access form submission. `ip` is the trusted client IP. */
  accessRequest: (p: { ip: string }): SurfaceLimits => ({
    rate: [{ policy: "access_request.ip.hour", subject: p.ip }],
    leases: [],
  }),

  // --- Other expensive work ----------------------------------------------
  // Platform limits only: these routes take companyId from the client before
  // any access check, so a company's Settings must not be able to steer them.

  knowledgeIngest: (p: { userId: string }): SurfaceLimits => ({
    rate: [{ policy: "knowledge.ingest.user.hour", subject: p.userId }],
    leases: [],
  }),

  upload: (p: { userId: string }): SurfaceLimits => ({
    rate: [{ policy: "upload.user.minute", subject: p.userId }],
    leases: [],
  }),
} as const;

export type RateLimitSurface = keyof typeof RATE_LIMIT_SURFACES;
