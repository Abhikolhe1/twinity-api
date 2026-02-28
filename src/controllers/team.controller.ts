import { Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { Admin } from '../models/Admin'
import { Role } from '../models/Role'
import { AdminRequest } from '../middleware/adminAuth'
import { AppError } from '../middleware/errorHandler'
import { env } from '../config/env'

export async function listTeamMembers(req: AdminRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const members = await Admin.find({ _id: { $ne: req.adminId }, role: { $ne: 'super-admin' } })
      .populate('roleId', 'name permissions')
      .select('-password')
      .sort({ createdAt: -1 })

    res.json({ success: true, data: members })
  } catch (err) {
    next(err)
  }
}

export async function getTeamMember(req: AdminRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const member = await Admin.findById(req.params.id)
      .populate('roleId', 'name permissions')
      .select('-password')
    if (!member) throw new AppError('Team member not found', 404)
    res.json({ success: true, data: member })
  } catch (err) {
    next(err)
  }
}

export async function createTeamMember(req: AdminRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { name, email, password, roleId } = req.body
    if (!name || !email || !password) throw new AppError('Name, email and password are required', 400)
    if (password.length < 8) throw new AppError('Password must be at least 8 characters', 400)

    const existing = await Admin.findOne({ email: email.toLowerCase() })
    if (existing) throw new AppError('An account with this email already exists', 400)

    if (roleId) {
      const role = await Role.findById(roleId)
      if (!role) throw new AppError('Role not found', 404)
    }

    const member = await Admin.create({
      name,
      email,
      password,
      roleId: roleId || undefined,
      role: 'ops',
      isActive: true,
    })

    const populated = await Admin.findById(member._id)
      .populate('roleId', 'name permissions')
      .select('-password')

    res.status(201).json({ success: true, data: populated })
  } catch (err) {
    next(err)
  }
}

export async function updateTeamMember(req: AdminRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { name, roleId, isActive } = req.body

    if (roleId) {
      const role = await Role.findById(roleId)
      if (!role) throw new AppError('Role not found', 404)
    }

    const member = await Admin.findByIdAndUpdate(
      req.params.id,
      { ...(name && { name }), ...(roleId !== undefined && { roleId }), ...(isActive !== undefined && { isActive }) },
      { new: true }
    )
      .populate('roleId', 'name permissions')
      .select('-password')

    if (!member) throw new AppError('Team member not found', 404)
    res.json({ success: true, data: member })
  } catch (err) {
    next(err)
  }
}

export async function deleteTeamMember(req: AdminRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const member = await Admin.findById(req.params.id)
    if (!member) throw new AppError('Team member not found', 404)
    if (String(member._id) === req.adminId) throw new AppError('You cannot delete your own account', 400)

    await member.deleteOne()
    res.json({ success: true, message: 'Team member removed' })
  } catch (err) {
    next(err)
  }
}

export async function getMe(req: AdminRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const admin = await Admin.findById(req.adminId)
      .populate('roleId', 'name permissions')
      .select('-password')
    if (!admin) throw new AppError('Admin not found', 404)
    res.json({ success: true, data: admin, permissions: req.adminPermissions })
  } catch (err) {
    next(err)
  }
}
