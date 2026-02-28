import mongoose, { Schema, Document } from 'mongoose'

export interface ITemplate extends Document {
  name: string
  nameAr: string
  description: string
  descriptionAr: string
  purpose: string
  purposeAr: string
  sampleScript: string
  sampleScriptAr: string
  productTypes: string[]
  duration: string
  isActive: boolean
}

const TemplateSchema = new Schema<ITemplate>(
  {
    name:           { type: String, required: true, trim: true },
    nameAr:         { type: String, required: true, trim: true },
    description:    { type: String, required: true, trim: true },
    descriptionAr:  { type: String, required: true, trim: true },
    purpose:        { type: String, required: true, trim: true },
    purposeAr:      { type: String, required: true, trim: true },
    sampleScript:   { type: String, required: true },
    sampleScriptAr: { type: String, required: true },
    productTypes:   [{ type: String }],
    duration:       { type: String, default: '30s' },
    isActive:       { type: Boolean, default: true },
  },
  { timestamps: true }
)

TemplateSchema.index({ productTypes: 1 })
TemplateSchema.index({ isActive: 1 })
TemplateSchema.index({ purpose: 1 })

export const Template = mongoose.model<ITemplate>('Template', TemplateSchema)
