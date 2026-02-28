import nodemailer from 'nodemailer'
import { env } from '../config/env'
import { logger } from '../config/logger'
import { ILead } from '../models/Lead'

// In production replace with AWS SES transport:
// import aws from 'aws-sdk'
// const ses = new aws.SES({ region: env.aws.region })
// transporter = nodemailer.createTransport({ SES: { ses, aws } })

const transporter = nodemailer.createTransport({
  host: 'smtp.ethereal.email', // Replace with SES SMTP in production
  port: 587,
  secure: false,
  auth: { user: 'ethereal_user', pass: 'ethereal_pass' },
})

async function send(to: string, subject: string, html: string): Promise<void> {
  try {
    await transporter.sendMail({ from: env.ses.fromEmail, to, subject, html })
    logger.info(`Email sent to ${to}: ${subject}`)
  } catch (err) {
    logger.error('Email send failed:', err)
  }
}

export const emailService = {
  async sendVerificationEmail(email: string, name: string, token: string): Promise<void> {
    const link = `${env.cors.clientUrl}/verify-email/${token}`
    await send(email, 'Verify your Twinity account', `
      <h2>Welcome to Twinity, ${name}!</h2>
      <p>Please verify your email address by clicking the link below:</p>
      <a href="${link}" style="background:#9a78fe;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;">
        Verify Email
      </a>
      <p>This link expires in 24 hours.</p>
    `)
  },

  async sendPasswordResetEmail(email: string, name: string, token: string): Promise<void> {
    const link = `${env.cors.clientUrl}/reset-password/${token}`
    await send(email, 'Reset your Twinity password', `
      <h2>Hi ${name},</h2>
      <p>You requested a password reset. Click the link below to set a new password:</p>
      <a href="${link}" style="background:#9a78fe;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;">
        Reset Password
      </a>
      <p>This link expires in 1 hour. If you didn't request this, please ignore this email.</p>
    `)
  },

  async sendNewLeadNotification(lead: ILead): Promise<void> {
    await send(env.ses.adminEmail, `New Sales Lead: ${lead.name} — ${lead.celebrityName}`, `
      <h2>New Sales Inquiry</h2>
      <table>
        <tr><td><b>Name:</b></td><td>${lead.name}</td></tr>
        <tr><td><b>Email:</b></td><td>${lead.email}</td></tr>
        <tr><td><b>Phone:</b></td><td>${lead.phone || '—'}</td></tr>
        <tr><td><b>Company:</b></td><td>${lead.company || '—'}</td></tr>
        <tr><td><b>Celebrity:</b></td><td>${lead.celebrityName}</td></tr>
        <tr><td><b>Product:</b></td><td>${lead.productType}</td></tr>
        <tr><td><b>Est. Value:</b></td><td>$${lead.estimatedValue}</td></tr>
        <tr><td><b>Notes:</b></td><td>${lead.notes || '—'}</td></tr>
      </table>
      <br>
      <a href="${env.cors.adminUrl}/leads" style="background:#9a78fe;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;">
        View in Admin Panel
      </a>
    `)
  },

  async sendAdminPasswordResetEmail(email: string, name: string, token: string): Promise<void> {
    const link = `${env.cors.adminUrl}/reset-password/${token}`
    await send(email, 'Reset your Twinity Admin password', `
      <h2>Hi ${name},</h2>
      <p>You requested a password reset for your Twinity Admin account. Click the link below to set a new password:</p>
      <a href="${link}" style="background:#9a78fe;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;">
        Reset Admin Password
      </a>
      <p>This link expires in 1 hour. If you didn't request this, please ignore this email.</p>
    `)
  },

  async sendJobStatusUpdate(userId: string, status: string, referenceId: string): Promise<void> {
    // In production: look up user email and send appropriate message
    logger.info(`Status update email queued for user ${userId}: Job ${referenceId} → ${status}`)
  },
}
