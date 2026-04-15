// SPDX-License-Identifier: AGPL-3.0-only
import nodemailer, { type Transporter } from "nodemailer";
import { env } from "./env";
import { childLogger } from "./logger";

const log = childLogger("mailer");

let _transporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (_transporter) return _transporter;
  _transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth:
      env.SMTP_USER && env.SMTP_PASS
        ? { user: env.SMTP_USER, pass: env.SMTP_PASS }
        : undefined,
  });
  log.info(
    { host: env.SMTP_HOST, port: env.SMTP_PORT, secure: env.SMTP_SECURE },
    "SMTP transport initialisé",
  );
  return _transporter;
}

export interface SendMailInput {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export async function sendMail(input: SendMailInput): Promise<void> {
  if (env.NODE_ENV === "test") {
    log.debug({ to: input.to, subject: input.subject }, "mail skippé (test)");
    return;
  }
  try {
    const info = await getTransporter().sendMail({
      from: env.SMTP_FROM,
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html,
    });
    log.info({ to: input.to, subject: input.subject, messageId: info.messageId }, "mail envoyé");
  } catch (err) {
    // Never fail a business flow on a mail delivery issue.
    log.warn({ err, to: input.to, subject: input.subject }, "échec envoi mail (non-bloquant)");
  }
}

export function renderWelcomeEmail(displayName: string): { subject: string; text: string; html: string } {
  const subject = "Bienvenue sur Ploydok";
  const text = `Bonjour ${displayName},

Ton compte Ploydok est créé et ta passkey est enregistrée. Tu peux te connecter sur ${env.WEB_ORIGIN}/login.

— L'équipe Ploydok`;
  const html = `<p>Bonjour <strong>${escapeHtml(displayName)}</strong>,</p>
<p>Ton compte Ploydok est créé et ta passkey est enregistrée. Tu peux te connecter sur <a href="${env.WEB_ORIGIN}/login">${env.WEB_ORIGIN}/login</a>.</p>
<p>— L'équipe Ploydok</p>`;
  return { subject, text, html };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
