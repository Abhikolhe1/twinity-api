import mongoose, { Schema, Document } from 'mongoose'

export interface ICelebrity extends Document {
  name: string
  nameAr: string
  slug: string
  industry: string
  nationality: string
  nationalityAr: string
  languages: string[]
  tags: string[]
  tagsAr: string[]
  bio?: string
  bioAr?: string
  avatarColor: string
  initials: string
  thumbnailUrl?: string
  voiceModelId?: string
  trainingAudioUrl?: string   // fallback audio for queue when ElevenLabs is unavailable
  heygenPhotoId?: string      // cached HeyGen talking_photo_id — avoids re-uploading image
  isActive: boolean
  isFeatured: boolean
  priceRange: {
    greeting:      { min: number; max: number }
    'avatar-studio': { min: number; max: number }
    'full-body':   { min: number; max: number }
  }
  totalOrders: number
  createdAt: Date
  updatedAt: Date
}

const PriceRangeSchema = new Schema({ min: Number, max: Number }, { _id: false })

const CelebritySchema = new Schema<ICelebrity>(
  {
    name:          { type: String, required: true, trim: true },
    nameAr:        { type: String, required: true, trim: true },
    slug:          { type: String, required: true, unique: true, lowercase: true },
    industry:      { type: String, required: true },
    nationality:   { type: String, required: true },
    nationalityAr: { type: String, required: true },
    languages:     [{ type: String }],
    tags:          [{ type: String }],
    tagsAr:        [{ type: String }],
    bio:           { type: String },
    bioAr:         { type: String },
    avatarColor:   { type: String, default: 'linear-gradient(135deg, #9a78fe, #422266)' },
    initials:      { type: String, required: true, maxlength: 3 },
    thumbnailUrl:      { type: String },
    voiceModelId:      { type: String },
    trainingAudioUrl:  { type: String },
    heygenPhotoId:     { type: String },
    isActive:      { type: Boolean, default: true },
    isFeatured:    { type: Boolean, default: false },
    priceRange: {
      greeting:        { type: PriceRangeSchema, default: { min: 500, max: 2000 } },
      'avatar-studio': { type: PriceRangeSchema, default: { min: 2000, max: 8000 } },
      'full-body':     { type: PriceRangeSchema, default: { min: 6000, max: 20000 } },
    },
    totalOrders: { type: Number, default: 0 },
  },
  { timestamps: true }
)

CelebritySchema.index({ industry: 1, isActive: 1 })

export const Celebrity = mongoose.model<ICelebrity>('Celebrity', CelebritySchema)
