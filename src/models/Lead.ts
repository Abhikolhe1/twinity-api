import mongoose, { Schema, Document } from 'mongoose'

export type LeadStatus = 'new' | 'contacted' | 'negotiating' | 'paid' | 'closed' | 'lost'

export interface ILead extends Document {
  userId?: mongoose.Types.ObjectId
  videoJobId?: mongoose.Types.ObjectId
  name: string
  email: string
  phone?: string
  company?: string
  celebrityName: string
  productType: string
  purpose: string
  notes?: string
  estimatedValue: number
  currency: string
  status: LeadStatus
  statusHistory: Array<{ status: LeadStatus; timestamp: Date; note?: string; adminId?: string }>
  assignedTo?: string
  followUpDate?: Date
  source: 'book-call' | 'contact-form' | 'direct'
  createdAt: Date
  updatedAt: Date
}

const LeadSchema = new Schema<ILead>(
  {
    userId:       { type: Schema.Types.ObjectId, ref: 'User' },
    videoJobId:   { type: Schema.Types.ObjectId, ref: 'VideoJob' },
    name:         { type: String, required: true, trim: true },
    email:        { type: String, required: true, lowercase: true, trim: true },
    phone:        { type: String, trim: true },
    company:      { type: String, trim: true },
    celebrityName: { type: String, required: true },
    productType:  { type: String, required: true },
    purpose:      { type: String, required: true },
    notes:        { type: String },
    estimatedValue: { type: Number, default: 0 },
    currency:     { type: String, default: 'USD' },
    status:       { type: String, enum: ['new','contacted','negotiating','paid','closed','lost'], default: 'new' },
    statusHistory: [
      {
        status:    { type: String },
        timestamp: { type: Date, default: Date.now },
        note:      { type: String },
        adminId:   { type: String },
      },
    ],
    assignedTo:   { type: String },
    followUpDate: { type: Date },
    source:       { type: String, enum: ['book-call','contact-form','direct'], default: 'book-call' },
  },
  { timestamps: true }
)

LeadSchema.index({ status: 1 })
LeadSchema.index({ email: 1 })

export const Lead = mongoose.model<ILead>('Lead', LeadSchema)
