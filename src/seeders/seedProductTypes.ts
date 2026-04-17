import dotenv from 'dotenv'
dotenv.config()

import mongoose from 'mongoose'
import { ProductType } from '../models/ProductType'

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/twinity'

const PRODUCT_TYPES = [
  {
    slug:         'greeting',
    name:         'Celebrity Greetings',
    nameAr:       'تحيات المشاهير',
    description:  'Personal occasions',
    descriptionAr: 'المناسبات الشخصية',
    detail:       'Personalized celebrity messages for birthdays, weddings, graduations, and heartfelt appreciations.',
    detailAr:     'رسائل مشاهير شخصية لأعياد الميلاد والأعراس والتخرج وعبارات الامتنان.',
    icon:         '🎉',
    priceFrom:    149,
    duration:     'Delivery in 1–2 business days',
    durationAr:   'التسليم في غضون 1–2 يوم عمل',
    useCases:     ['Birthdays', 'Weddings', 'Graduations', 'Corporate Appreciation'],
    useCasesAr:   ['أعياد الميلاد', 'الأعراس', 'حفلات التخرج', 'التقدير المؤسسي'],
    videoPrompt: 'Warm, friendly, and celebratory tone. Bright and cheerful setting. Natural smiling expression with genuine emotion. Soft, flattering lighting. Avoid: formal or stiff posture, dark or moody lighting, serious expression, corporate aesthetic.',
    geminiSystemPrompt: 'You are a creative scene designer for personal celebrity greeting videos. Generate warm, celebratory, and heartfelt background scenes. The scene should feel personal, joyful, and appropriate for special occasions like birthdays, weddings, and graduations. Focus on bright colors, soft lighting, and uplifting atmospheres.',
    isActive: true,
    order: 0,
  },
  {
    slug:         'avatar-studio',
    name:         'Short Product Ads',
    nameAr:       'إعلانات المنتجات القصيرة',
    description:  'Short celebrity Ad',
    descriptionAr: 'الرأس والكتفين',
    detail:       'Hyper-realistic video avatars ideal for ads, product launches, and official announcements.',
    detailAr:     'أفاتارات فيديو فائقة الواقعية مثالية للإعلانات وإطلاق المنتجات والإعلانات الرسمية.',
    icon:         '🎬',
    priceFrom:    299,
    duration:     'Delivery in 3–5 business days',
    durationAr:   'التسليم في غضون 3–5 أيام عمل',
    useCases:     ['Brand Ads', 'Product Launches', 'Corporate Announcements', 'Social Media Posts'],
    useCasesAr:   ['إعلانات العلامة التجارية', 'إطلاق المنتجات', 'الإعلانات الشركاتية', 'منشورات وسائل التواصل الاجتماعي'],
    videoPrompt: 'Maintain a calm, authoritative, and professional manner. Smiling, friendly expression. Subtle eyebrow raise on key statements, natural hand movements. Keep natural breathing inhale exhale cycle, visible between speech. Avoid: cartoon, illustration, anime, painting, oversmooth skin, plastic skin, unrealistic face, distorted eyes, extra fingers, blur, low resolution, bad anatomy, artificial lighting, waxy skin.',
    geminiSystemPrompt: 'You are a professional scene designer for celebrity product advertisement videos. Generate clean, modern, and brand-appropriate background scenes. The scene should convey professionalism, trust, and product appeal. Prefer studio settings, clean gradients, or sleek modern environments that complement product marketing.',
    isActive: true,
    order: 1,
  },
  {
    slug:         'full-body',
    name:         'Full-Body Digital Twin',
    nameAr:       'التوأم الرقمي للجسم الكامل',
    description:  'Full body celebrity Ad',
    descriptionAr: 'الجسم الكامل + التقاط الحركة',
    detail:       'Complete digital twin with natural body motion for large-scale campaigns and immersive experiences.',
    detailAr:     'توأم رقمي كامل مع حركة جسمية طبيعية للحملات الكبيرة والتجارب الغامرة.',
    icon:         '🧬',
    priceFrom:    899,
    duration:     'Delivery in 7–14 business days',
    durationAr:   'التسليم في غضون 7–14 يوم عمل',
    useCases:     ['TV Commercials', 'Event Displays', 'Campaign Videos', 'Immersive Brand Experiences'],
    useCasesAr:   ['إعلانات تلفزيونية', 'عروض الفعاليات', 'مقاطع فيديو الحملات', 'تجارب العلامة التجارية الغامرة'],
    videoPrompt: 'Full-body natural motion, high production value, cinematic quality. Confident posture, natural movement, dynamic presence. Premium lighting setup, crisp detail throughout the full body frame. Avoid: partial body shots, unnatural stiff movement, low resolution, overexposed lighting, motion blur, distorted proportions, cropped limbs.',
    geminiSystemPrompt: 'You are a cinematic scene designer for large-scale celebrity campaign videos. Generate high-production-value, cinematic background scenes suitable for TV commercials and major brand campaigns. The scene should be epic, polished, and visually striking — think premium brand aesthetics, dramatic lighting, and wide open spaces or luxury environments.',
    isActive: true,
    order: 2,
  },
]

async function run() {
  await mongoose.connect(MONGO_URI)
  console.log('Connected to MongoDB')

  let created = 0
  let skipped = 0

  for (const pt of PRODUCT_TYPES) {
    const exists = await ProductType.findOne({ slug: pt.slug })
    if (exists) {
      console.log(`  skip  ${pt.slug} (already exists)`)
      skipped++
      continue
    }
    await ProductType.create(pt)
    console.log(`  seed  ${pt.slug}`)
    created++
  }

  console.log(`\nDone — ${created} created, ${skipped} skipped.`)
  await mongoose.disconnect()
}

run().catch(err => {
  console.error(err)
  process.exit(1)
})
