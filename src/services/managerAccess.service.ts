import bcrypt from 'bcryptjs'
import prisma from '../lib/prisma'
import { AppError } from '../middleware/errorHandler'
import { emailService } from './email.service'

export const MANAGER_TEMP_PASSWORD = 'Manager@123'

export type ManagerSeedInput = {
  name: string
  email: string
  phone?: string | null
  agencyName?: string | null
}

export async function createOrRefreshManagerAccount(input: ManagerSeedInput) {
  const normalizedEmail = input.email.trim().toLowerCase()
  if (!normalizedEmail) throw new AppError('Manager email is required', 400)

  const existingAdmin = await prisma.admin.findUnique({
    where: { email: normalizedEmail },
    select: { id: true },
  })
  if (existingAdmin) {
    throw new AppError('This email is already used by an internal admin account', 409)
  }

  const existingManager = await prisma.manager.findUnique({
    where: { email: normalizedEmail },
  })

  if (existingManager) {
    return {
      manager: await prisma.manager.update({
        where: { id: existingManager.id },
        data: {
          name: input.name.trim(),
          phone: input.phone?.trim() || null,
          agency_name: input.agencyName?.trim() || null,
          is_active: true,
        },
      }),
      created: false,
      temporaryPassword: null as string | null,
    }
  }

  const hashedPassword = await bcrypt.hash(MANAGER_TEMP_PASSWORD, 12)
  const manager = await prisma.manager.create({
    data: {
      name: input.name.trim(),
      email: normalizedEmail,
      password: hashedPassword,
      phone: input.phone?.trim() || null,
      agency_name: input.agencyName?.trim() || null,
      is_active: true,
      must_change_password: true,
    },
  })

  await emailService.sendManagerPortalWelcomeEmail(manager.email, manager.name, MANAGER_TEMP_PASSWORD)

  return {
    manager,
    created: true,
    temporaryPassword: MANAGER_TEMP_PASSWORD,
  }
}

export async function ensureManagerLink(params: {
  celebrityId: string
  managerId: string
  permissions: string[]
  linkedBy?: string | null
  notes?: string | null
}) {
  const existing = await prisma.celebrityManagerLink.findFirst({
    where: {
      celebrity_id: params.celebrityId,
      manager_id: params.managerId,
    },
  })

  if (existing) {
    return prisma.celebrityManagerLink.update({
      where: { id: existing.id },
      data: {
        permissions: params.permissions,
        is_active: true,
        linked_by: params.linkedBy ?? existing.linked_by,
        notes: params.notes ?? null,
      },
      include: {
        manager: { select: { id: true, name: true, email: true, phone: true, agency_name: true, is_active: true } },
        celebrity: { select: { id: true, name: true, thumbnail_url: true, is_active: true } },
      },
    })
  }

  return prisma.celebrityManagerLink.create({
    data: {
      celebrity_id: params.celebrityId,
      manager_id: params.managerId,
      permissions: params.permissions,
      linked_by: params.linkedBy ?? null,
      notes: params.notes ?? null,
      is_active: true,
    },
    include: {
      manager: { select: { id: true, name: true, email: true, phone: true, agency_name: true, is_active: true } },
      celebrity: { select: { id: true, name: true, thumbnail_url: true, is_active: true } },
    },
  })
}
