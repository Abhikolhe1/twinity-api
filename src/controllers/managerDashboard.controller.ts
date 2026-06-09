import { Response, NextFunction } from 'express'
import { VideoJobStatus } from '@prisma/client'
import prisma from '../lib/prisma'
import { AppError } from '../middleware/errorHandler'
import { ManagerRequest } from '../middleware/managerAuth'
import { auditLogService } from '../services/auditLog.service'
import { s3Service } from '../services/s3.service'
import { emailService } from '../services/email.service'
import { ensureManagerLink } from '../services/managerAccess.service'
import {
  applyCelebrityProfileUpdate,
  getCelebrityProfileBundle,
  isCelebrityProfileComplete,
  presignApprovedMediaUrls,
} from './celebrityOnboarding.controller'

type ManagedCelebrity = {
  id: string
  name: string
  industry: string
  is_active: boolean
  onboarding_status: string
  total_orders: number
  thumbnail_url: string | null
  approval_preferences: unknown
  preapproved_template_ids: string[]
}

const DEFAULT_MANAGER_LINK_PERMISSIONS = [
  'approve_requests',
  'manage_templates',
  'edit_pricing',
  'view_earnings',
  'manage_profile',
]

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function slugifyDraft(value: string): string {
  return value.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
}

async function createUniqueManagerCelebritySlug(base: string): Promise<string> {
  const seed = slugifyDraft(base) || `celebrity-${Date.now()}`
  let slug = seed
  let suffix = 1
  while (await prisma.celebrity.findUnique({ where: { slug } })) {
    suffix += 1
    slug = `${seed}-${suffix}`
  }
  return slug
}

async function requireManagedCelebrity(managerId: string, celebrityId: string) {
  const link = await prisma.celebrityManagerLink.findFirst({
    where: {
      manager_id: managerId,
      celebrity_id: celebrityId,
      is_active: true,
    },
    include: {
      celebrity: true,
    },
  })

  if (!link?.celebrity) throw new AppError('This celebrity is not linked to your manager account', 403)
  return link.celebrity
}

type ManagedJob = {
  id: string
  reference_id: string
  celebrity_id: string
  product_type: string
  purpose: string
  status: string
  approval_path: string | null
  estimated_price: number
  currency: string
  created_at: Date
  updated_at: Date
  delivered_at: Date | null
  celebrity?: {
    id: string
    name: string
    thumbnail_url: string | null
  }
  user?: {
    id: string
    name: string
    email: string
    company: string | null
  }
}

function readSlaHours(approvalPreferences: unknown, productType?: string): number {
  const input = approvalPreferences && typeof approvalPreferences === 'object'
    ? approvalPreferences as Record<string, unknown>
    : {}
  const explicit = Number(input.slaHours)
  if (Number.isFinite(explicit) && explicit > 0) return explicit

  if (productType === 'greeting') return 24
  if (productType === 'image-ad' || productType === 'image_ad') return 48
  return 72
}

function computeSlaState(createdAt: Date, slaHours: number, status: string): 'on_track' | 'due_soon' | 'breached' | 'completed' {
  if (['delivered', 'cancelled', 'failed'].includes(status)) return 'completed'

  const dueAt = createdAt.getTime() + slaHours * 60 * 60 * 1000
  const now = Date.now()
  if (now >= dueAt) return 'breached'

  const remainingHours = (dueAt - now) / (60 * 60 * 1000)
  if (remainingHours <= 12) return 'due_soon'
  return 'on_track'
}

function jobMatchesSearch(job: ManagedJob, search: string): boolean {
  const q = search.trim().toLowerCase()
  if (!q) return true
  return [
    job.reference_id,
    job.purpose,
    job.product_type,
    job.user?.name,
    job.user?.email,
    job.user?.company ?? '',
    job.celebrity?.name,
  ].some((value) => String(value || '').toLowerCase().includes(q))
}

async function getManagedCelebrities(managerId: string): Promise<ManagedCelebrity[]> {
  const links = await prisma.celebrityManagerLink.findMany({
    where: { manager_id: managerId, is_active: true },
    include: {
      celebrity: {
        select: {
          id: true,
          name: true,
          industry: true,
          is_active: true,
          onboarding_status: true,
          total_orders: true,
          thumbnail_url: true,
          approval_preferences: true,
          preapproved_template_ids: true,
        },
      },
    },
  })

  return links
    .map((link) => link.celebrity)
    .filter(Boolean) as ManagedCelebrity[]
}

async function getManagedScope(managerId: string) {
  const celebrities = await getManagedCelebrities(managerId)
  const celebrityIds = celebrities.map((celebrity) => celebrity.id)
  return { celebrities, celebrityIds }
}

async function signCelebrityThumb<T extends { thumbnail_url: string | null }>(value: T): Promise<T & { thumbnail_url: string | null }> {
  return {
    ...value,
    thumbnail_url: (await s3Service.presignIfS3(value.thumbnail_url ?? undefined)) ?? value.thumbnail_url,
  }
}

export async function getManagerDashboardOverview(req: ManagerRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { celebrities, celebrityIds } = await getManagedScope(req.managerId!)
    if (celebrityIds.length === 0) {
      res.json({
        success: true,
        summary: {
          totalCelebrities: 0,
          totalRequests: 0,
          pendingRequests: 0,
          reviewRequests: 0,
          breachedRequests: 0,
          fastTrackRequests: 0,
        },
        portfolio: [],
        alerts: [],
      })
      return
    }

    const jobs = await prisma.videoJob.findMany({
      where: { celebrity_id: { in: celebrityIds } },
      select: {
        id: true,
        reference_id: true,
        celebrity_id: true,
        product_type: true,
        purpose: true,
        status: true,
        approval_path: true,
        estimated_price: true,
        currency: true,
        created_at: true,
        updated_at: true,
        delivered_at: true,
      },
      orderBy: { created_at: 'desc' },
    })

    const jobsByCelebrity = new Map<string, typeof jobs>()
    for (const job of jobs) {
      const existing = jobsByCelebrity.get(job.celebrity_id) ?? []
      existing.push(job)
      jobsByCelebrity.set(job.celebrity_id, existing)
    }

    const portfolio = await Promise.all(celebrities.map(async (celebrity) => {
      const scopedJobs = jobsByCelebrity.get(celebrity.id) ?? []
      const pendingCount = scopedJobs.filter((job) => job.status === 'pending' || job.status === 'in_progress').length
      const reviewCount = scopedJobs.filter((job) => job.status === 'review').length
      const deliveredCount = scopedJobs.filter((job) => job.status === 'delivered').length
      const slaHours = readSlaHours(celebrity.approval_preferences)
      const breachedCount = scopedJobs.filter((job) => computeSlaState(job.created_at, readSlaHours(celebrity.approval_preferences, job.product_type), job.status) === 'breached').length

      return {
        ...(await signCelebrityThumb(celebrity)),
        pendingCount,
        reviewCount,
        deliveredCount,
        breachedCount,
        slaHours,
        preapprovedTemplateCount: celebrity.preapproved_template_ids.length,
      }
    }))

    const alerts = (await Promise.all(jobs
      .map(async (job) => {
        const celebrity = celebrities.find((item) => item.id === job.celebrity_id)
        if (!celebrity) return null
        const slaHours = readSlaHours(celebrity.approval_preferences, job.product_type)
        const slaState = computeSlaState(job.created_at, slaHours, job.status)
        if (!['breached', 'due_soon'].includes(slaState)) return null
        return {
          referenceId: job.reference_id,
          celebrityId: celebrity.id,
          celebrityName: celebrity.name,
          purpose: job.purpose,
          status: job.status,
          approvalPath: job.approval_path,
          slaHours,
          slaState,
          createdAt: job.created_at,
        }
      })))
      .filter((alert): alert is NonNullable<typeof alert> => Boolean(alert))
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .slice(0, 8)

    res.json({
      success: true,
      summary: {
        totalCelebrities: celebrities.length,
        totalRequests: jobs.length,
        pendingRequests: jobs.filter((job) => job.status === 'pending' || job.status === 'in_progress').length,
        reviewRequests: jobs.filter((job) => job.status === 'review').length,
        breachedRequests: alerts.filter((alert) => alert.slaState === 'breached').length,
        fastTrackRequests: jobs.filter((job) => job.approval_path === 'fast_track').length,
      },
      portfolio,
      alerts,
    })
  } catch (err) {
    next(err)
  }
}

export async function getManagerDashboardRequests(req: ManagerRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { celebrityIds, celebrities } = await getManagedScope(req.managerId!)
    const {
      status = 'all',
      approvalPath = 'all',
      celebrityId = 'all',
      slaState = 'all',
      search = '',
      page = '1',
      limit = '20',
    } = req.query

    if (celebrityIds.length === 0) {
      res.json({ success: true, data: [], total: 0, page: 1, pages: 0 })
      return
    }

    const normalizedStatus = (status as string) === 'in-progress' ? 'in_progress' : status as string
    const where: Record<string, unknown> = {
      celebrity_id: celebrityId !== 'all' ? celebrityId as string : { in: celebrityIds },
    }
    if (status !== 'all') where.status = normalizedStatus as VideoJobStatus
    if (approvalPath !== 'all') where.approval_path = approvalPath as string

    const jobs = await prisma.videoJob.findMany({
      where,
      include: {
        user: { select: { id: true, name: true, email: true, company: true } },
        celebrity: { select: { id: true, name: true, thumbnail_url: true } },
      },
      orderBy: { created_at: 'desc' },
    })

    const hydrated = await Promise.all(jobs.map(async (job) => {
      const celebrity = celebrities.find((item) => item.id === job.celebrity_id)
      const normalizedProductType = String(job.product_type)
      const resolvedSlaHours = readSlaHours(celebrity?.approval_preferences, normalizedProductType)
      const resolvedSlaState = computeSlaState(job.created_at, resolvedSlaHours, String(job.status))

      const celebrityData = job.celebrity
        ? await signCelebrityThumb(job.celebrity)
        : undefined

      return {
        ...job,
        product_type: normalizedProductType,
        status: String(job.status),
        celebrity: celebrityData,
        slaHours: resolvedSlaHours,
        slaState: resolvedSlaState,
        slaDueAt: new Date(job.created_at.getTime() + resolvedSlaHours * 60 * 60 * 1000).toISOString(),
      }
    }))

    const filtered = hydrated.filter((job) => {
      if (slaState !== 'all' && job.slaState !== slaState) return false
      if (!jobMatchesSearch(job as ManagedJob, String(search || ''))) return false
      return true
    })

    const pageNum = Math.max(1, parseInt(page as string, 10) || 1)
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string, 10) || 20))
    const start = (pageNum - 1) * limitNum
    const data = filtered.slice(start, start + limitNum)

    res.json({
      success: true,
      data,
      total: filtered.length,
      page: pageNum,
      pages: Math.ceil(filtered.length / limitNum),
    })
  } catch (err) {
    next(err)
  }
}

export async function getManagerDashboardTemplates(req: ManagerRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { celebrities } = await getManagedScope(req.managerId!)
    const templates = await prisma.template.findMany({
      where: { is_active: true, product_types: { has: 'video-ad' } },
      orderBy: [{ purpose: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, purpose: true, duration: true, product_types: true },
    })

    const data = await Promise.all(celebrities.map(async (celebrity) => ({
      ...(await signCelebrityThumb(celebrity)),
      slaHours: readSlaHours(celebrity.approval_preferences),
      preapprovedTemplates: templates.filter((template) => celebrity.preapproved_template_ids.includes(template.id)),
    })))

    res.json({ success: true, data, templates })
  } catch (err) {
    next(err)
  }
}

export async function updateManagerDashboardTemplates(req: ManagerRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { celebrityId } = req.params
    const templateIds = Array.isArray(req.body?.templateIds)
      ? req.body.templateIds.map((value: unknown) => String(value).trim()).filter(Boolean)
      : []

    const link = await prisma.celebrityManagerLink.findFirst({
      where: {
        manager_id: req.managerId!,
        celebrity_id: celebrityId,
        is_active: true,
      },
      include: {
        celebrity: {
          select: { id: true, name: true, preapproved_template_ids: true },
        },
      },
    })
    if (!link?.celebrity) throw new AppError('This celebrity is not linked to your manager account', 403)

    const validTemplates = await prisma.template.findMany({
      where: { id: { in: templateIds }, is_active: true, product_types: { has: 'video-ad' } },
      select: { id: true },
    })
    const validTemplateIds = validTemplates.map((template) => template.id)

    const updated = await prisma.celebrity.update({
      where: { id: celebrityId },
      data: { preapproved_template_ids: validTemplateIds },
      select: { id: true, name: true, preapproved_template_ids: true },
    })

    const actor = await prisma.manager.findUnique({ where: { id: req.managerId }, select: { name: true } })
    await auditLogService.log({
      actorId: req.managerId!,
      actorName: actor?.name ?? 'Manager',
      actorRole: 'manager',
      action: 'manager.templates_updated',
      targetType: 'celebrity',
      targetId: updated.id,
      targetName: updated.name,
      metadata: {
        templateIds: validTemplateIds,
      },
    })

    res.json({ success: true, data: updated, message: 'Template pre-approvals updated successfully.' })
  } catch (err) {
    next(err)
  }
}

export async function getManagerDashboardAuditLogs(req: ManagerRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { celebrityIds } = await getManagedScope(req.managerId!)
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1)
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '20'), 10) || 20))
    const skip = (page - 1) * limit

    if (celebrityIds.length === 0) {
      res.json({ success: true, logs: [], total: 0, page, pages: 0 })
      return
    }

    const where = {
      OR: [
        { target_id: { in: celebrityIds } },
        { actor_id: req.managerId! },
      ],
    }

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip,
        take: limit,
      }),
      prisma.auditLog.count({ where }),
    ])

    res.json({ success: true, logs, total, page, pages: Math.ceil(total / limit) })
  } catch (err) {
    next(err)
  }
}

export async function createManagerDashboardCelebrity(req: ManagerRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = { ...(req.body as Record<string, unknown>) }
    const name = String(body.name || '').trim()
    const contactEmail = String(body.contact_email || body.contactEmail || '').trim().toLowerCase()
    const contactPhone = String(body.contact_phone || body.contactPhone || '').trim() || null

    if (!name) throw new AppError('Celebrity name is required', 400)
    if (!contactEmail) throw new AppError('Celebrity portal email is required', 400)
    if (!isValidEmail(contactEmail)) throw new AppError('Enter a valid celebrity portal email', 400)

    const existingAdmin = await prisma.admin.findUnique({
      where: { email: contactEmail },
      select: { celebrity_id: true },
    })
    if (existingAdmin?.celebrity_id) {
      throw new AppError('This email is already linked to another celebrity portal account', 409)
    }
    if (existingAdmin && !existingAdmin.celebrity_id) {
      throw new AppError('This email is already used by an internal admin account', 409)
    }

    const manager = await prisma.manager.findUnique({
      where: { id: req.managerId! },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        agency_name: true,
      },
    })
    if (!manager) throw new AppError('Manager account not found', 404)

    const slug = await createUniqueManagerCelebritySlug(name)
    const managerSettings = {
      selfManaged: false,
      agencyName: manager.agency_name || '',
      managerName: manager.name,
      managerEmail: manager.email,
      managerPhone: manager.phone || '',
      permissions: [...DEFAULT_MANAGER_LINK_PERMISSIONS],
    }

    let created: Awaited<ReturnType<typeof prisma.celebrity.create>> | null = null
    try {
      created = await prisma.celebrity.create({
        data: {
          name,
          name_ar: '',
          legal_name: '',
          slug,
          industry: '',
          nationality: '',
          nationality_ar: '',
          region: '',
          contact_email: contactEmail,
          contact_phone: contactPhone,
          languages: [],
          tags: [],
          tags_ar: [],
          bio: '',
          bio_ar: '',
          social_links: {},
          allowed_content_categories: [],
          prohibited_industries: [],
          competitor_brands: [],
          geographic_availability: {
            mode: 'global',
            allowedRegions: [],
            restrictedRegions: [],
          },
          tone_style_preferences: {
            communicationStyle: '',
            visualStyle: '',
            endorsedTopics: [],
            personalRestrictions: [],
          },
          approval_preferences: {
            greetingAutoApprove: false,
            manualReviewRequired: true,
            slaHours: 48,
            fastTrackEligible: false,
            templatePolicyReviewed: false,
            commercialLicenseNumber: '',
            commercialLicenseDocumentUrl: '',
          },
          preapproved_template_ids: [],
          manager_settings: managerSettings,
          approved_media_urls: [],
          contract_acceptance: {
            accepted: false,
            acceptedAt: null,
            signedName: '',
          },
          avatar_color: 'linear-gradient(135deg, #9a78fe, #422266)',
          initials: name.split(' ').map((part) => part[0] || '').join('').slice(0, 3).toUpperCase() || 'CE',
          thumbnail_url: null,
          voice_model_id: null,
          training_audio_url: null,
          is_active: false,
          is_featured: false,
          onboarding_status: 'pending_review',
          applied_at: new Date(),
          reviewed_at: null,
          review_notes: null,
          price_range: {
            greeting: { min: 0, max: 0 },
            'video-ad': { min: 0, max: 0 },
          },
          total_orders: 0,
        },
      })

      const updatePayload: Record<string, unknown> = {
        ...body,
        contact_email: contactEmail,
        contact_phone: contactPhone,
        manager_settings: managerSettings,
      }

      const { updated } = await applyCelebrityProfileUpdate(created.id, updatePayload)

      await ensureManagerLink({
        celebrityId: created.id,
        managerId: manager.id,
        permissions: [...DEFAULT_MANAGER_LINK_PERMISSIONS],
        linkedBy: manager.id,
        notes: manager.agency_name ? `Agency: ${manager.agency_name}` : 'Created from manager portal',
      })

      res.status(201).json({
        success: true,
        data: {
          ...updated,
          thumbnail_url: await s3Service.presignIfS3(updated.thumbnail_url ?? undefined),
          approved_media_urls: await presignApprovedMediaUrls(updated.approved_media_urls ?? []),
        },
        message: 'Celebrity created and linked to this manager workspace.',
      })
    } catch (err) {
      if (created?.id) {
        await prisma.celebrityManagerLink.deleteMany({ where: { celebrity_id: created.id } }).catch(() => null)
        await prisma.celebrity.delete({ where: { id: created.id } }).catch(() => null)
      }
      throw err
    }
  } catch (err) {
    next(err)
  }
}

export async function getManagerDashboardCelebrityProfile(req: ManagerRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    await requireManagedCelebrity(req.managerId!, req.params.celebrityId)
    const { celebrity, templates } = await getCelebrityProfileBundle(req.params.celebrityId)

    res.json({
      success: true,
      data: {
        ...celebrity,
        thumbnail_url: await s3Service.presignIfS3(celebrity.thumbnail_url ?? undefined),
        approved_media_urls: await presignApprovedMediaUrls(celebrity.approved_media_urls ?? []),
      },
      templates,
    })
  } catch (err) {
    next(err)
  }
}

export async function updateManagerDashboardCelebrityProfile(req: ManagerRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const celebrity = await requireManagedCelebrity(req.managerId!, req.params.celebrityId)
    const manager = await prisma.manager.findUnique({
      where: { id: req.managerId! },
      select: {
        name: true,
        email: true,
        phone: true,
        agency_name: true,
      },
    })
    if (!manager) throw new AppError('Manager account not found', 404)
    const body = { ...(req.body as Record<string, unknown>) }

    if ('manager_settings' in body) {
      body.manager_settings = {
        selfManaged: false,
        agencyName: manager.agency_name || '',
        managerName: manager.name,
        managerEmail: manager.email,
        managerPhone: manager.phone || '',
        permissions: [...DEFAULT_MANAGER_LINK_PERMISSIONS],
      }
    }

    const { updated, profileReady } = await applyCelebrityProfileUpdate(req.params.celebrityId, body)

    res.json({
      success: true,
      data: {
        ...updated,
        thumbnail_url: await s3Service.presignIfS3(updated.thumbnail_url ?? undefined),
        approved_media_urls: await presignApprovedMediaUrls(updated.approved_media_urls ?? []),
      },
      profileReady,
    })
  } catch (err) {
    next(err)
  }
}

export async function submitManagerDashboardCelebrityProfile(req: ManagerRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const celebrity = await requireManagedCelebrity(req.managerId!, req.params.celebrityId)
    const manager = await prisma.manager.findUnique({
      where: { id: req.managerId! },
      select: {
        name: true,
        email: true,
      },
    })
    if (!manager) throw new AppError('Manager account not found', 404)
    if (!celebrity.contact_email) throw new AppError('Celebrity portal email is required before submission', 400)
    if (!isCelebrityProfileComplete(celebrity)) {
      throw new AppError('Complete all required profile sections before submitting for review', 400)
    }

    await prisma.celebrity.update({
      where: { id: celebrity.id },
      data: {
        onboarding_status: 'pending_review',
        is_active: false,
        review_notes: null,
      },
    })

    await Promise.all([
      emailService.sendManagerCelebrityPendingReviewEmail(manager.email, manager.name, celebrity.name),
      emailService.sendCelebrityManagerSubmittedProfileEmail(celebrity.contact_email, celebrity.name, manager.name),
    ])

    res.json({
      success: true,
      message: 'Celebrity profile submitted for platform review. Pending verification emails were sent.',
    })
  } catch (err) {
    next(err)
  }
}

export async function activateManagerDashboardCelebrityProfile(req: ManagerRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    throw new AppError('Managers cannot activate celebrities directly. Submit the profile for platform review instead.', 403)
  } catch (err) {
    next(err)
  }
}
