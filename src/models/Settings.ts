import mongoose, { Schema, Document } from 'mongoose'

export interface ISettings extends Document {
  key: string
  platformName: string
  supportEmail: string
  adminEmail: string
  elevenLabsKey: string
  syncLabsKey: string
  higgsfieldKey: string
  watermarkText: string
  watermarkOpacity: string
  watermarkPosition: string
  awsRegion: string
  s3VideosBucket: string
  s3AssetsBucket: string
}

const SettingsSchema = new Schema<ISettings>(
  {
    key:               { type: String, required: true, unique: true },
    platformName:      { type: String, default: 'Twinity' },
    supportEmail:      { type: String, default: 'support@twinity.ai' },
    adminEmail:        { type: String, default: 'admin@twinity.ai' },
    elevenLabsKey:     { type: String, default: '' },
    syncLabsKey:       { type: String, default: '' },
    higgsfieldKey:     { type: String, default: '' },
    watermarkText:     { type: String, default: 'twinity.ai · PREVIEW' },
    watermarkOpacity:  { type: String, default: '0.35' },
    watermarkPosition: { type: String, default: 'Bottom Center' },
    awsRegion:         { type: String, default: 'us-east-1' },
    s3VideosBucket:    { type: String, default: 'twinity-videos' },
    s3AssetsBucket:    { type: String, default: 'twinity-assets' },
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
  if (obj.elevenLabsKey) obj.elevenLabsKey = maskKey(obj.elevenLabsKey)
  if (obj.syncLabsKey)   obj.syncLabsKey   = maskKey(obj.syncLabsKey)
  if (obj.higgsfieldKey) obj.higgsfieldKey = maskKey(obj.higgsfieldKey)
  return obj
}

export const Settings = mongoose.model<ISettings>('Settings', SettingsSchema)
