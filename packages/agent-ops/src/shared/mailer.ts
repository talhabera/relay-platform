import nodemailer from "nodemailer";

// Outgoing mail over SMTP (Purelymail by default). Server-only: import via
// "@relay/agent-ops/shared/mailer", never from the package root, so client
// bundles never pull in nodemailer.

export type MailConfig = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
};

export type OutgoingMail = {
  from?: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
  headers?: Record<string, string>;
};

export type MailTransport = {
  sendMail(message: Record<string, unknown>): Promise<{ messageId?: string }>;
};

/** Null (mail off) unless SMTP_USER and SMTP_PASS are set. */
export function mailConfigFromEnv(env: NodeJS.ProcessEnv = process.env): MailConfig | null {
  const user = env.SMTP_USER?.trim();
  const pass = env.SMTP_PASS?.trim();
  if (!user || !pass) return null;
  const port = Number(env.SMTP_PORT?.trim() || "465");
  return {
    host: env.SMTP_HOST?.trim() || "smtp.purelymail.com",
    port,
    secure: port === 465,
    user,
    pass,
    from: env.MAIL_FROM?.trim() || `Relay <${user}>`,
  };
}

export function createMailTransport(config: MailConfig): MailTransport {
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.pass },
    connectionTimeout: 10_000,
    socketTimeout: 15_000,
  });
}

/** Sends one message. Throws on SMTP failure (the error never includes the password). */
export async function sendMail(
  config: MailConfig,
  message: OutgoingMail,
  transport: MailTransport = createMailTransport(config),
): Promise<{ id: string | null }> {
  const info = await transport.sendMail({
    from: message.from ?? config.from,
    to: message.to,
    subject: message.subject,
    text: message.text,
    html: message.html,
    replyTo: message.replyTo,
    headers: message.headers,
  });
  return { id: info.messageId ?? null };
}
