import mongoose, { Schema, Document } from 'mongoose'

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
] as const

export type Permission = typeof ALL_PERMISSIONS[number]

export interface IRole extends Document {
  name: string
  description: string
  permissions: string[]
  isSystem: boolean
  createdBy?: mongoose.Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

const RoleSchema = new Schema<IRole>(
  {
    name:        { type: String, required: true, trim: true, unique: true },
    description: { type: String, default: '', trim: true },
    permissions: [{ type: String, enum: ALL_PERMISSIONS }],
    isSystem:    { type: Boolean, default: false },
    createdBy:   { type: Schema.Types.ObjectId, ref: 'Admin' },
  },
  { timestamps: true }
)

export const Role = mongoose.model<IRole>('Role', RoleSchema)
