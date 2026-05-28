import { Request, Response, NextFunction } from 'express'
import prisma from '../lib/prisma'
import { AppError } from '../middleware/errorHandler'

async function appendLeadStatusHistory(
  leadId: string,
  entry: { status: string; timestamp: string; note?: string; adminId?: string }
): Promise<unknown> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { status_history: true } })
  const history = (Array.isArray(lead?.status_history) ? lead!.status_history : []) as unknown[]
  return [...history, entry]
}

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
        notes:          notes || message || '',
        product_type:   productType   || 'contact-form',
        purpose:        purpose       || 'General Inquiry',
        celebrity_name: celebrityName || 'N/A',
        source:         'contact_form',
        status_history: statusHistory,
      },
    })
    res.status(201).json({ success: true, message: 'Inquiry submitted successfully', data: { id: lead.id } })
  } catch (err) {
    next(err)
  }
}

export async function adminListLeads(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { status, page = 1, limit = 20 } = req.query
    const where: Record<string, unknown> = {}
    if (status) where.status = status

    const skip = (Number(page) - 1) * Number(limit)
    const [leads, total] = await Promise.all([
      prisma.lead.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip,
        take: Number(limit),
        include: { video_job: { select: { reference_id: true, status: true } } },
      }),
      prisma.lead.count({ where }),
    ])

    res.json({ success: true, data: leads, total, page: Number(page), pages: Math.ceil(total / Number(limit)) })
  } catch (err) {
    next(err)
  }
}

export async function adminGetLead(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const lead = await prisma.lead.findUnique({
      where: { id: req.params.id },
      include: {
        user:      { select: { name: true, email: true } },
        video_job: { select: { reference_id: true, status: true } },
      },
    })
    if (!lead) throw new AppError('Lead not found', 404)
    res.json({ success: true, data: lead })
  } catch (err) {
    next(err)
  }
}

export async function adminUpdateLeadStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { status, note, assignedTo, assigned_to, followUpDate, follow_up_date } = req.body as {
      status: string; note?: string
      assignedTo?: string; assigned_to?: string
      followUpDate?: string; follow_up_date?: string
    }

    const lead = await prisma.lead.findUnique({ where: { id: req.params.id } })
    if (!lead) throw new AppError('Lead not found', 404)

    const history = await appendLeadStatusHistory(lead.id, { status, timestamp: new Date().toISOString(), note })
    const updateData: Record<string, unknown> = {
      status,
      status_history: history as any,
    }
    const assignee   = assigned_to  ?? assignedTo
    const followDate = follow_up_date ?? followUpDate
    if (assignee)   updateData.assigned_to  = assignee
    if (followDate) updateData.follow_up_date = new Date(followDate)

    const updated = await prisma.lead.update({ where: { id: lead.id }, data: updateData })
    res.json({ success: true, data: updated })
  } catch (err) {
    next(err)
  }
}

export async function adminLeadStats(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const [grouped, total] = await Promise.all([
      prisma.lead.groupBy({
        by: ['status'],
        _count: { status: true },
        _sum:   { estimated_value: true },
      }),
      prisma.lead.count(),
    ])

    const byStatus = grouped.map(g => ({
      _id:   g.status,
      count: g._count.status,
      value: g._sum.estimated_value ?? 0,
    }))

    res.json({ success: true, data: { byStatus, total } })
  } catch (err) {
    next(err)
  }
}
