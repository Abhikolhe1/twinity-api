/**
 * Re-exports Prisma-generated types for use across controllers and services.
 * This file replaces the individual Mongoose model files.
 */
export type {
  User,
  Celebrity,
  VideoJob,
  Lead,
  Admin,
  Role,
  Template,
  ProductType,
  Setting,
  Prisma,
} from '@prisma/client'

export {
  VideoJobStatus,
  LeadStatus,
  LeadSource,
  AdminRole,
  CelebrityOnboardingStatus,
  UserStatus,
  UserAccountType,
  UserAuthProvider,
  VideoJobProductType,
} from '@prisma/client'

// ALL_PERMISSIONS — canonical permission list (kept from original Role model)
export const ALL_PERMISSIONS = [
  'dashboard.view',
  'users.view',
  'users.manage',
  'celebrities.view',
  'celebrities.manage',
  'videos.view',
  'videos.manage',
  'leads.view',
  'leads.manage',
  'settings.view',
  'settings.manage',
  'team.view',
  'team.manage',
  'roles.view',
  'roles.manage',
  'templates.view',
  'templates.manage',
  'celebrity_applications.view',
  'celebrity_applications.manage',
  'celebrity.profile.view',
  'celebrity.profile.update',
  'celebrity.orders.view',
] as const

export type Permission = typeof ALL_PERMISSIONS[number]
