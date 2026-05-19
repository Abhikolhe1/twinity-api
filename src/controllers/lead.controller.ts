import { Request, Response, NextFunction } from 'express'
import prisma from '../lib/prisma'
import { AppError } from '../middleware/errorHandler'

// Helper: append entry to statusHistory Json array
async function appendLeadStatusHistory(
  leadId: string,
  entry: { status: string; timestamp: string; note?: string; adminId?: string }
): Promise<unknown> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { statusHistory: true } })
  const history = (Array.isArray(lead?.statusHistory) ? lead!.statusHistory : []) as unknown[]
  return [...history, entry]
}

// Public — contact form submission
export async function submitContactForm(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { name, email, phone, company, message, notes, productType, purpose, celebrityName } = req.body as Record<string, string>
    const statusHistory = [{ status: 'new', timestamp: new Date().toISOString() }]
    const lead = await prisma.lead.create({
      data: {
        name,
        email,
        phone,
        company,
        notes:         notes || message || '',
        productType:   productType   || 'contact-form',
        purpose:       purpose       || 'General Inquiry',
        celebrityName: celebrityName || 'N/A',
        source:        'contact_form',
        statusHistory,
      },
    })
    res.status(201).json({ success: true, message: 'Inquiry submitted successfully', data: { id: lead.id } })
  } catch (err) {
    next(err)
  }
}

// Admin — list all leads
export async function adminListLeads(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { status, page = 1, limit = 20 } = req.query
    const where: Record<string, unknown> = {}
    if (status) where.status = status

    const skip = (Number(page) - 1) * Number(limit)
    const [leads, total] = await Promise.all([
      prisma.lead.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: Number(limit),
        include: { videoJob: { select: { referenceId: true, status: true } } },
      }),
      prisma.lead.count({ where }),
    ])

    res.json({ success: true, data: leads, total, page: Number(page), pages: Math.ceil(total / Number(limit)) })
  } catch (err) {
    next(err)
  }
}

// Admin — get single lead
export async function adminGetLead(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const lead = await prisma.lead.findUnique({
      where: { id: req.params.id },
      include: {
        user:     { select: { name: true, email: true } },
        videoJob: { select: { referenceId: true, status: true } },
      },
    })
    if (!lead) throw new AppError('Lead not found', 404)
    res.json({ success: true, data: lead })
  } catch (err) {
    next(err)
  }
}

// Admin — update lead status
export async function adminUpdateLeadStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { status, note, assignedTo, followUpDate } = req.body as {
      status: string; note?: string; assignedTo?: string; followUpDate?: string
    }

    const lead = await prisma.lead.findUnique({ where: { id: req.params.id } })
    if (!lead) throw new AppError('Lead not found', 404)

    const history = await appendLeadStatusHistory(lead.id, { status, timestamp: new Date().toISOString(), note })
    const updateData: Record<string, unknown> = {
      status,
      statusHistory: history as any,
    }
    if (assignedTo) updateData.assignedTo = assignedTo
    if (followUpDate) updateData.followUpDate = new Date(followUpDate)

    const updated = await prisma.lead.update({ where: { id: lead.id }, data: updateData })
    res.json({ success: true, data: updated })
  } catch (err) {
    next(err)
  }
}

// Admin — get stats
export async function adminLeadStats(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const [grouped, total] = await Promise.all([
      prisma.lead.groupBy({
        by: ['status'],
        _count: { status: true },
        _sum: { estimatedValue: true },
      }),
      prisma.lead.count(),
    ])

    const byStatus = grouped.map(g => ({
      _id: g.status,
      count: g._count.status,
      value: g._sum.estimatedValue ?? 0,
    }))

    res.json({ success: true, data: { byStatus, total } })
  } catch (err) {
    next(err)
  }
}
