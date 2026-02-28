import { Response, NextFunction } from 'express'
import { Role } from '../models/Role'
import { Admin } from '../models/Admin'
import { AdminRequest } from '../middleware/adminAuth'
import { AppError } from '../middleware/errorHandler'

export async function listRoles(req: AdminRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const roles = await Role.find()
      .populate('createdBy', 'name email')
      .sort({ isSystem: -1, createdAt: -1 })

    const roleIds = roles.map(r => r._id)
    const memberCounts = await Admin.aggregate([
      { $match: { roleId: { $in: roleIds } } },
      { $group: { _id: '$roleId', count: { $sum: 1 } } },
    ])
    const countMap = Object.fromEntries(memberCounts.map(m => [String(m._id), m.count]))

    const data = roles.map(r => ({
      ...r.toObject(),
      memberCount: countMap[String(r._id)] ?? 0,
    }))

    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
}

export async function createRole(req: AdminRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { name, description, permissions } = req.body
    if (!name) throw new AppError('Role name is required', 400)

    const existing = await Role.findOne({ name: { $regex: `^${name}$`, $options: 'i' } })
    if (existing) throw new AppError('A role with this name already exists', 400)

    const role = await Role.create({
      name,
      description: description || '',
      permissions: permissions || [],
      createdBy: req.adminId,
    })

    res.status(201).json({ success: true, data: role })
  } catch (err) {
    next(err)
  }
}

export async function updateRole(req: AdminRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const role = await Role.findById(req.params.id)
    if (!role) throw new AppError('Role not found', 404)
    if (role.isSystem) throw new AppError('System roles cannot be modified', 400)

    const { name, description, permissions } = req.body
    if (name) role.name = name
    if (description !== undefined) role.description = description
    if (Array.isArray(permissions)) role.permissions = permissions

    await role.save()
    res.json({ success: true, data: role })
  } catch (err) {
    next(err)
  }
}

export async function deleteRole(req: AdminRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const role = await Role.findById(req.params.id)
    if (!role) throw new AppError('Role not found', 404)
    if (role.isSystem) throw new AppError('System roles cannot be deleted', 400)

    const count = await Admin.countDocuments({ roleId: req.params.id })
    if (count > 0) {
      throw new AppError(`${count} team member(s) are assigned this role. Reassign them first.`, 400)
    }

    await role.deleteOne()
    res.json({ success: true, message: 'Role deleted' })
  } catch (err) {
    next(err)
  }
}
