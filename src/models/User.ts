import mongoose, { Schema, Document } from 'mongoose'
import bcrypt from 'bcryptjs'

export interface IUser extends Document {
  name: string
  email: string
  password: string
  phone?: string
  company?: string
  avatarUrl?: string
  authProvider: 'email' | 'google'
  hasEmailPassword: boolean
  isEmailVerified: boolean
  emailVerificationToken?: string
  passwordResetToken?: string
  passwordResetExpires?: Date
  status: 'active' | 'blocked' | 'pending'
  lastLoginAt?: Date
  createdAt: Date
  updatedAt: Date
  comparePassword(candidate: string): Promise<boolean>
}

const UserSchema = new Schema<IUser>(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true, minlength: 8, select: false },
    phone: { type: String, trim: true },
    company: { type: String, trim: true },
    avatarUrl: { type: String },
    authProvider: { type: String, enum: ['email', 'google'], default: 'email' },
    hasEmailPassword: { type: Boolean, default: false },
    isEmailVerified: { type: Boolean, default: false },
    emailVerificationToken: { type: String, select: false },
    passwordResetToken: { type: String, select: false },
    passwordResetExpires: { type: Date, select: false },
    status: { type: String, enum: ['active', 'blocked', 'pending'], default: 'pending' },
    lastLoginAt: { type: Date },
  },
  { timestamps: true }
)

UserSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next()
  this.password = await bcrypt.hash(this.password, 12)
  next()
})

UserSchema.methods.comparePassword = function (candidate: string): Promise<boolean> {
  return bcrypt.compare(candidate, this.password)
}

UserSchema.index({ email: 1 })
UserSchema.index({ status: 1 })

export const User = mongoose.model<IUser>('User', UserSchema)
