import bcrypt from 'bcryptjs'
import { NextFunction, Request, Response } from 'express'
import prisma from '../lib/prisma'
import { AdminRequest } from '../middleware/adminAuth'
import { AppError } from '../middleware/errorHandler'
import { emailService } from '../services/email.service'
import { s3Service } from '../services/s3.service'

const CELEBRITY_PORTAL_ROLE = 'celebrity_portal'
const CELEBRITY_PORTAL_PERMISSIONS = [
  'celebrity.profile.view',
  'celebrity.profile.update',
  'celebrity.orders.view',
] as const

function slugify(value: string): string {
  return value.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
}

function makeInitials(name: string): string {
  return name
    .split(' ')
    .map((part) => part[0] ?? '')
    .join('')
    .slice(0, 3)
    .toUpperCase() || 'CE'
}

async function createUniqueSlug(base: string): Promise<string> {
  const seed = slugify(base) || `celebrity-${Date.now()}`
  let slug = seed
  let attempt = 1
  while (await prisma.celebrity.findUnique({ where: { slug } })) {
    attempt += 1
    slug = `${seed}-${attempt}`
  }
  return slug
}

function normalizeList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean)
  }
  if (typeof value === 'string') {
    return value.split(',').map((item) => item.trim()).filter(Boolean)
  }
  return []
}

async function ensureCelebrityPortalRole(createdBy?: string): Promise<string> {
  const existing = await prisma.role.findFirst({
    where: { name: { equals: CELEBRITY_PORTAL_ROLE, mode: 'insensitive' } },
  })
  if (existing) return existing.id

  const role = await prisma.role.create({
    data: {
      name: CELEBRITY_PORTAL_ROLE,
      description: 'Restricted portal access for approved celebrity accounts.',
      permissions: [...CELEBRITY_PORTAL_PERMISSIONS],
      is_system: true,
      created_by: createdBy,
    },
  })
  return role.id
}

const CELEBRITY_TEMP_PASSWORD = 'Celebrity@1234'

function generateTemporaryPassword(): string {
  return CELEBRITY_TEMP_PASSWORD
}

async function createOrRefreshCelebrityPortalAccess(
  celebrity: {
    id: string
    name: string
    contact_email: string | null
  },
  approvedByAdminId: string,
) {
  if (!celebrity.contact_email) throw new AppError('Application email is missing', 400)

  const normalizedEmail = celebrity.contact_email.toLowerCase()
  const roleId = await ensureCelebrityPortalRole(approvedByAdminId)
  const temporaryPassword = generateTemporaryPassword()
  const hashedPassword = await bcrypt.hash(temporaryPassword, 12)

  const [existingAdminByEmail, existingAdminByCelebrity] = await Promise.all([
    prisma.admin.findUnique({
      where: { email: normalizedEmail },
      select: { id: true, celebrity_id: true },
    }),
    prisma.admin.findFirst({
      where: { celebrity_id: celebrity.id },
      select: { id: true, email: true },
    }),
  ])

  if (existingAdminByEmail && existingAdminByEmail.celebrity_id && existingAdminByEmail.celebrity_id !== celebrity.id) {
    throw new AppError('This email is already linked to another celebrity portal account', 409)
  }
  if (existingAdminByEmail && !existingAdminByEmail.celebrity_id) {
    throw new AppError('This email is already used by an internal admin account', 409)
  }

  const admin = existingAdminByCelebrity
    ? await prisma.admin.update({
        where: { id: existingAdminByCelebrity.id },
        data: {
          name: celebrity.name,
          email: normalizedEmail,
          password: hashedPassword,
          role: 'ops',
          role_id: roleId,
          celebrity_id: celebrity.id,
          is_active: true,
          must_change_password: true,
          profile_completed: false,
        },
      })
    : await prisma.admin.upsert({
        where: { email: normalizedEmail },
        update: {
          name: celebrity.name,
          password: hashedPassword,
          role: 'ops',
          role_id: roleId,
          celebrity_id: celebrity.id,
          is_active: true,
          must_change_password: true,
          profile_completed: false,
        },
        create: {
          name: celebrity.name,
          email: normalizedEmail,
          password: hashedPassword,
          role: 'ops',
          role_id: roleId,
          celebrity_id: celebrity.id,
          is_active: true,
          must_change_password: true,
          profile_completed: false,
        },
      })

  const updatedCelebrity = await prisma.celebrity.update({
    where: { id: celebrity.id },
    data: {
      onboarding_status: 'approved',
      is_active: true,
      reviewed_at: new Date(),
      reviewed_by_admin_id: approvedByAdminId,
      review_notes: null,
    },
  })

  await emailService.sendCelebrityPortalWelcomeEmail(
    admin.email,
    admin.name,
    temporaryPassword,
  )

  return {
    admin,
    updatedCelebrity,
    temporaryPassword,
  }
}

function isCelebrityProfileComplete(celebrity: {
  name: string
  name_ar: string
  nationality: string
  nationality_ar: string
  industry: string
  bio: string | null
  thumbnail_url: string | null
}): boolean {
  return Boolean(
    celebrity.name.trim() &&
    celebrity.name_ar.trim() &&
    celebrity.nationality.trim() &&
    celebrity.nationality_ar.trim() &&
    celebrity.industry.trim() &&
    celebrity.bio?.trim() &&
    celebrity.thumbnail_url?.trim()
  )
}

async function requireCelebrityScope(req: AdminRequest) {
  const admin = await prisma.admin.findUnique({
    where: { id: req.adminId },
    select: { celebrity_id: true },
  })
  if (!admin?.celebrity_id) throw new AppError('Celebrity scope not found for this account', 403)
  return admin.celebrity_id
}

export async function submitCelebrityOnboarding(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { name, email, phone, region, nationality, industry, languages, bio } = req.body as Record<string, unknown>

    if (!String(name || '').trim()) throw new AppError('Name is required', 400)
    if (!String(email || '').trim()) throw new AppError('Email is required', 400)
    if (!String(nationality || '').trim()) throw new AppError('Nationality is required', 400)
    if (!String(industry || '').trim()) throw new AppError('Industry is required', 400)

    const normalizedEmail = String(email).trim().toLowerCase()
    const existing = await prisma.celebrity.findFirst({
      where: { contact_email: normalizedEmail },
      select: { id: true },
    })

    if (existing) {
      res.status(202).json({
        success: true,
        message: 'Application received. We will contact you after review.',
      })
      return
    }

    const slug = await createUniqueSlug(String(name))
    await prisma.celebrity.create({
      data: {
        name: String(name).trim(),
        name_ar: String(name).trim(),
        slug,
        industry: String(industry).trim(),
        nationality: String(nationality).trim(),
        nationality_ar: String(nationality).trim(),
        region: String(region || '').trim() || undefined,
        contact_email: normalizedEmail,
        contact_phone: String(phone || '').trim() || undefined,
        languages: normalizeList(languages),
        tags: [],
        tags_ar: [],
        bio: String(bio || '').trim() || undefined,
        initials: makeInitials(String(name)),
        is_active: false,
        onboarding_status: 'pending_review',
      },
    })

    res.status(201).json({
      success: true,
      message: 'Application received. We will contact you after review.',
    })
  } catch (err) {
    next(err)
  }
}

export async function listCelebrityApplications(req: AdminRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { status, search, page = '1', limit = '20' } = req.query
    const where: Record<string, unknown> = {}

    if (status && status !== 'all') where.onboarding_status = status
    if (search) {
      where.OR = [
        { name: { contains: search as string, mode: 'insensitive' } },
        { contact_email: { contains: search as string, mode: 'insensitive' } },
        { industry: { contains: search as string, mode: 'insensitive' } },
      ]
    }

    const pageNum = Math.max(1, parseInt(page as string, 10) || 1)
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string, 10) || 20))
    const skip = (pageNum - 1) * limitNum

    const [data, total] = await Promise.all([
      prisma.celebrity.findMany({
        where,
        orderBy: [{ onboarding_status: 'asc' }, { applied_at: 'desc' }],
        skip,
        take: limitNum,
        select: {
          id: true,
          name: true,
          industry: true,
          nationality: true,
          region: true,
          contact_email: true,
          contact_phone: true,
          languages: true,
          bio: true,
          onboarding_status: true,
          applied_at: true,
          reviewed_at: true,
          review_notes: true,
          is_active: true,
          portal_admin: { select: { id: true, email: true, is_active: true } },
          reviewed_by: { select: { id: true, name: true, email: true } },
        },
      }),
      prisma.celebrity.count({ where }),
    ])

    res.json({
      success: true,
      data,
      total,
      page: pageNum,
      pages: Math.ceil(total / limitNum),
    })
  } catch (err) {
    next(err)
  }
}

export async function approveCelebrityApplication(req: AdminRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    if (req.adminRole !== 'super-admin') throw new AppError('Only super-admin can approve celebrity applications', 403)

    const celebrity = await prisma.celebrity.findUnique({ where: { id: req.params.id } })
    if (!celebrity) throw new AppError('Celebrity application not found', 404)
    const { admin, updatedCelebrity } = await createOrRefreshCelebrityPortalAccess(celebrity, req.adminId!)

    res.json({
      success: true,
      data: { celebrity: updatedCelebrity, admin: { id: admin.id, email: admin.email } },
      message: 'Celebrity application approved and portal credentials sent.',
    })
  } catch (err) {
    next(err)
  }
}

export async function rejectCelebrityApplication(req: AdminRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    if (req.adminRole !== 'super-admin') throw new AppError('Only super-admin can reject celebrity applications', 403)

    const { note } = req.body as { note?: string }
    const celebrity = await prisma.celebrity.findUnique({ where: { id: req.params.id } })
    if (!celebrity) throw new AppError('Celebrity application not found', 404)

    const updated = await prisma.celebrity.update({
      where: { id: celebrity.id },
      data: {
        onboarding_status: 'rejected',
        is_active: false,
        reviewed_at: new Date(),
        reviewed_by_admin_id: req.adminId,
        review_notes: note?.trim() || null,
      },
    })

    res.json({ success: true, data: updated, message: 'Celebrity application rejected.' })
  } catch (err) {
    next(err)
  }
}

export async function createCelebrityPortalAccess(req: AdminRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    if (req.adminRole !== 'super-admin') throw new AppError('Only super-admin can create celebrity portal access', 403)

    const celebrity = await prisma.celebrity.findUnique({ where: { id: req.params.id } })
    if (!celebrity) throw new AppError('Celebrity not found', 404)

    const { admin, updatedCelebrity } = await createOrRefreshCelebrityPortalAccess(celebrity, req.adminId!)

    res.json({
      success: true,
      data: { celebrity: updatedCelebrity, admin: { id: admin.id, email: admin.email } },
      message: 'Celebrity portal access is ready and credentials were sent.',
    })
  } catch (err) {
    next(err)
  }
}

export async function getMyCelebrityProfile(req: AdminRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const celebrityId = await requireCelebrityScope(req)
    const celebrity = await prisma.celebrity.findUnique({ where: { id: celebrityId } })
    if (!celebrity) throw new AppError('Celebrity profile not found', 404)

    res.json({
      success: true,
      data: {
        ...celebrity,
        thumbnail_url: await s3Service.presignIfS3(celebrity.thumbnail_url ?? undefined),
      },
    })
  } catch (err) {
    next(err)
  }
}

export async function updateMyCelebrityProfile(req: AdminRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const celebrityId = await requireCelebrityScope(req)
    const body = req.body as Record<string, unknown>
    const requiredLabels: Array<[keyof typeof body, string]> = [
      ['name', 'Full name'],
      ['name_ar', 'Arabic name'],
      ['industry', 'Industry'],
      ['nationality', 'Nationality'],
      ['nationality_ar', 'Arabic nationality'],
      ['bio', 'Bio'],
      ['thumbnail_url', 'Profile image URL'],
    ]
    for (const [field, label] of requiredLabels) {
      if (field in body && !String(body[field] || '').trim()) {
        throw new AppError(`${label} is required`, 400)
      }
    }
    if ('languages' in body && normalizeList(body.languages).length === 0) {
      throw new AppError('At least one language is required', 400)
    }
    if ('price_range' in body) {
      const priceRange = body.price_range as Record<string, { min?: unknown; max?: unknown }> | null
      const greetingMin = Number(priceRange?.greeting?.min)
      const greetingMax = Number(priceRange?.greeting?.max)
      const videoAdMin = Number(priceRange?.['video-ad']?.min)
      const videoAdMax = Number(priceRange?.['video-ad']?.max)
      if (!Number.isFinite(greetingMin) || greetingMin < 0) throw new AppError('Greeting minimum price is required', 400)
      if (!Number.isFinite(greetingMax) || greetingMax < 0) throw new AppError('Greeting maximum price is required', 400)
      if (greetingMax < greetingMin) throw new AppError('Greeting max price must be greater than or equal to min price', 400)
      if (!Number.isFinite(videoAdMin) || videoAdMin < 0) throw new AppError('Video ad minimum price is required', 400)
      if (!Number.isFinite(videoAdMax) || videoAdMax < 0) throw new AppError('Video ad maximum price is required', 400)
      if (videoAdMax < videoAdMin) throw new AppError('Video ad max price must be greater than or equal to min price', 400)
    }
    const updateData: Record<string, unknown> = {}

    const requiredStringFields = ['name', 'name_ar', 'industry', 'nationality', 'nationality_ar'] as const
    for (const field of requiredStringFields) {
      if (field in body && typeof body[field] === 'string') {
        updateData[field] = body[field].trim()
      }
    }

    const optionalStringFields = ['region', 'bio', 'bio_ar', 'thumbnail_url', 'contact_phone', 'avatar_color'] as const
    for (const field of optionalStringFields) {
      if (field in body) {
        const value = body[field]
        updateData[field] = typeof value === 'string' ? value.trim() || null : value
      }
    }

    if ('languages' in body) updateData.languages = normalizeList(body.languages)
    if ('tags' in body) updateData.tags = normalizeList(body.tags)
    if ('tags_ar' in body) updateData.tags_ar = normalizeList(body.tags_ar)
    if ('price_range' in body) updateData.price_range = body.price_range

    const updated = await prisma.celebrity.update({
      where: { id: celebrityId },
      data: updateData,
    })

    const profileCompleted = isCelebrityProfileComplete(updated)
    await prisma.admin.update({
      where: { id: req.adminId },
      data: { profile_completed: profileCompleted },
    })

    res.json({
      success: true,
      data: {
        ...updated,
        thumbnail_url: await s3Service.presignIfS3(updated.thumbnail_url ?? undefined),
      },
      profileCompleted,
    })
  } catch (err) {
    next(err)
  }
}

export async function listMyCelebrityJobs(req: AdminRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const celebrityId = await requireCelebrityScope(req)
    const { status, page = '1', limit = '12' } = req.query
    const where: Record<string, unknown> = { celebrity_id: celebrityId }
    if (status && status !== 'all') {
      where.status = (status as string) === 'in-progress' ? 'in_progress' : status
    }

    const pageNum = Math.max(1, parseInt(page as string, 10) || 1)
    const limitNum = Math.min(50, Math.max(1, parseInt(limit as string, 10) || 12))
    const skip = (pageNum - 1) * limitNum

    const [data, total] = await Promise.all([
      prisma.videoJob.findMany({
        where,
        include: {
          user: { select: { name: true, email: true } },
          celebrity: { select: { name: true, thumbnail_url: true } },
        },
        orderBy: { created_at: 'desc' },
        skip,
        take: limitNum,
      }),
      prisma.videoJob.count({ where }),
    ])

    const signed = await Promise.all(data.map(async (job) => ({
      ...job,
      celebrity: job.celebrity
        ? {
            ...job.celebrity,
            thumbnail_url: await s3Service.presignIfS3(job.celebrity.thumbnail_url ?? undefined),
          }
        : job.celebrity,
    })))

    res.json({
      success: true,
      data: signed,
      total,
      page: pageNum,
      pages: Math.ceil(total / limitNum),
    })
  } catch (err) {
    next(err)
  }
}
