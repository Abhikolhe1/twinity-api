import mongoose, { Schema, Document } from 'mongoose'

export interface IProductType extends Document {
  slug: string
  name: string
  nameAr: string
  description: string
  descriptionAr: string
  detail: string
  detailAr: string
  icon: string
  priceFrom: number
  duration: string
  durationAr: string
  useCases: string[]
  useCasesAr: string[]
  creatifyPrompt: string
  geminiSystemPrompt: string
  isActive: boolean
  order: number
}

const ProductTypeSchema = new Schema<IProductType>(
  {
    slug:               { type: String, required: true, unique: true, trim: true },
    name:               { type: String, required: true, trim: true },
    nameAr:             { type: String, required: true, trim: true },
    description:        { type: String, required: true, trim: true },
    descriptionAr:      { type: String, required: true, trim: true },
    detail:             { type: String, required: true },
    detailAr:           { type: String, required: true },
    icon:               { type: String, default: '' },
    priceFrom:          { type: Number, default: 0 },
    duration:           { type: String, default: '' },
    durationAr:         { type: String, default: '' },
    useCases:           [{ type: String }],
    useCasesAr:         [{ type: String }],
    creatifyPrompt:     { type: String, default: '' },
    geminiSystemPrompt: { type: String, default: '' },
    isActive:           { type: Boolean, default: true },
    order:              { type: Number, default: 0 },
  },
  { timestamps: true }
)

ProductTypeSchema.index({ isActive: 1, order: 1 })

export const ProductType = mongoose.model<IProductType>('ProductType', ProductTypeSchema)
