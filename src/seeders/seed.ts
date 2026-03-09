import dotenv from 'dotenv'
dotenv.config()

import mongoose from 'mongoose'
import { Admin } from '../models/Admin'
import { Celebrity } from '../models/Celebrity'
import { User } from '../models/User'
import { VideoJob } from '../models/VideoJob'
import { Lead } from '../models/Lead'

const MONGO_URI      = process.env.MONGODB_URI       || 'mongodb://localhost:27017/twinity'
const ADMIN_EMAIL    = process.env.ADMIN_EMAIL        || 'admin@twinity.ai'
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD     || 'Admin@1234'
const ADMIN_NAME     = process.env.ADMIN_NAME         || 'Super Admin'
const CLIENT_URL     = process.env.CLIENT_URL         || 'http://localhost:3000'

// ─── Seed data ────────────────────────────────────────────────

const CELEBRITIES = [
  {
    name: 'Cristiano Ronaldo', nameAr: 'كريستيانو رونالدو', slug: 'cristiano-ronaldo',
    industry: 'sports', nationality: 'Portuguese', nationalityAr: 'برتغالي',
    languages: ['en', 'pt'], tags: ['football', 'sports', 'global'],
    tagsAr: ['كرة القدم', 'رياضة'],
    initials: 'CR', avatarColor: 'linear-gradient(135deg,#1a73e8,#0d47a1)',
    thumbnailUrl: `${CLIENT_URL}/celebs/cr7.svg`,
    isActive: true, isFeatured: true, totalOrders: 34,
    bio: 'Global football icon and five-time Ballon d\'Or winner.',
    bioAr: 'أيقونة كرة القدم العالمية والفائز بخمس جوائز الكرة الذهبية.',
    priceRange: { greeting: { min: 1200, max: 3500 }, 'avatar-studio': { min: 4000, max: 10000 }, 'full-body': { min: 10000, max: 30000 } },
  },
  {
    name: 'Mohamed Salah', nameAr: 'محمد صلاح', slug: 'mohamed-salah',
    industry: 'sports', nationality: 'Egyptian', nationalityAr: 'مصري',
    languages: ['ar', 'en'], tags: ['football', 'sports', 'arabic'],
    tagsAr: ['كرة القدم', 'رياضة', 'عربي'],
    initials: 'MS', avatarColor: 'linear-gradient(135deg,#e53935,#b71c1c)',
    thumbnailUrl: `${CLIENT_URL}/celebs/salah.svg`,
    isActive: true, isFeatured: true, totalOrders: 28,
    bio: 'Egyptian football king, Liverpool and Egypt captain.',
    bioAr: 'ملك الكرة المصري، قائد ليفربول ومنتخب مصر.',
    priceRange: { greeting: { min: 900, max: 2500 }, 'avatar-studio': { min: 3000, max: 8000 }, 'full-body': { min: 8000, max: 22000 } },
  },
  {
    name: 'Amr Diab', nameAr: 'عمرو دياب', slug: 'amr-diab',
    industry: 'music', nationality: 'Egyptian', nationalityAr: 'مصري',
    languages: ['ar'], tags: ['music', 'arabic', 'pop'],
    tagsAr: ['موسيقى', 'عربي', 'بوب'],
    initials: 'AD', avatarColor: 'linear-gradient(135deg,#f57c00,#e65100)',
    thumbnailUrl: `${CLIENT_URL}/celebs/amr-diab.svg`,
    isActive: true, isFeatured: false, totalOrders: 17,
    bio: 'Legend of Arabic pop music with over 30 years of hits.',
    bioAr: 'أسطورة الموسيقى العربية مع أكثر من 30 عاماً من النجاحات.',
    priceRange: { greeting: { min: 600, max: 1800 }, 'avatar-studio': { min: 2000, max: 6000 }, 'full-body': { min: 6000, max: 15000 } },
  },
  {
    name: 'Nancy Ajram', nameAr: 'نانسي عجرم', slug: 'nancy-ajram',
    industry: 'music', nationality: 'Lebanese', nationalityAr: 'لبنانية',
    languages: ['ar', 'en'], tags: ['music', 'arabic', 'pop'],
    tagsAr: ['موسيقى', 'عربي', 'بوب'],
    initials: 'NA', avatarColor: 'linear-gradient(135deg,#e91e8c,#ad1457)',
    thumbnailUrl: `${CLIENT_URL}/celebs/nancy-ajram.svg`,
    isActive: true, isFeatured: false, totalOrders: 12,
    bio: 'Lebanese pop star known throughout the Arab world.',
    bioAr: 'نجمة البوب اللبنانية المعروفة في جميع أنحاء العالم العربي.',
    priceRange: { greeting: { min: 500, max: 1500 }, 'avatar-studio': { min: 1800, max: 5000 }, 'full-body': { min: 5000, max: 12000 } },
  },
  {
    name: 'MrBeast', nameAr: 'مستر بيست', slug: 'mrbeast',
    industry: 'social-media', nationality: 'American', nationalityAr: 'أمريكي',
    languages: ['en'], tags: ['youtube', 'viral', 'social-media'],
    tagsAr: ['يوتيوب', 'فيروسي', 'سوشيال ميديا'],
    initials: 'MB', avatarColor: 'linear-gradient(135deg,#43a047,#1b5e20)',
    thumbnailUrl: `${CLIENT_URL}/celebs/mrbeast.svg`,
    isActive: true, isFeatured: false, totalOrders: 9,
    bio: 'World\'s most subscribed YouTuber with viral philanthropic content.',
    bioAr: 'أكثر يوتيوبر اشتراكاً في العالم بمحتوى فيروسي.',
    priceRange: { greeting: { min: 800, max: 2500 }, 'avatar-studio': { min: 3000, max: 9000 }, 'full-body': { min: 9000, max: 25000 } },
  },
  {
    name: 'Haifa Wehbe', nameAr: 'هيفاء وهبي', slug: 'haifa-wehbe',
    industry: 'entertainment', nationality: 'Lebanese', nationalityAr: 'لبنانية',
    languages: ['ar'], tags: ['music', 'entertainment', 'arabic'],
    tagsAr: ['موسيقى', 'ترفيه', 'عربي'],
    initials: 'HW', avatarColor: 'linear-gradient(135deg,#7b1fa2,#4a148c)',
    thumbnailUrl: `${CLIENT_URL}/celebs/haifa.svg`,
    isActive: false, isFeatured: false, totalOrders: 6,
    bio: 'Lebanese entertainment icon with a massive Middle East fanbase.',
    bioAr: 'أيقونة الترفيه اللبنانية بقاعدة جماهيرية ضخمة في الشرق الأوسط.',
    priceRange: { greeting: { min: 400, max: 1200 }, 'avatar-studio': { min: 1500, max: 4000 }, 'full-body': { min: 4000, max: 10000 } },
  },
]

const USERS = [
  { name: 'Ahmed Al-Rashidi', email: 'ahmed@gmail.com',  password: 'User@1234', phone: '+971501234567', company: 'Brand Co.',      status: 'active'  as const, isEmailVerified: true,  authProvider: 'email' as const, hasEmailPassword: true },
  { name: 'Sara Mohammed',    email: 'sara@outlook.com', password: 'User@1234', phone: '+966551234567', company: 'Digital Agency', status: 'active'  as const, isEmailVerified: true,  authProvider: 'email' as const, hasEmailPassword: true },
  { name: 'Khalid Ibrahim',   email: 'khalid@co.sa',     password: 'User@1234', phone: '+966541234567', company: 'KSA Brands',     status: 'blocked' as const, isEmailVerified: false, authProvider: 'email' as const, hasEmailPassword: true },
  { name: 'Layla Hassan',     email: 'layla@mkt.ae',     password: 'User@1234', phone: '+971551234567', company: 'Marketing Plus', status: 'pending' as const, isEmailVerified: false, authProvider: 'email' as const, hasEmailPassword: true },
  { name: 'Omar Farouq',      email: 'omar@brand.ae',    password: 'User@1234', phone: '+971561234567', company: 'Event Masters',  status: 'active'  as const, isEmailVerified: true,  authProvider: 'email' as const, hasEmailPassword: true },
  { name: 'Noura Al-Kuwari',  email: 'noura@company.qa', password: 'User@1234', phone: '+97451234567',  company: 'Qatar Ventures', status: 'active'  as const, isEmailVerified: true,  authProvider: 'email' as const, hasEmailPassword: true },
]

// ─── Main ─────────────────────────────────────────────────────

async function seed() {
  await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 5000 })
  console.log('Connected to MongoDB\n')

  // 1. Super Admin
  const existingAdmin = await Admin.findOne({ email: ADMIN_EMAIL })
  if (existingAdmin) {
    console.log(`[skip] Super Admin already exists: ${ADMIN_EMAIL}`)
  } else {
    await Admin.create({ name: ADMIN_NAME, email: ADMIN_EMAIL, password: ADMIN_PASSWORD, role: 'super-admin', isActive: true })
    console.log(`[ok]   Super Admin created: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`)
  }

  // 2. Celebrities
  const celebMap: Record<string, mongoose.Types.ObjectId> = {}
  for (const c of CELEBRITIES) {
    const existing = await Celebrity.findOne({ slug: c.slug })
    if (existing) {
      celebMap[c.slug] = existing._id as mongoose.Types.ObjectId
      if (!existing.thumbnailUrl && c.thumbnailUrl) {
        await Celebrity.findByIdAndUpdate(existing._id, { $set: { thumbnailUrl: c.thumbnailUrl } })
        console.log(`[patch] Celebrity thumbnailUrl updated: ${c.name}`)
      } else {
        console.log(`[skip] Celebrity already exists: ${c.name}`)
      }
    } else {
      const created = await Celebrity.create(c)
      celebMap[c.slug] = created._id as mongoose.Types.ObjectId
      console.log(`[ok]   Celebrity created: ${c.name}`)
    }
  }

  // 3. Users
  const userMap: Record<string, mongoose.Types.ObjectId> = {}
  for (const u of USERS) {
    const existing = await User.findOne({ email: u.email })
    if (existing) {
      userMap[u.email] = existing._id as mongoose.Types.ObjectId
      console.log(`[skip] User already exists: ${u.email}`)
    } else {
      const created = await User.create(u)
      userMap[u.email] = created._id as mongoose.Types.ObjectId
      console.log(`[ok]   User created: ${u.name} (${u.email})`)
    }
  }

  // 4. Video Jobs
  const VIDEO_JOBS = [
    { ref: 'TWN-2025-0001', userEmail: 'ahmed@gmail.com',  celebSlug: 'mohamed-salah',     productType: 'greeting'       as const, status: 'delivered'   as const, estimatedPrice: 1600,  downloadEnabled: true,  purpose: 'Brand campaign for Ramadan promotion' },
    { ref: 'TWN-2025-0002', userEmail: 'sara@outlook.com', celebSlug: 'cristiano-ronaldo', productType: 'full-body'      as const, status: 'in-progress' as const, estimatedPrice: 20000, downloadEnabled: false, purpose: 'Global sports brand advertisement' },
    { ref: 'TWN-2025-0003', userEmail: 'khalid@co.sa',     celebSlug: 'amr-diab',          productType: 'avatar-studio'  as const, status: 'review'      as const, estimatedPrice: 4000,  downloadEnabled: false, purpose: 'Product launch event invitation' },
    { ref: 'TWN-2025-0004', userEmail: 'layla@mkt.ae',     celebSlug: 'nancy-ajram',       productType: 'greeting'       as const, status: 'pending'     as const, estimatedPrice: 1000,  downloadEnabled: false, purpose: 'Birthday greeting for VIP client' },
    { ref: 'TWN-2025-0005', userEmail: 'omar@brand.ae',    celebSlug: 'mrbeast',           productType: 'greeting'       as const, status: 'delivered'   as const, estimatedPrice: 1650,  downloadEnabled: true,  purpose: 'Social media marketing campaign' },
    { ref: 'TWN-2025-0006', userEmail: 'noura@company.qa', celebSlug: 'haifa-wehbe',       productType: 'avatar-studio'  as const, status: 'failed'      as const, estimatedPrice: 2750,  downloadEnabled: false, purpose: 'Corporate entertainment event' },
  ]

  for (const j of VIDEO_JOBS) {
    const existing = await VideoJob.findOne({ referenceId: j.ref })
    if (existing) {
      console.log(`[skip] Video job already exists: ${j.ref}`)
      continue
    }
    const userId      = userMap[j.userEmail]
    const celebrityId = celebMap[j.celebSlug]
    if (!userId || !celebrityId) {
      console.log(`[warn] Skipping job ${j.ref} — missing user or celebrity`)
      continue
    }
    await VideoJob.create({
      referenceId:    j.ref,
      userId,
      celebrityId,
      productType:    j.productType,
      purpose:        j.purpose,
      script:         `Hi, this is a ${j.productType} video for ${j.purpose.toLowerCase()}.`,
      tone:           'professional',
      duration:       '30s',
      aspectRatio:    '16:9',
      resolution:     '1080p',
      status:         j.status,
      estimatedPrice: j.estimatedPrice,
      downloadEnabled: j.downloadEnabled,
      statusHistory:  [{ status: j.status, timestamp: new Date() }],
      ...(j.status === 'delivered' ? { deliveredAt: new Date() } : {}),
    })
    console.log(`[ok]   Video job created: ${j.ref} (${j.status})`)
  }

  // 5. Leads
  const LEADS = [
    { userEmail: 'ahmed@gmail.com',  celebName: 'Mohamed Salah',     productType: 'greeting',      purpose: 'Brand campaign',          estimatedValue: 4200,  status: 'new'         as const, source: 'book-call'    as const, phone: '+971501234567', company: 'Brand Co.'      },
    { userEmail: 'sara@outlook.com', celebName: 'Cristiano Ronaldo', productType: 'full-body',     purpose: 'Global advertisement',    estimatedValue: 18000, status: 'contacted'   as const, source: 'book-call'    as const, phone: '+966551234567', company: 'Digital Agency' },
    { userEmail: 'khalid@co.sa',     celebName: 'Amr Diab',          productType: 'avatar-studio', purpose: 'Product launch',          estimatedValue: 8500,  status: 'negotiating' as const, source: 'book-call'    as const, phone: '+966541234567', company: 'KSA Brands'     },
    { userEmail: 'layla@mkt.ae',     celebName: 'Nancy Ajram',       productType: 'greeting',      purpose: 'VIP birthday greeting',   estimatedValue: 1500,  status: 'paid'        as const, source: 'book-call'    as const, phone: '+971551234567', company: 'Marketing Plus' },
    { userEmail: 'omar@brand.ae',    celebName: 'MrBeast',           productType: 'greeting',      purpose: 'Social media campaign',   estimatedValue: 800,   status: 'closed'      as const, source: 'contact-form' as const, phone: '+971561234567', company: 'Event Masters'  },
    { userEmail: 'noura@company.qa', celebName: 'Haifa Wehbe',       productType: 'avatar-studio', purpose: 'Corporate entertainment', estimatedValue: 1200,  status: 'lost'        as const, source: 'book-call'    as const, phone: '+97451234567',  company: 'Qatar Ventures' },
  ]

  for (const l of LEADS) {
    const existing = await Lead.findOne({ email: USERS.find(u => u.email === l.userEmail)?.email, celebrityName: l.celebName })
    if (existing) {
      console.log(`[skip] Lead already exists: ${l.userEmail} / ${l.celebName}`)
      continue
    }
    const user = USERS.find(u => u.email === l.userEmail)
    await Lead.create({
      name:           user?.name || l.userEmail,
      email:          l.userEmail,
      phone:          l.phone,
      company:        l.company,
      celebrityName:  l.celebName,
      productType:    l.productType,
      purpose:        l.purpose,
      estimatedValue: l.estimatedValue,
      status:         l.status,
      source:         l.source,
      statusHistory:  [{ status: l.status, timestamp: new Date() }],
    })
    console.log(`[ok]   Lead created: ${user?.name} → ${l.celebName} (${l.status})`)
  }

  console.log('\nSeeding complete.')
  await mongoose.disconnect()
}

seed().catch(err => {
  console.error('Seeder failed:', err)
  process.exit(1)
})
