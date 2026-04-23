import mongoose, { Schema, Document } from 'mongoose'

export interface ISettings extends Document {
  key: string
  platformName: string
  supportEmail: string
  adminEmail: string
  elevenLabsKey: string
  creatifyApiId: string
  creatifyApiKey: string
  openaiKey: string
  geminiApiKey: string
  watermarkText: string
  watermarkOpacity: string
  watermarkPosition: string
  awsAccessKeyId: string
  awsSecretAccessKey: string
  awsRegion: string
  s3Bucket: string
  blockedWords: string[]
  scriptImprovePrompt: string
  scriptEnhancePrompt: string
  thumbnailProcessPrompt: string
}

const SettingsSchema = new Schema<ISettings>(
  {
    key:               { type: String, required: true, unique: true },
    platformName:      { type: String, default: 'Twinity' },
    supportEmail:      { type: String, default: 'support@twinity.ai' },
    adminEmail:        { type: String, default: 'admin@twinity.ai' },
    elevenLabsKey:  { type: String, default: '' },
    creatifyApiId:  { type: String, default: '' },
    creatifyApiKey: { type: String, default: '' },
    openaiKey:      { type: String, default: '' },
    geminiApiKey:   { type: String, default: '' },
    watermarkText:     { type: String, default: 'twinity.ai · PREVIEW' },
    watermarkOpacity:  { type: String, default: '0.35' },
    watermarkPosition: { type: String, default: 'Bottom Center' },
    awsAccessKeyId:     { type: String, default: '' },
    awsSecretAccessKey: { type: String, default: '' },
    awsRegion:          { type: String, default: 'us-east-1' },
    s3Bucket:           { type: String, default: 'twinity-storage' },
    blockedWords:           { type: [String], default: [] },
    scriptImprovePrompt:    { type: String, default: '' },
    scriptEnhancePrompt:    { type: String, default: '' },
    thumbnailProcessPrompt: { type: String, default: '' },
  },
  { timestamps: true }
)

function maskKey(val: string): string {
  if (!val) return ''
  const parts = val.split('-')
  if (parts.length >= 2) {
    return parts[0] + '-' + parts[1] + '-**'
  }
  if (val.length <= 6) return '**'
  return val.slice(0, 6) + '-**'
}

SettingsSchema.methods.toPublicJSON = function () {
  const obj = this.toObject()
  if (obj.elevenLabsKey)  obj.elevenLabsKey  = maskKey(obj.elevenLabsKey)
  if (obj.creatifyApiId)  obj.creatifyApiId  = maskKey(obj.creatifyApiId)
  if (obj.creatifyApiKey) obj.creatifyApiKey = maskKey(obj.creatifyApiKey)
  if (obj.openaiKey)      obj.openaiKey      = maskKey(obj.openaiKey)
  if (obj.geminiApiKey)   obj.geminiApiKey   = maskKey(obj.geminiApiKey)
  if (obj.awsSecretAccessKey) obj.awsSecretAccessKey = maskKey(obj.awsSecretAccessKey)
  return obj
}

export const Settings = mongoose.model<ISettings>('Settings', SettingsSchema)
