import nodemailer from 'nodemailer';

/**
 * SMTP sender: works unauthenticated against a local catcher (Mailpit/MailHog,
 * the `local`/`dev` compose profiles) and — once SMTP_USER/SMTP_PASSWORD are
 * set — against a real relay too (nodemailer negotiates STARTTLS/AUTH itself;
 * set SMTP_SECURE=true for implicit-TLS relays, typically port 465).
 * All sends should stay fire-and-forget from request handlers so a
 * misconfigured or unreachable relay never breaks the API.
 */

export interface MailOptions {
  to: string;
  subject: string;
  text: string;
  from?: string;
}

export interface SmtpConfig {
  host: string;
  port: number;
  from: string;
  secure: boolean;
  auth?: { user: string; pass: string };
}

export function smtpConfig(): SmtpConfig {
  // `||`, not `??`: compose passes unset vars through as empty strings
  // (`${SMTP_HOST:-}`), which are defined-but-falsy, not null/undefined.
  const user = process.env.SMTP_USER || undefined;
  const pass = process.env.SMTP_PASSWORD || undefined;
  return {
    host: process.env.SMTP_HOST || 'localhost',
    port: Number(process.env.SMTP_PORT) || 1025,
    from: process.env.SMTP_FROM || 'worktime@localhost',
    secure: process.env.SMTP_SECURE === 'true',
    auth: user && pass ? { user, pass } : undefined,
  };
}

export async function sendMail(options: MailOptions, timeoutMs = 5000): Promise<void> {
  const config = smtpConfig();
  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.auth,
    connectionTimeout: timeoutMs,
    greetingTimeout: timeoutMs,
    socketTimeout: timeoutMs,
    // Local catchers rarely present a real cert; only demand one once real credentials are in play.
    tls: { rejectUnauthorized: !!config.auth },
  });
  try {
    await transport.sendMail({
      from: options.from ?? config.from,
      to: options.to,
      subject: options.subject,
      text: options.text,
      // Every message here is plain ASCII — keep the wire format simple/predictable
      // instead of nodemailer's auto quoted-printable/base64 detection.
      textEncoding: '7bit',
    });
  } finally {
    transport.close();
  }
}
