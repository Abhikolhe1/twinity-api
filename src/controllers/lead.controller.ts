import { Request, Response, NextFunction } from 'express'
import { Lead, LeadStatus } from '../models/Lead'
import { AppError } from '../middleware/errorHandler'

// Public — contact form submission
export async function submitContactForm(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { name, email, phone, company, message, notes, productType, purpose, celebrityName } = req.body as Record<string, string>
    const lead = await Lead.create({
      name,
      email,
      phone,
      company,
      notes:         notes || message || '',
      productType:   productType   || 'contact-form',
      purpose:       purpose       || 'General Inquiry',
      celebrityName: celebrityName || 'N/A',
      source: 'contact-form',
      statusHistory: [{ status: 'new', timestamp: new Date() }],
    })
    res.status(201).json({ success: true, message: 'Inquiry submitted successfully', data: { id: lead._id } })
  } catch (err) {
    next(err)
  }
}

// Admin — list all leads
export async function adminListLeads(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { status, page = 1, limit = 20 } = req.query
    const filter: Record<string, unknown> = {}
    if (status) filter.status = status

    const skip = (Number(page) - 1) * Number(limit)
    const [leads, total] = await Promise.all([
      Lead.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)).populate('videoJobId', 'referenceId status'),
      Lead.countDocuments(filter),
    ])

    res.json({ success: true, data: leads, total, page: Number(page), pages: Math.ceil(total / Number(limit)) })
  } catch (err) {
    next(err)
  }
}

// Admin — get single lead
export async function adminGetLead(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const lead = await Lead.findById(req.params.id).populate('userId', 'name email').populate('videoJobId', 'referenceId status')
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
      status: LeadStatus; note?: string; assignedTo?: string; followUpDate?: string
    }

    const lead = await Lead.findById(req.params.id)
    if (!lead) throw new AppError('Lead not found', 404)

    lead.status = status
    lead.statusHistory.push({ status, timestamp: new Date(), note })
    if (assignedTo) lead.assignedTo = assignedTo
    if (followUpDate) lead.followUpDate = new Date(followUpDate)
    await lead.save()

    res.json({ success: true, data: lead })
  } catch (err) {
    next(err)
  }
}

// Admin — get stats
export async function adminLeadStats(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const stats = await Lead.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 }, value: { $sum: '$estimatedValue' } } },
    ])
    const total = await Lead.countDocuments()
    res.json({ success: true, data: { byStatus: stats, total } })
  } catch (err) {
    next(err)
  }
}
