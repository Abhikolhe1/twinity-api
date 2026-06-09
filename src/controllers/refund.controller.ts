import { NextFunction, Request, Response } from 'express'

import prisma from '../lib/prisma'
import { AuthRequest } from '../middleware/auth'
import { AdminRequest } from '../middleware/adminAuth'
import { AppError } from '../middleware/errorHandler'
import { refundService } from '../services/refund.service'

export async function requestRefund(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.userId) throw new AppError('Authentication required', 401)
    const refund = await refundService.requestRefund(
      req.userId,
      req.params.referenceId,
      req.body?.reason,
    )
    res.status(201).json({ success: true, data: refund, message: 'Refund request submitted' })
  } catch (err) {
    next(err)
  }
}

export async function listRefundRequests(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const status = typeof req.query.status === 'string' ? req.query.status : 'all'
    const search = typeof req.query.search === 'string' ? req.query.search : ''
    const data = await refundService.listRefunds({ status: status as any, search })
    res.json({ success: true, data, total: data.length })
  } catch (err) {
    next(err)
  }
}

export async function getRefundRequest(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = await refundService.getRefund(req.params.id)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
}

export async function approveRefundRequest(req: AdminRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.adminId) throw new AppError('Admin authentication required', 401)

    const admin = await prisma.admin.findUnique({
      where: { id: req.adminId },
      select: { name: true },
    })
    if (!admin) throw new AppError('Admin not found', 404)

    const data = await refundService.approveRefund({
      refundId: req.params.id,
      adminId: req.adminId,
      adminName: admin.name,
      approvedAmount: req.body?.approvedAmount != null ? Number(req.body.approvedAmount) : undefined,
      note: req.body?.note,
    })
    res.json({ success: true, data, message: 'Refund request approved' })
  } catch (err) {
    next(err)
  }
}

export async function rejectRefundRequest(req: AdminRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.adminId) throw new AppError('Admin authentication required', 401)

    const admin = await prisma.admin.findUnique({
      where: { id: req.adminId },
      select: { name: true },
    })
    if (!admin) throw new AppError('Admin not found', 404)

    const data = await refundService.rejectRefund({
      refundId: req.params.id,
      adminId: req.adminId,
      adminName: admin.name,
      note: req.body?.note,
    })
    res.json({ success: true, data, message: 'Refund request rejected' })
  } catch (err) {
    next(err)
  }
}

export async function processRefundRequest(req: AdminRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.adminId) throw new AppError('Admin authentication required', 401)

    const admin = await prisma.admin.findUnique({
      where: { id: req.adminId },
      select: { name: true },
    })
    if (!admin) throw new AppError('Admin not found', 404)

    const data = await refundService.processRefund({
      refundId: req.params.id,
      adminId: req.adminId,
      adminName: admin.name,
      paymentGateway: req.body?.paymentGateway,
      paymentReference: req.body?.paymentReference,
      note: req.body?.note,
    })
    res.json({ success: true, data, message: 'Refund marked as processed' })
  } catch (err) {
    next(err)
  }
}
