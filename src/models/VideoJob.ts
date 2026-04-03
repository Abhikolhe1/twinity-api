import mongoose, { Schema, Document } from 'mongoose'

export type VideoJobStatus = 'pending' | 'in-progress' | 'review' | 'delivered' | 'failed' | 'cancelled'

export interface IVideoJob extends Document {
  referenceId: string
  userId: mongoose.Types.ObjectId
  celebrityId: mongoose.Types.ObjectId
  productType: 'greeting' | 'avatar-studio' | 'full-body'
  purpose: string
  templateId?: string
  script: string
  tone?: string
  duration: string
  aspectRatio: string
  resolution: string
  channels: string[]
  status: VideoJobStatus
  statusHistory: Array<{ status: VideoJobStatus; timestamp: Date; note?: string }>
  estimatedPrice: number
  currency: string
  downloadEnabled: boolean
  previewUrl?: string
  finalVideoUrl?: string
  watermarkedUrl?: string
  aiJobId?: string             // request_id from Higgsfield
  higgsfieldStatusUrl?: string // polling URL returned by Higgsfield on submission
  voiceJobId?: string          // jobId from ElevenLabs TTS
  voiceAudioUrl?: string       // S3 URL of generated voice audio
  // Scene settings (customer-provided context for video generation)
  propImages?: string[]
  sceneNotes?: string
  backgroundImageUrl?: string
  errorMessage?: string
  deliveredAt?: Date
  createdAt: Date
  updatedAt: Date
}

const VideoJobSchema = new Schema<IVideoJob>(
  {
    referenceId:  { type: String, required: true, unique: true },
    userId:       { type: Schema.Types.ObjectId, ref: 'User', required: true },
    celebrityId:  { type: Schema.Types.ObjectId, ref: 'Celebrity', required: true },
    productType:  { type: String, enum: ['greeting', 'avatar-studio', 'full-body'], required: true },
    purpose:      { type: String, required: true },
    templateId:   { type: String },
    script:       { type: String, required: true, maxlength: 2000 },
    tone:         { type: String },
    duration:     { type: String, default: '30s' },
    aspectRatio:  { type: String, default: '16:9' },
    resolution:   { type: String, default: '1080p' },
    channels:     [{ type: String }],
    status:       { type: String, enum: ['pending','in-progress','review','delivered','failed','cancelled'], default: 'pending' },
    statusHistory: [
      {
        status:    { type: String },
        timestamp: { type: Date, default: Date.now },
        note:      { type: String },
      },
    ],
    estimatedPrice:  { type: Number, required: true },
    currency:        { type: String, default: 'USD' },
    downloadEnabled: { type: Boolean, default: false },
    previewUrl:      { type: String },
    finalVideoUrl:   { type: String },
    watermarkedUrl:  { type: String },
    aiJobId:               { type: String },
    higgsfieldStatusUrl:   { type: String },
    voiceJobId:            { type: String },
    voiceAudioUrl:      { type: String },
    propImages:         [{ type: String }],
    sceneNotes:         { type: String },
    backgroundImageUrl: { type: String },
    errorMessage:       { type: String },
    deliveredAt:     { type: Date },
  },
  { timestamps: true }
)

VideoJobSchema.index({ userId: 1, status: 1 })
VideoJobSchema.index({ status: 1 })
VideoJobSchema.index({ aiJobId: 1 }, { sparse: true })

export const VideoJob = mongoose.model<IVideoJob>('VideoJob', VideoJobSchema)
