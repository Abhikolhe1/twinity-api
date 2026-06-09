import dotenv from 'dotenv'
dotenv.config()

import bcrypt from 'bcryptjs'
import { VideoJobProductType, VideoJobStatus } from '@prisma/client'
import prisma from '../lib/prisma'

const ADMIN_EMAIL    = process.env.ADMIN_EMAIL    || 'admin@twinity.ai'
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Admin@1234'
const ADMIN_NAME     = process.env.ADMIN_NAME     || 'Super Admin'
const CLIENT_URL     = process.env.CLIENT_URL     || 'http://localhost:3000'

const CELEBRITIES = [
  {
    name: 'Cristiano Ronaldo', slug: 'cristiano-ronaldo',
    industry: 'sports', nationality: 'Portuguese',
    languages: ['en', 'pt'], tags: ['football', 'sports', 'global'],
    initials: 'CR', avatar_color: 'linear-gradient(135deg,#1a73e8,#0d47a1)',
    thumbnail_url: `${CLIENT_URL}/celebs/cr7.svg`,
    is_active: true, is_featured: true, total_orders: 34,
    bio: "Global football icon and five-time Ballon d'Or winner.",
    price_range: { greeting: { min: 1200, max: 3500 }, 'video-ad': { min: 4000, max: 10000 } },
  },
  {
    name: 'Mohamed Salah', slug: 'mohamed-salah',
    industry: 'sports', nationality: 'Egyptian',
    languages: ['ar', 'en'], tags: ['football', 'sports', 'arabic'],
    initials: 'MS', avatar_color: 'linear-gradient(135deg,#e53935,#b71c1c)',
    thumbnail_url: `${CLIENT_URL}/celebs/salah.svg`,
    is_active: true, is_featured: true, total_orders: 28,
    bio: 'Egyptian football king, Liverpool and Egypt captain.',
    price_range: { greeting: { min: 900, max: 2500 }, 'video-ad': { min: 3000, max: 8000 } },
  },
  {
    name: 'Amr Diab', slug: 'amr-diab',
    industry: 'music', nationality: 'Egyptian',
    languages: ['ar'], tags: ['music', 'arabic', 'pop'],
    initials: 'AD', avatar_color: 'linear-gradient(135deg,#f57c00,#e65100)',
    thumbnail_url: `${CLIENT_URL}/celebs/amr-diab.svg`,
    is_active: true, is_featured: false, total_orders: 17,
    bio: 'Legend of Arabic pop music with over 30 years of hits.',
    price_range: { greeting: { min: 600, max: 1800 }, 'video-ad': { min: 2000, max: 6000 } },
  },
  {
    name: 'Nancy Ajram', slug: 'nancy-ajram',
    industry: 'music', nationality: 'Lebanese',
    languages: ['ar', 'en'], tags: ['music', 'arabic', 'pop'],
    initials: 'NA', avatar_color: 'linear-gradient(135deg,#e91e8c,#ad1457)',
    thumbnail_url: `${CLIENT_URL}/celebs/nancy-ajram.svg`,
    is_active: true, is_featured: false, total_orders: 12,
    bio: 'Lebanese pop star known throughout the Arab world.',
    price_range: { greeting: { min: 500, max: 1500 }, 'video-ad': { min: 1800, max: 5000 } },
  },
  {
    name: 'MrBeast', slug: 'mrbeast',
    industry: 'social-media', nationality: 'American',
    languages: ['en'], tags: ['youtube', 'viral', 'social-media'],
    initials: 'MB', avatar_color: 'linear-gradient(135deg,#43a047,#1b5e20)',
    thumbnail_url: `${CLIENT_URL}/celebs/mrbeast.svg`,
    is_active: true, is_featured: false, total_orders: 9,
    bio: "World's most subscribed YouTuber with viral philanthropic content.",
    price_range: { greeting: { min: 800, max: 2500 }, 'video-ad': { min: 3000, max: 9000 } },
  },
  {
    name: 'Haifa Wehbe', slug: 'haifa-wehbe',
    industry: 'entertainment', nationality: 'Lebanese',
    languages: ['ar'], tags: ['music', 'entertainment', 'arabic'],
    initials: 'HW', avatar_color: 'linear-gradient(135deg,#7b1fa2,#4a148c)',
    thumbnail_url: `${CLIENT_URL}/celebs/haifa.svg`,
    is_active: false, is_featured: false, total_orders: 6,
    bio: 'Lebanese entertainment icon with a massive Middle East fanbase.',
    price_range: { greeting: { min: 400, max: 1200 }, 'video-ad': { min: 1500, max: 4000 } },
  },
]

const USERS = [
  { name: 'Ahmed Al-Rashidi', email: 'ahmed@gmail.com',  password: 'User@1234', phone: '+971501234567', company: 'Brand Co.',      status: 'active'  as const, is_email_verified: true,  auth_provider: 'email' as const, has_email_password: true },
  { name: 'Sara Mohammed',    email: 'sara@outlook.com', password: 'User@1234', phone: '+966551234567', company: 'Digital Agency', status: 'active'  as const, is_email_verified: true,  auth_provider: 'email' as const, has_email_password: true },
  { name: 'Khalid Ibrahim',   email: 'khalid@co.sa',     password: 'User@1234', phone: '+966541234567', company: 'KSA Brands',     status: 'blocked' as const, is_email_verified: false, auth_provider: 'email' as const, has_email_password: true },
  { name: 'Layla Hassan',     email: 'layla@mkt.ae',     password: 'User@1234', phone: '+971551234567', company: 'Marketing Plus', status: 'pending' as const, is_email_verified: false, auth_provider: 'email' as const, has_email_password: true },
  { name: 'Omar Farouq',      email: 'omar@brand.ae',    password: 'User@1234', phone: '+971561234567', company: 'Event Masters',  status: 'active'  as const, is_email_verified: true,  auth_provider: 'email' as const, has_email_password: true },
  { name: 'Noura Al-Kuwari',  email: 'noura@company.qa', password: 'User@1234', phone: '+97451234567',  company: 'Qatar Ventures', status: 'active'  as const, is_email_verified: true,  auth_provider: 'email' as const, has_email_password: true },
]

async function seed() {
  await prisma.$connect()
  console.log('Connected to PostgreSQL\n')

  // 1. Super Admin
  const existingAdmin = await prisma.admin.findUnique({ where: { email: ADMIN_EMAIL } })
  if (existingAdmin) {
    console.log(`[skip] Super Admin already exists: ${ADMIN_EMAIL}`)
  } else {
    const hashedPw = await bcrypt.hash(ADMIN_PASSWORD, 12)
    await prisma.admin.create({
      data: { name: ADMIN_NAME, email: ADMIN_EMAIL, password: hashedPw, role: 'super_admin', is_active: true },
    })
    console.log(`[ok]   Super Admin created: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`)
  }

  // 2. Celebrities
  const celebMap: Record<string, string> = {}
  for (const c of CELEBRITIES) {
    const existing = await prisma.celebrity.findUnique({ where: { slug: c.slug } })
    if (existing) {
      celebMap[c.slug] = existing.id
      if (!existing.thumbnail_url && c.thumbnail_url) {
        await prisma.celebrity.update({ where: { id: existing.id }, data: { thumbnail_url: c.thumbnail_url } })
        console.log(`[patch] Celebrity thumbnail_url updated: ${c.name}`)
      } else {
        console.log(`[skip] Celebrity already exists: ${c.name}`)
      }
    } else {
      const created = await prisma.celebrity.create({
        data: {
          name:        c.name,
          slug:        c.slug,
          industry:    c.industry,
          nationality: c.nationality,
          languages:   c.languages,
          tags:        c.tags,
          bio:         c.bio,
          initials:    c.initials,
          avatar_color:   c.avatar_color,
          thumbnail_url:  c.thumbnail_url,
          is_active:      c.is_active,
          is_featured:    c.is_featured,
          total_orders:   c.total_orders,
          price_range:    c.price_range,
        },
      })
      celebMap[c.slug] = created.id
      console.log(`[ok]   Celebrity created: ${c.name}`)
    }
  }

  // 3. Users
  const userMap: Record<string, string> = {}
  for (const u of USERS) {
    const existing = await prisma.user.findUnique({ where: { email: u.email } })
    if (existing) {
      userMap[u.email] = existing.id
      console.log(`[skip] User already exists: ${u.email}`)
    } else {
      const hashedPw = await bcrypt.hash(u.password, 12)
      const created = await prisma.user.create({
        data: {
          name:               u.name,
          email:              u.email,
          password:           hashedPw,
          phone:              u.phone,
          company:            u.company,
          status:             u.status,
          is_email_verified:  u.is_email_verified,
          auth_provider:      u.auth_provider,
          has_email_password: u.has_email_password,
        },
      })
      userMap[u.email] = created.id
      console.log(`[ok]   User created: ${u.name} (${u.email})`)
    }
  }

  // 4. Leads
  const LEADS = [
    { userEmail: 'ahmed@gmail.com',  celebrity_name: 'Mohamed Salah',     product_type: 'greeting',      purpose: 'Brand campaign',          estimated_value: 4200,  status: 'new'         as const, source: 'book_call'    as const, phone: '+971501234567', company: 'Brand Co.'      },
    { userEmail: 'sara@outlook.com', celebrity_name: 'Cristiano Ronaldo', product_type: 'video-ad',      purpose: 'Global advertisement',    estimated_value: 18000, status: 'contacted'   as const, source: 'book_call'    as const, phone: '+966551234567', company: 'Digital Agency' },
    { userEmail: 'khalid@co.sa',     celebrity_name: 'Amr Diab',          product_type: 'video-ad', purpose: 'Product launch',          estimated_value: 8500,  status: 'negotiating' as const, source: 'book_call'    as const, phone: '+966541234567', company: 'KSA Brands'     },
    { userEmail: 'layla@mkt.ae',     celebrity_name: 'Nancy Ajram',       product_type: 'greeting',      purpose: 'VIP birthday greeting',   estimated_value: 1500,  status: 'paid'        as const, source: 'book_call'    as const, phone: '+971551234567', company: 'Marketing Plus' },
    { userEmail: 'omar@brand.ae',    celebrity_name: 'MrBeast',           product_type: 'greeting',      purpose: 'Social media campaign',   estimated_value: 800,   status: 'closed'      as const, source: 'contact_form' as const, phone: '+971561234567', company: 'Event Masters'  },
    { userEmail: 'noura@company.qa', celebrity_name: 'Haifa Wehbe',       product_type: 'video-ad', purpose: 'Corporate entertainment', estimated_value: 1200,  status: 'lost'        as const, source: 'book_call'    as const, phone: '+97451234567',  company: 'Qatar Ventures' },
  ]

  for (const l of LEADS) {
    const existing = await prisma.lead.findFirst({ where: { email: l.userEmail, celebrity_name: l.celebrity_name } })
    if (existing) {
      console.log(`[skip] Lead already exists: ${l.userEmail} / ${l.celebrity_name}`)
      continue
    }
    const user = USERS.find(u => u.email === l.userEmail)
    await prisma.lead.create({
      data: {
        user_id:         userMap[l.userEmail],
        name:            user?.name || l.userEmail,
        email:           l.userEmail,
        phone:           l.phone,
        company:         l.company,
        celebrity_name:  l.celebrity_name,
        product_type:    l.product_type,
        purpose:         l.purpose,
        estimated_value: l.estimated_value,
        status:          l.status,
        source:          l.source,
        status_history:  [{ status: l.status, timestamp: new Date().toISOString() }],
      },
    })
    console.log(`[ok]   Lead created: ${user?.name} → ${l.celebrity_name} (${l.status})`)
  }

  // 5. Product Types
  const PRODUCT_TYPES = [
    {
      slug: 'greeting', name: 'Personal Greetings',
      description: 'Personal occasions',
      detail: 'Personalized celebrity messages for birthdays, weddings, graduations, and heartfelt appreciations.',
      icon: '🎉', price_from: 149,
      duration: 'Delivery in 1–2 business days',
      use_cases: ['Birthdays', 'Weddings', 'Graduations', 'Corporate Appreciation'],
      is_active: true, order: 0,
    },
    {
      slug: 'video-ad', name: 'Video Ad',
      description: 'Short celebrity Ad',
      detail: 'Hyper-realistic video avatars ideal for ads, product launches, and official announcements.',
      icon: '🎬', price_from: 299,
      duration: 'Delivery in 3–5 business days',
      use_cases: ['Brand Ads', 'Product Launches', 'Corporate Announcements', 'Social Media Posts'],
      is_active: true, order: 1,
    },
  ]

  for (const pt of PRODUCT_TYPES) {
    const existing = await prisma.productType.findUnique({ where: { slug: pt.slug } })
    if (existing) {
      await prisma.productType.update({ where: { slug: pt.slug }, data: { name: pt.name, is_active: pt.is_active } })
      console.log(`[ok]   Product type updated: ${pt.slug}`)
    } else {
      await prisma.productType.create({ data: pt })
      console.log(`[ok]   Product type created: ${pt.slug}`)
    }
  }

  // 6. Settings (key-value store defaults)
  const SETTINGS_DEFAULTS = [
    { key: 'platform_name',           value: 'Twinity',                  type: 'general'    },
    { key: 'support_email',           value: 'support@twinity.ai',       type: 'general'    },
    { key: 'admin_email',             value: ADMIN_EMAIL,                type: 'general'    },
    { key: 'eleven_labs_key',         value: '',                         type: 'ai'         },
    { key: 'creatify_api_id',         value: '',                         type: 'ai'         },
    { key: 'creatify_api_key',        value: '',                         type: 'ai'         },
    { key: 'openai_key',              value: '',                         type: 'ai'         },
    { key: 'gemini_api_key',          value: '',                         type: 'ai'         },
    { key: 'watermark_text',          value: 'twinity.ai · PREVIEW',     type: 'watermark'  },
    { key: 'watermark_opacity',       value: '0.35',                     type: 'watermark'  },
    { key: 'watermark_position',      value: 'Bottom Center',            type: 'watermark'  },
    { key: 'aws_access_key_id',       value: '',                         type: 's3'         },
    { key: 'aws_secret_access_key',   value: '',                         type: 's3'         },
    { key: 'aws_region',              value: 'us-east-1',                type: 's3'         },
    { key: 's3_bucket',               value: 'twinity-storage',          type: 's3'         },
    { key: 'script_improve_prompt',   value: '',                         type: 'ai_prompts' },
    { key: 'script_enhance_prompt',   value: '',                         type: 'ai_prompts' },
    { key: 'thumbnail_process_prompt',value: '',                         type: 'ai_prompts' },
  ]

  for (const s of SETTINGS_DEFAULTS) {
    const existing = await prisma.setting.findUnique({ where: { key: s.key } })
    if (existing) {
      console.log(`[skip] Setting already exists: ${s.key}`)
    } else {
      await prisma.setting.create({ data: s })
      console.log(`[ok]   Setting created: ${s.key}`)
    }
  }

  console.log('\nSeeding complete.')
  await prisma.$disconnect()
}

seed().catch(err => {
  console.error('Seeder failed:', err)
  process.exit(1)
})
