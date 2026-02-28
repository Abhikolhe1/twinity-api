import mongoose, { Schema, Document, Types } from 'mongoose'
import bcrypt from 'bcryptjs'

export type AdminRole = 'super-admin' | 'admin' | 'ops'

export interface IAdmin extends Document {
  name: string
  email: string
  password: string
  role: AdminRole
  roleId?: Types.ObjectId
  isActive: boolean
  lastLoginAt?: Date
  passwordResetToken?: string
  passwordResetExpires?: Date
  createdAt: Date
  updatedAt: Date
  comparePassword(candidate: string): Promise<boolean>
}

const AdminSchema = new Schema<IAdmin>(
  {
    name:        { type: String, required: true, trim: true },
    email:       { type: String, required: true, unique: true, lowercase: true },
    password:    { type: String, required: true, minlength: 8, select: false },
    role:        { type: String, enum: ['super-admin', 'admin', 'ops'], default: 'ops' },
    roleId:      { type: Schema.Types.ObjectId, ref: 'Role' },
    isActive:             { type: Boolean, default: true },
    lastLoginAt:          { type: Date },
    passwordResetToken:   { type: String, select: false },
    passwordResetExpires: { type: Date,   select: false },
  },
  { timestamps: true }
)

AdminSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next()
  this.password = await bcrypt.hash(this.password, 12)
  next()
})

AdminSchema.methods.comparePassword = function (candidate: string): Promise<boolean> {
  return bcrypt.compare(candidate, this.password)
}

export const Admin = mongoose.model<IAdmin>('Admin', AdminSchema)
