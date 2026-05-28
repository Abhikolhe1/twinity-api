import prisma from '../lib/prisma'

type SupportedProductType = 'greeting' | 'video-ad' | 'image-ad'

type ValidationError = {
  field: string
  code: string
  message: string
}

type SubmissionUserContext = {
  accountType?: string | null
  company?: string | null
}

export type SubmissionValidationPayload = {
  celebrityId?: string
  productType?: string
  purpose?: string
  script?: string
  templateId?: string
  channels?: string[]
  duration?: string
  territory?: string
  exclusivity?: boolean | string
  estimatedPrice?: number
  aspectRatio?: string
  accountType?: string
  company?: string
  briefObjective?: string
  briefAudience?: string
  resumeReferenceId?: string | null
}

export type SubmissionValidationResult = {
  valid: boolean
  errors: ValidationError[]
  warnings: string[]
  approvalPath: 'fast_track' | 'full_review'
  businessVerificationRequired: boolean
  businessVerificationPassed: boolean
  slaHours: number
  pricingSnapshot: {
    subtotal: number
    vat: number
    total: number
    currency: string
  }
  normalized: {
    productType: SupportedProductType
    purpose: string
    script: string
    channels: string[]
    templateId?: string
    duration?: string
    territory?: string
    exclusivity?: boolean
    aspectRatio?: string
  }
  submissionContext: Record<string, unknown>
  validationSummary: Record<string, unknown>
  auditEntry: {
    event: 'submission_validated'
    actor: 'customer'
    timestamp: string
    approvalPath: 'fast_track' | 'full_review'
    note: string
  }
}

const VAT_RATE = 0.15

function normalizeProductType(value?: string): SupportedProductType | null {
  if (value === 'greeting') return 'greeting'
  if (value === 'video-ad' || value === 'video_ad') return 'video-ad'
  if (value === 'image-ad' || value === 'image_ad') return 'image-ad'
  return null
}

function averagePriceFromRange(range: unknown): number {
  if (!range || typeof range !== 'object') return 0
  const min = Number((range as { min?: number }).min ?? 0)
  const max = Number((range as { max?: number }).max ?? min)
  return Math.max(0, Math.round((min + max) / 2))
}

function findBlockedWords(script: string, blockedWords: string[]): string[] {
  const lowerScript = script.toLowerCase()
  return blockedWords.filter((word) => {
    const escaped = word.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(`\\b${escaped}\\b`, 'i').test(lowerScript)
  })
}

export async function validateSubmission(
  payload: SubmissionValidationPayload,
  userContext?: SubmissionUserContext,
): Promise<SubmissionValidationResult> {
  const productType = normalizeProductType(payload.productType)
  const purpose = String(payload.purpose || '').trim()
  const script = String(payload.script || '').trim()
  const channels = Array.isArray(payload.channels)
    ? payload.channels.map((channel) => String(channel).trim()).filter(Boolean)
    : []
  const duration = payload.duration ? String(payload.duration).trim() : undefined
  const territory = payload.territory ? String(payload.territory).trim() : undefined
  const exclusivity = typeof payload.exclusivity === 'boolean'
    ? payload.exclusivity
    : payload.exclusivity === 'none'
      ? false
      : Boolean(payload.exclusivity)
  const errors: ValidationError[] = []
  const warnings: string[] = []

  if (!payload.celebrityId?.trim()) {
    errors.push({ field: 'celebrityId', code: 'required', message: 'Please select a celebrity before submitting.' })
  }
  if (!productType) {
    errors.push({ field: 'productType', code: 'invalid', message: 'This request type is not supported for submission yet.' })
  }

  const celebrity = payload.celebrityId
    ? await prisma.celebrity.findUnique({ where: { id: payload.celebrityId } })
    : null

  if (payload.celebrityId && (!celebrity || !celebrity.is_active)) {
    errors.push({ field: 'celebrityId', code: 'inactive', message: 'The selected celebrity is no longer available.' })
  }

  if (!script) {
    errors.push({ field: 'script', code: 'required', message: 'Please complete the request brief before submitting.' })
  } else if (productType === 'image-ad' && script.length < 10) {
    errors.push({ field: 'script', code: 'too_short', message: 'Image ad prompt must be at least 10 characters long.' })
  }

  if (!purpose) {
    errors.push({ field: 'purpose', code: 'required', message: 'Please add the request purpose before submitting.' })
  }

  if (productType && productType !== 'greeting' && channels.length === 0) {
    errors.push({ field: 'channels', code: 'required', message: 'Select at least one usage channel before submitting.' })
  }

  if (productType === 'image-ad' && !payload.aspectRatio) {
    errors.push({ field: 'aspectRatio', code: 'required', message: 'Choose an output format before resubmitting the image ad.' })
  }

  const blockedWords = script
    ? (await prisma.blockedWord.findMany({ select: { word: true } })).map((row) => row.word)
    : []
  const foundBlockedWords = script ? findBlockedWords(script, blockedWords) : []
  if (foundBlockedWords.length > 0) {
    errors.push({
      field: 'script',
      code: 'blocked_content',
      message: `Your request contains restricted content: ${foundBlockedWords.join(', ')}.`,
    })
  }

  const businessVerificationRequired = productType !== 'greeting'
  const hasBusinessProfile = Boolean(
    userContext?.company?.trim()
      || userContext?.accountType === 'agency'
      || userContext?.accountType === 'influencer',
  )
  const businessVerificationPassed = !businessVerificationRequired || hasBusinessProfile
  if (businessVerificationRequired && !businessVerificationPassed) {
    warnings.push('Business profile details are incomplete, so this request will stay on the full-review path until the team verifies it manually.')
  }

  const approvalPath: 'fast_track' | 'full_review' =
    productType === 'greeting' || (productType === 'video-ad' && businessVerificationPassed && !exclusivity)
      ? 'fast_track'
      : 'full_review'

  const slaHours =
    productType === 'greeting'
      ? 24
      : productType === 'image-ad'
        ? 48
        : approvalPath === 'fast_track'
          ? 48
          : 72

  const defaultSubtotal = productType && celebrity
    ? averagePriceFromRange((celebrity.price_range as Record<string, unknown> | null)?.[productType])
    : 0
  const subtotal = Math.max(
    0,
    Number.isFinite(Number(payload.estimatedPrice)) && Number(payload.estimatedPrice) > 0
      ? Math.round(Number(payload.estimatedPrice))
      : defaultSubtotal,
  )
  const vat = Math.round(subtotal * VAT_RATE * 100) / 100
  const total = Math.round((subtotal + vat) * 100) / 100

  const normalizedProductType = productType ?? 'greeting'
  const submissionContext: Record<string, unknown> = {
    templateId: payload.templateId || undefined,
    channels,
    duration: duration || undefined,
    territory: territory || undefined,
    exclusivity,
    estimatedPrice: subtotal,
    accountType: userContext?.accountType || payload.accountType || undefined,
    company: userContext?.company || payload.company || undefined,
    briefObjective: payload.briefObjective || undefined,
    briefAudience: payload.briefAudience || undefined,
    resumeReferenceId: payload.resumeReferenceId || undefined,
  }

  const validationSummary = {
    checkedAt: new Date().toISOString(),
    blockedWords: foundBlockedWords,
    warnings,
    errors,
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    approvalPath,
    businessVerificationRequired,
    businessVerificationPassed,
    slaHours,
    pricingSnapshot: { subtotal, vat, total, currency: 'SAR' },
    normalized: {
      productType: normalizedProductType,
      purpose,
      script,
      channels,
      templateId: payload.templateId || undefined,
      duration,
      territory,
      exclusivity,
      aspectRatio: payload.aspectRatio || undefined,
    },
    submissionContext,
    validationSummary,
    auditEntry: {
      event: 'submission_validated',
      actor: 'customer',
      timestamp: new Date().toISOString(),
      approvalPath,
      note: errors.length === 0
        ? 'Submission passed review-and-submit validation'
        : 'Submission blocked by review-and-submit validation',
    },
  }
}
