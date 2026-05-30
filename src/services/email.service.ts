import nodemailer, { Transporter } from 'nodemailer'
import { env } from '../config/env'
import { logger } from '../config/logger'
import type { Lead } from '@prisma/client'

// Loose type for lead notification — accepts Prisma Lead or partial objects passed from other sources
type ILead = Partial<Lead> & { name?: string; email: string; celebrityName?: string; productType?: string; purpose?: string; estimatedValue?: number; phone?: string; company?: string; notes?: string }

// ── Transporter ────────────────────────────────────────────────
let _transporter: Transporter | null = null

const DEFAULT_SMTP_USER = 'user'

function isSmtpConfigured(): boolean {
  return Boolean(env.smtp.user && env.smtp.user !== DEFAULT_SMTP_USER && env.smtp.pass)
}

async function getTransporter(): Promise<Transporter> {
  if (_transporter) return _transporter

  if (!isSmtpConfigured() && env.nodeEnv !== 'production') {
    const testAccount = await nodemailer.createTestAccount()
    _transporter = nodemailer.createTransport({
      host: 'smtp.ethereal.email',
      port: 587,
      secure: false,
      auth: { user: testAccount.user, pass: testAccount.pass },
    })
    logger.info(`[email] Dev mode — Ethereal SMTP ready. View sent emails at https://ethereal.email (user: ${testAccount.user})`)
  } else {
    const port = Number(env.smtp.port) || 587
    const secure = env.smtp.secure || port === 465
    _transporter = nodemailer.createTransport({
      host: env.smtp.host,
      port,
      secure,
      auth: { user: env.smtp.user, pass: env.smtp.pass },
      tls: { rejectUnauthorized: env.nodeEnv === 'production' },
    })
  }
  return _transporter
}

async function send(to: string, subject: string, html: string): Promise<void> {
  try {
    const transport = await getTransporter()
    const info = await transport.sendMail({ from: `Twinity <${env.ses.fromEmail}>`, to, subject, html })
    if (env.nodeEnv !== 'production') {
      const previewUrl = nodemailer.getTestMessageUrl(info)
      if (previewUrl) logger.info(`[email] Preview: ${previewUrl}`)
    }
    logger.info(`Email sent to ${to}: ${subject}`)
  } catch (err) {
    logger.error('Email send failed:', err)
  }
}

// ── Template helpers ────────────────────────────────────────────

const logoUrl = `${env.cors.clientUrl}/logo/logo-white.png`
const iconUrl  = `${env.cors.clientUrl}/logo/icon-white.png`

function layout(title: string, preheader: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta name="color-scheme" content="light" />
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background-color:#F8F5FF;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;-webkit-font-smoothing:antialiased;">
  <!-- preheader (hidden preview text) -->
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${preheader}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>

  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#F8F5FF;">
    <tr>
      <td align="center" style="padding:40px 16px 48px;">

        <!-- ── Outer card ── -->
        <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:580px;">

          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#9a78fe 0%,#6B3FA0 50%,#422266 100%);border-radius:16px 16px 0 0;padding:32px 40px;text-align:center;">
              <table cellpadding="0" cellspacing="0" role="presentation" style="margin:0 auto;">
                <tr>
                  <td style="padding-right:10px;vertical-align:middle;">
                    <img src="${iconUrl}" alt="" width="36" height="36"
                         style="width:36px;height:36px;display:block;border-radius:8px;background:rgba(255,255,255,0.15);" />
                  </td>
                  <td style="vertical-align:middle;">
                    <img src="${logoUrl}" alt="Twinity" height="26"
                         style="height:26px;display:block;" />
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="background:#ffffff;padding:40px;border-left:1px solid rgba(154,120,254,0.14);border-right:1px solid rgba(154,120,254,0.14);">
              ${body}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#F0EBFF;border-radius:0 0 16px 16px;padding:24px 40px;text-align:center;border:1px solid rgba(154,120,254,0.14);border-top:1px solid rgba(154,120,254,0.1);">
              <p style="margin:0 0 6px;color:#8b7aaa;font-size:12px;line-height:1.6;">
                You received this email from Twinity. If you didn&rsquo;t request it, you can safely ignore it.
              </p>
              <p style="margin:0;color:#8b7aaa;font-size:11px;">&copy; 2026 Twinity. All rights reserved.</p>
            </td>
          </tr>

        </table>
        <!-- /Outer card -->

      </td>
    </tr>
  </table>
</body>
</html>`
}

function ctaButton(href: string, label: string): string {
  return `<table cellpadding="0" cellspacing="0" role="presentation" style="margin:28px auto 0;">
    <tr>
      <td style="border-radius:10px;background:linear-gradient(135deg,#9a78fe,#422266);">
        <a href="${href}"
           target="_blank"
           style="display:inline-block;padding:14px 36px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;border-radius:10px;letter-spacing:0.01em;">
          ${label}
        </a>
      </td>
    </tr>
  </table>`
}

function fallbackLink(href: string): string {
  return `<p style="margin:20px 0 0;text-align:center;font-size:12px;color:#8b7aaa;line-height:1.6;">
    Or copy this link into your browser:<br/>
    <a href="${href}" style="color:#9a78fe;word-break:break-all;">${href}</a>
  </p>`
}

function divider(): string {
  return `<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin:28px 0;">
    <tr><td style="height:1px;background:rgba(154,120,254,0.12);font-size:0;line-height:0;">&nbsp;</td></tr>
  </table>`
}

function statPill(value: string, label: string): string {
  return `<td align="center" style="padding:0 8px;">
    <table cellpadding="0" cellspacing="0" role="presentation">
      <tr>
        <td style="background:#F0EBFF;border:1px solid rgba(154,120,254,0.2);border-radius:12px;padding:12px 20px;text-align:center;white-space:nowrap;">
          <p style="margin:0;font-size:20px;font-weight:700;color:#422266;">${value}</p>
          <p style="margin:4px 0 0;font-size:11px;color:#8b7aaa;">${label}</p>
        </td>
      </tr>
    </table>
  </td>`
}

function detailRow(label: string, value: string): string {
  return `<tr>
    <td style="padding:10px 0;border-bottom:1px solid rgba(154,120,254,0.08);color:#8b7aaa;font-size:13px;white-space:nowrap;padding-right:20px;vertical-align:top;">${label}</td>
    <td style="padding:10px 0;border-bottom:1px solid rgba(154,120,254,0.08);color:#1a0a30;font-size:14px;font-weight:500;vertical-align:top;">${value}</td>
  </tr>`
}

function statusBadge(status: string): string {
  const map: Record<string, { bg: string; color: string; label: string }> = {
    pending:     { bg: '#FEF3C7', color: '#92400E', label: 'Pending' },
    'in-progress': { bg: '#EDE9FE', color: '#5B21B6', label: 'In Progress' },
    review:      { bg: '#DBEAFE', color: '#1E40AF', label: 'In Review' },
    delivered:   { bg: '#D1FAE5', color: '#065F46', label: 'Delivered' },
    failed:      { bg: '#FEE2E2', color: '#991B1B', label: 'Failed' },
    cancelled:   { bg: '#F3F4F6', color: '#374151', label: 'Cancelled' },
  }
  const s = map[status] || { bg: '#F0EBFF', color: '#422266', label: status }
  return `<span style="display:inline-block;background:${s.bg};color:${s.color};padding:4px 12px;border-radius:20px;font-size:12px;font-weight:600;">${s.label}</span>`
}

function productTypeLabel(productType: string): string {
  if (productType === 'greeting') return 'Greeting'
  if (productType === 'video-ad' || productType === 'video_ad') return 'Video Ad'
  if (productType === 'image-ad' || productType === 'image_ad') return 'Image Ad'
  return productType.replace(/[-_]/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase())
}

// ── Email service ───────────────────────────────────────────────

export const emailService = {

  async sendVerificationEmail(email: string, name: string, token: string): Promise<void> {
    const link = `${env.cors.clientUrl}/verify-email/${token}`
    const firstName = name.split(' ')[0]
    const body = `
      <h1 style="margin:0 0 6px;font-size:24px;font-weight:700;color:#1a0a30;">Welcome to Twinity!</h1>
      <p style="margin:0 0 24px;font-size:15px;color:#4a3465;line-height:1.6;">
        Hi ${firstName}, your account is almost ready. Verify your email address to unlock the full platform.
      </p>

      <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#F8F5FF;border-radius:12px;padding:20px 24px;margin-bottom:28px;">
        <tr>
          <td style="color:#4a3465;font-size:14px;line-height:1.7;">
            <strong style="color:#1a0a30;">What&rsquo;s next?</strong><br/>
            &bull;&nbsp; Browse 150+ verified celebrities<br/>
            &bull;&nbsp; Create your first AI video in minutes<br/>
            &bull;&nbsp; Track orders from your dashboard
          </td>
        </tr>
      </table>

      <p style="margin:0;text-align:center;font-size:14px;color:#8b7aaa;">Click the button below to verify your email</p>
      ${ctaButton(link, 'Verify Email Address')}
      ${fallbackLink(link)}

      ${divider()}

      <p style="margin:0;text-align:center;font-size:13px;color:#8b7aaa;line-height:1.6;">
        This link expires in <strong style="color:#4a3465;">24 hours</strong>.
      </p>

      ${divider()}

      <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
        <tr>
          ${statPill('150+', 'Celebrities')}
          ${statPill('10K+', 'Videos Made')}
          ${statPill('500+', 'Brands')}
        </tr>
      </table>
    `
    await send(email, 'Verify your Twinity account', layout('Verify your Twinity account', `Welcome ${firstName}! One step left — verify your email to get started.`, body))
  },

  async sendPasswordResetEmail(email: string, name: string, token: string): Promise<void> {
    const link = `${env.cors.clientUrl}/reset-password/${token}`
    const firstName = name.split(' ')[0]
    const body = `
      <h1 style="margin:0 0 6px;font-size:24px;font-weight:700;color:#1a0a30;">Reset your password</h1>
      <p style="margin:0 0 28px;font-size:15px;color:#4a3465;line-height:1.6;">
        Hi ${firstName}, we received a request to reset the password for your Twinity account.
        Click the button below to choose a new password.
      </p>

      ${ctaButton(link, 'Reset Password')}
      ${fallbackLink(link)}

      ${divider()}

      <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
        <tr>
          <td style="background:#FFF7ED;border-left:3px solid #F59E0B;border-radius:0 8px 8px 0;padding:14px 18px;">
            <p style="margin:0;font-size:13px;color:#92400E;line-height:1.6;">
              <strong>Security notice:</strong> This link expires in <strong>1 hour</strong>.
              If you didn&rsquo;t request a password reset, your account is safe — no action is needed.
            </p>
          </td>
        </tr>
      </table>
    `
    await send(email, 'Reset your Twinity password', layout('Reset your Twinity password', 'Reset link inside — expires in 1 hour.', body))
  },

  async sendAdminPasswordResetEmail(email: string, name: string, token: string): Promise<void> {
    const link = `${env.cors.adminUrl}/reset-password/${token}`
    const firstName = name.split(' ')[0]
    const body = `
      <h1 style="margin:0 0 6px;font-size:24px;font-weight:700;color:#1a0a30;">Admin password reset</h1>
      <p style="margin:0 0 28px;font-size:15px;color:#4a3465;line-height:1.6;">
        Hi ${firstName}, a password reset was requested for your Twinity <strong>Admin Panel</strong> account.
        Click the button below to set a new password.
      </p>

      ${ctaButton(link, 'Reset Admin Password')}
      ${fallbackLink(link)}

      ${divider()}

      <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
        <tr>
          <td style="background:#FEF2F2;border-left:3px solid #EF4444;border-radius:0 8px 8px 0;padding:14px 18px;">
            <p style="margin:0;font-size:13px;color:#991B1B;line-height:1.6;">
              <strong>Admin account:</strong> This link expires in <strong>1 hour</strong> and is single-use.
              If you did not request this reset, please contact your super-admin immediately.
            </p>
          </td>
        </tr>
      </table>
    `
    await send(email, 'Reset your Twinity Admin password', layout('Reset your Twinity Admin password', 'Admin reset link inside — expires in 1 hour.', body))
  },

  async sendManagerPasswordResetEmail(email: string, name: string, token: string): Promise<void> {
    const link = `${env.cors.adminUrl}/reset-password/${token}`
    const firstName = name.split(' ')[0]
    const body = `
      <h1 style="margin:0 0 6px;font-size:24px;font-weight:700;color:#1a0a30;">Manager password reset</h1>
      <p style="margin:0 0 28px;font-size:15px;color:#4a3465;line-height:1.6;">
        Hi ${firstName}, a password reset was requested for your Twinity <strong>Manager Portal</strong> account.
        Click the button below to set a new password.
      </p>

      ${ctaButton(link, 'Reset Manager Password')}
      ${fallbackLink(link)}

      ${divider()}

      <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
        <tr>
          <td style="background:#FFF7ED;border-left:3px solid #F59E0B;border-radius:0 8px 8px 0;padding:14px 18px;">
            <p style="margin:0;font-size:13px;color:#92400E;line-height:1.6;">
              <strong>Security notice:</strong> This link expires in <strong>1 hour</strong> and is single-use.
            </p>
          </td>
        </tr>
      </table>
    `
    await send(email, 'Reset your Twinity Manager password', layout('Reset your Twinity Manager password', 'Manager reset link inside — expires in 1 hour.', body))
  },

  async sendCelebrityPortalWelcomeEmail(email: string, name: string, temporaryPassword: string): Promise<void> {
    const loginLink = `${env.cors.adminUrl}/celebrity-login`
    const firstName = name.split(' ')[0]
    const body = `
      <h1 style="margin:0 0 6px;font-size:24px;font-weight:700;color:#1a0a30;">Your Celebrity Portal is ready</h1>
      <p style="margin:0 0 24px;font-size:15px;color:#4a3465;line-height:1.6;">
        Hi ${firstName}, your celebrity onboarding request has been approved. You can now sign in to the Twinity Celebrity Portal using the details below.
      </p>

      <table width="100%" cellpadding="0" cellspacing="0" role="presentation"
             style="background:#F8F5FF;border-radius:12px;padding:4px 20px;margin-bottom:28px;">
        <tbody>
          ${detailRow('Login URL', `<a href="${loginLink}" style="color:#9a78fe;">${loginLink}</a>`)}
          ${detailRow('Email', email)}
          ${detailRow('Temporary Password', `<span style="font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,'Liberation Mono','Courier New',monospace;">${temporaryPassword}</span>`)}
        </tbody>
      </table>

      ${ctaButton(loginLink, 'Open Celebrity Portal')}

      ${divider()}

      <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
        <tr>
          <td style="background:#FFF7ED;border-left:3px solid #F59E0B;border-radius:0 8px 8px 0;padding:14px 18px;">
            <p style="margin:0;font-size:13px;color:#92400E;line-height:1.6;">
              <strong>First sign-in:</strong> After your first login, complete your profile to unlock the full portal.
              If you prefer, you can use <strong>Forgot password</strong> on the sign-in page to set a new password immediately.
            </p>
          </td>
        </tr>
      </table>
    `
    await send(
      email,
      'Your Twinity Celebrity Portal access',
      layout('Your Twinity Celebrity Portal access', 'Your celebrity portal access has been approved.', body),
    )
  },

  async sendManagerPortalWelcomeEmail(email: string, name: string, temporaryPassword: string): Promise<void> {
    const loginLink = `${env.cors.adminUrl}/manager-login`
    const firstName = name.split(' ')[0]
    const body = `
      <h1 style="margin:0 0 6px;font-size:24px;font-weight:700;color:#1a0a30;">Your Manager Portal is ready</h1>
      <p style="margin:0 0 24px;font-size:15px;color:#4a3465;line-height:1.6;">
        Hi ${firstName}, you have been added as a manager in Twinity. You can now sign in and manage the celebrities assigned to you.
      </p>

      <table width="100%" cellpadding="0" cellspacing="0" role="presentation"
             style="background:#F8F5FF;border-radius:12px;padding:4px 20px;margin-bottom:28px;">
        <tbody>
          ${detailRow('Login URL', `<a href="${loginLink}" style="color:#9a78fe;">${loginLink}</a>`)}
          ${detailRow('Email', email)}
          ${detailRow('Temporary Password', `<span style="font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,'Liberation Mono','Courier New',monospace;">${temporaryPassword}</span>`)}
        </tbody>
      </table>

      ${ctaButton(loginLink, 'Open Manager Portal')}

      ${divider()}

      <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
        <tr>
          <td style="background:#FFF7ED;border-left:3px solid #F59E0B;border-radius:0 8px 8px 0;padding:14px 18px;">
            <p style="margin:0;font-size:13px;color:#92400E;line-height:1.6;">
              <strong>First sign-in:</strong> Use the temporary password above and update it right away from the portal recovery flow if needed.
            </p>
          </td>
        </tr>
      </table>
    `
    await send(
      email,
      'Your Twinity Manager Portal access',
      layout('Your Twinity Manager Portal access', 'Your manager portal access has been approved.', body),
    )
  },

  async sendNewLeadNotification(lead: ILead): Promise<void> {
    const adminLink = `${env.cors.adminUrl}/leads`
    const body = `
      <table cellpadding="0" cellspacing="0" role="presentation" style="margin-bottom:24px;">
        <tr>
          <td>
            <span style="display:inline-block;background:linear-gradient(135deg,#9a78fe,#422266);color:#fff;padding:4px 14px;border-radius:20px;font-size:12px;font-weight:600;letter-spacing:0.03em;">
              NEW LEAD
            </span>
          </td>
        </tr>
      </table>

      <h1 style="margin:0 0 4px;font-size:22px;font-weight:700;color:#1a0a30;">${lead.name}</h1>
      <p style="margin:0 0 24px;font-size:14px;color:#8b7aaa;">${lead.company || lead.email}</p>

      <table width="100%" cellpadding="0" cellspacing="0" role="presentation"
             style="background:#F8F5FF;border-radius:12px;padding:4px 20px;margin-bottom:28px;">
        <tbody>
          ${detailRow('Celebrity', lead.celebrityName || '—')}
          ${detailRow('Product', (lead.productType || '').replace(/-/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()))}
          ${detailRow('Purpose', lead.purpose || '—')}
          ${detailRow('Est. Value', `$${(lead.estimatedValue || 0).toLocaleString()}`)}
          ${detailRow('Email', lead.email)}
          ${detailRow('Phone', lead.phone || '—')}
          ${detailRow('Company', lead.company || '—')}
          ${lead.notes ? detailRow('Notes', lead.notes) : ''}
        </tbody>
      </table>

      ${ctaButton(adminLink, 'View Lead in Admin Panel')}
    `
    await send(
      env.ses.adminEmail,
      `New Lead: ${lead.name} — ${lead.celebrityName}`,
      layout('New Sales Lead — Twinity', `${lead.name} is interested in a ${lead.productType} with ${lead.celebrityName}.`, body),
    )
  },

  async sendOtpEmail(email: string, name: string, code: string, purpose: string): Promise<void> {
    const firstName = name.split(' ')[0]
    const body = `
      <h1 style="margin:0 0 6px;font-size:24px;font-weight:700;color:#1a0a30;">Your verification code</h1>
      <p style="margin:0 0 24px;font-size:15px;color:#4a3465;line-height:1.6;">
        Hi ${firstName}, use the code below to ${purpose}.
      </p>

      <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin-bottom:28px;">
        <tr>
          <td align="center">
            <div style="display:inline-block;background:linear-gradient(135deg,#9a78fe,#422266);border-radius:16px;padding:24px 48px;">
              <span style="font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,'Courier New',monospace;font-size:36px;font-weight:700;color:#ffffff;letter-spacing:8px;">${code}</span>
            </div>
          </td>
        </tr>
      </table>

      ${divider()}

      <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
        <tr>
          <td style="background:#FFF7ED;border-left:3px solid #F59E0B;border-radius:0 8px 8px 0;padding:14px 18px;">
            <p style="margin:0;font-size:13px;color:#92400E;line-height:1.6;">
              This code expires in <strong>10 minutes</strong>. Never share it with anyone.
            </p>
          </td>
        </tr>
      </table>
    `
    await send(email, 'Your Twinity verification code', layout('Verification Code — Twinity', `Your verification code is ${code}`, body))
  },

  async sendAccountSuspendedEmail(email: string, name: string, reason?: string): Promise<void> {
    const firstName = name.split(' ')[0]
    const body = `
      <h1 style="margin:0 0 6px;font-size:24px;font-weight:700;color:#1a0a30;">Account suspended</h1>
      <p style="margin:0 0 24px;font-size:15px;color:#4a3465;line-height:1.6;">
        Hi ${firstName}, your Twinity account has been suspended.
        ${reason ? `The reason provided was: <strong>${reason}</strong>` : ''}
      </p>
      <p style="margin:0;font-size:14px;color:#4a3465;line-height:1.6;">
        If you believe this is a mistake, please contact our support team.
      </p>
    `
    await send(email, 'Your Twinity account has been suspended', layout('Account Suspended — Twinity', 'Your account has been suspended.', body))
  },

  async sendJobStatusUpdate(userEmail: string, userName: string, status: string, referenceId: string): Promise<void> {
    const dashLink = `${env.cors.clientUrl}/dashboard`
    const firstName = userName.split(' ')[0]

    const messages: Record<string, { headline: string; detail: string }> = {
      'in-progress': {
        headline: 'Your video is in production',
        detail: 'Our team has started working on your video. We\'ll notify you when it\'s ready for review.',
      },
      review: {
        headline: 'Your video is ready for review',
        detail: 'Great news — your video is complete and ready for your review. Visit your dashboard to watch it.',
      },
      delivered: {
        headline: 'Your video has been delivered',
        detail: 'Your final video is ready to download from your dashboard. Thank you for choosing Twinity!',
      },
      failed: {
        headline: 'There was an issue with your order',
        detail: 'We encountered a problem processing your video order. Our team has been notified and will follow up with you shortly.',
      },
      cancelled: {
        headline: 'Your order has been cancelled',
        detail: 'Your video order has been cancelled. If you have questions, please contact our support team.',
      },
    }

    const msg = messages[status] || { headline: `Order status update`, detail: `Your order status has been updated to: ${status}.` }

    const body = `
      <h1 style="margin:0 0 6px;font-size:24px;font-weight:700;color:#1a0a30;">${msg.headline}</h1>
      <p style="margin:0 0 24px;font-size:15px;color:#4a3465;line-height:1.6;">
        Hi ${firstName}, ${msg.detail}
      </p>

      <table width="100%" cellpadding="0" cellspacing="0" role="presentation"
             style="background:#F8F5FF;border-radius:12px;padding:4px 20px;margin-bottom:28px;">
        <tbody>
          ${detailRow('Order Reference', referenceId)}
          ${detailRow('Status', statusBadge(status))}
        </tbody>
      </table>

      ${ctaButton(dashLink, 'View My Dashboard')}
    `
    await send(
      userEmail,
      `Order ${referenceId} — ${msg.headline}`,
      layout('Order Update — Twinity', msg.headline, body),
    )
  },

  async sendSubmissionConfirmationEmail(params: {
    userEmail: string
    userName: string
    referenceId: string
    productType: string
    purpose: string
    approvalPath?: string | null
    slaHours?: number
    estimatedPrice?: number
    currency?: string
    isResubmission?: boolean
  }): Promise<void> {
    const dashLink = `${env.cors.clientUrl}/studio/requests/${params.referenceId}`
    const firstName = params.userName.split(' ')[0]
    const requestLabel = productTypeLabel(params.productType)
    const submissionLabel = params.isResubmission ? 'request resubmitted' : 'request submitted'
    const approvalPathLabel = params.approvalPath === 'fast_track' ? 'Fast-track review' : 'Full review'
    const slaText = params.slaHours ? `${params.slaHours} hours` : 'our standard review window'
    const estimatedPrice = Number.isFinite(params.estimatedPrice)
      ? `${params.currency || 'SAR'} ${(params.estimatedPrice || 0).toLocaleString()}`
      : 'Pending confirmation'

    const body = `
      <h1 style="margin:0 0 6px;font-size:24px;font-weight:700;color:#1a0a30;">Your ${requestLabel.toLowerCase()} is confirmed</h1>
      <p style="margin:0 0 24px;font-size:15px;color:#4a3465;line-height:1.6;">
        Hi ${firstName}, your ${requestLabel.toLowerCase()} has been ${params.isResubmission ? 'resubmitted' : 'submitted'} successfully.
        We&apos;ve logged everything and routed it to the next review stage.
      </p>

      <table width="100%" cellpadding="0" cellspacing="0" role="presentation"
             style="background:#F8F5FF;border-radius:12px;padding:4px 20px;margin-bottom:28px;">
        <tbody>
          ${detailRow('Reference', params.referenceId)}
          ${detailRow('Request type', requestLabel)}
          ${detailRow('Purpose', params.purpose)}
          ${detailRow('Review route', approvalPathLabel)}
          ${detailRow('Estimated SLA', slaText)}
          ${detailRow('Estimated price', estimatedPrice)}
        </tbody>
      </table>

      ${ctaButton(dashLink, 'View Request Details')}
      ${fallbackLink(dashLink)}

      ${divider()}

      <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
        <tr>
          <td style="background:#F8F5FF;border-left:3px solid #9a78fe;border-radius:0 8px 8px 0;padding:14px 18px;">
            <p style="margin:0;font-size:13px;color:#4a3465;line-height:1.6;">
              <strong>What happens next?</strong> We&apos;ll keep this request updated in your portal and email you again when its status changes.
            </p>
          </td>
        </tr>
      </table>
    `

    await send(
      params.userEmail,
      `${params.referenceId} — ${params.isResubmission ? 'Request resubmitted' : 'Request submitted'}`,
      layout(
        'Submission Confirmation — Twinity',
        `${requestLabel} ${submissionLabel}.`,
        body,
      ),
    )
  },

}
