// SPDX-License-Identifier: AGPL-3.0-only
import nodemailer, { type Transporter } from "nodemailer"
import { env } from "./env"
import { childLogger } from "./logger"

const log = childLogger("mailer")

let _transporter: Transporter | null = null

function getTransporter(): Transporter {
  if (_transporter) return _transporter
  _transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth:
      env.SMTP_USER && env.SMTP_PASS
        ? { user: env.SMTP_USER, pass: env.SMTP_PASS }
        : undefined,
  })
  log.info(
    { host: env.SMTP_HOST, port: env.SMTP_PORT, secure: env.SMTP_SECURE },
    "SMTP transport initialisé"
  )
  return _transporter
}

export interface SendMailInput {
  to: string
  subject: string
  text: string
  html?: string
}

export async function sendMail(input: SendMailInput): Promise<void> {
  if (env.NODE_ENV === "test") {
    log.debug({ to: input.to, subject: input.subject }, "mail skippé (test)")
    return
  }
  try {
    const info = await getTransporter().sendMail({
      from: env.SMTP_FROM,
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html,
    })
    log.info(
      { to: input.to, subject: input.subject, messageId: info.messageId },
      "mail envoyé"
    )
  } catch (err) {
    // Never fail a business flow on a mail delivery issue.
    log.warn(
      { err, to: input.to, subject: input.subject },
      "échec envoi mail (non-bloquant)"
    )
  }
}

export function renderWelcomeEmail(displayName: string): {
  subject: string
  text: string
  html: string
} {
  const subject = "Bienvenue sur Ploydok"
  const text = `Bonjour ${displayName},

Ton compte Ploydok est créé et ta passkey est enregistrée. Tu peux te connecter sur ${env.WEB_ORIGIN}/login.

— L'équipe Ploydok`
  const html = renderEmailLayout({
    heading: "Bienvenue sur Ploydok",
    preheader: "Ton compte est prêt — connecte-toi avec ta passkey.",
    bodyHtml: `<p class="pd-text" style="${pStyle()}">Bonjour <strong>${escapeHtml(displayName)}</strong>,</p>
              <p class="pd-text" style="${pStyle()}">Ton compte Ploydok est créé et ta passkey est enregistrée. Tu peux te connecter dès maintenant.</p>
              ${emailButton(`${env.WEB_ORIGIN}/login`, "Se connecter")}
              <p class="pd-muted" style="${pStyle(true)}">Si le bouton ne s'ouvre pas, copie ce lien : <a href="${env.WEB_ORIGIN}/login" style="color:#0071e3;text-decoration:none;">${env.WEB_ORIGIN}/login</a></p>`,
  })
  return { subject, text, html }
}

export function renderInvitationEmail(params: {
  orgName: string
  inviterName: string
  acceptUrl: string
  expiresAt: Date
}): { subject: string; text: string; html: string } {
  const subject = `Tu as été invité à rejoindre ${params.orgName} sur Ploydok`
  const expiresAtStr = params.expiresAt.toLocaleDateString("fr-FR")
  const text = `Bonjour,

${params.inviterName} t'a invité à rejoindre l'organisation "${params.orgName}" sur Ploydok.

Accepter l'invitation : ${params.acceptUrl}

Cette invitation expire le ${expiresAtStr}.

— L'équipe Ploydok`
  const html = renderEmailLayout({
    heading: `Invitation à rejoindre ${escapeHtml(params.orgName)}`,
    preheader: `${escapeHtml(params.inviterName)} t'invite à rejoindre ${escapeHtml(params.orgName)} sur Ploydok.`,
    bodyHtml: `<p class="pd-text" style="${pStyle()}">Bonjour,</p>
              <p class="pd-text" style="${pStyle()}"><strong>${escapeHtml(params.inviterName)}</strong> t'a invité à rejoindre l'organisation <strong>${escapeHtml(params.orgName)}</strong> sur Ploydok.</p>
              ${emailButton(params.acceptUrl, "Accepter l'invitation")}
              <p class="pd-muted" style="${pStyle(true)}">Cette invitation expire le ${escapeHtml(expiresAtStr)}.</p>`,
  })
  return { subject, text, html }
}

const EMAIL_FONT =
  "-apple-system,BlinkMacSystemFont,'SF Pro Display','SF Pro Text','Helvetica Neue',Helvetica,Arial,sans-serif"

// Apple-style pill CTA. `url` is app-generated, `label` is a static literal.
export function emailButton(url: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px auto 4px;">
        <tr>
          <td align="center" bgcolor="#0071e3" style="border-radius:980px;">
            <a href="${url}" style="display:inline-block;padding:14px 34px;font-family:${EMAIL_FONT};font-size:17px;line-height:20px;font-weight:500;color:#ffffff;text-decoration:none;border-radius:980px;">${label}</a>
          </td>
        </tr>
      </table>`
}

interface EmailLayoutInput {
  heading: string
  // Hidden inbox-preview line (already escaped / plain text).
  preheader: string
  // Inner content: paragraphs, buttons, notes — composed by the caller.
  bodyHtml: string
}

// Apple-themed responsive email shell (light + dark). Inline styles carry the
// light theme for clients that strip <style>; the <style> block layers dark
// mode + mobile as progressive enhancement.
export function renderEmailLayout({
  heading,
  preheader,
  bodyHtml,
}: EmailLayoutInput): string {
  return `<!DOCTYPE html>
<html lang="fr" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta name="color-scheme" content="light" />
  <meta name="supported-color-schemes" content="light" />
  <title>${heading}</title>
  <style>
    :root{color-scheme:light;supported-color-schemes:light;}
    body{margin:0;padding:0;width:100%!important;background:#f5f5f7;-webkit-text-size-adjust:100%;color-scheme:light;}
    a{text-decoration:none;}
    img{border:0;line-height:100%;outline:none;}
    @media (max-width:600px){
      .pd-container{width:100%!important;}
      .pd-pad{padding-left:24px!important;padding-right:24px!important;}
      .pd-title{font-size:26px!important;line-height:32px!important;}
    }
  </style>
</head>
<body class="pd-bg" style="margin:0;padding:0;background:#f5f5f7;color-scheme:light;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${preheader}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="pd-bg" style="background:#f5f5f7;">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" class="pd-container" style="width:600px;max-width:600px;">
          <tr>
            <td align="center" style="padding-bottom:26px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
                <td style="vertical-align:middle;">
                  <div class="pd-logo" style="width:34px;height:34px;border-radius:9px;background:#1d1d1f;color:#ffffff;font-family:${EMAIL_FONT};font-size:18px;font-weight:700;line-height:34px;text-align:center;">P</div>
                </td>
                <td style="vertical-align:middle;padding-left:10px;">
                  <span class="pd-brand" style="font-family:${EMAIL_FONT};font-size:17px;font-weight:600;letter-spacing:-0.01em;color:#6e6e73;">Ploydok</span>
                </td>
              </tr></table>
            </td>
          </tr>
          <tr>
            <td class="pd-card pd-pad" style="background:#ffffff;border:1px solid #d2d2d7;border-radius:18px;padding:44px 48px;">
              <h1 class="pd-title" style="margin:0 0 20px;font-family:${EMAIL_FONT};font-size:30px;line-height:36px;font-weight:600;letter-spacing:-0.02em;color:#1d1d1f;">${heading}</h1>
              ${bodyHtml}
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:26px 24px 0;">
              <p class="pd-footer" style="margin:0;font-family:${EMAIL_FONT};font-size:12px;line-height:18px;color:#86868b;">
                Ploydok — self-hosted PaaS<br />
                Tu reçois cet email suite à une action sur ton instance.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

function pStyle(muted = false): string {
  return `margin:0 0 16px;font-family:${EMAIL_FONT};font-size:17px;line-height:26px;color:${muted ? "#6e6e73" : "#1d1d1f"};`
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}
