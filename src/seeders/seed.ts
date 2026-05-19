import dotenv from 'dotenv'
dotenv.config()

import bcrypt from 'bcryptjs'
import prisma from '../lib/prisma'

const ADMIN_EMAIL    = process.env.ADMIN_EMAIL    || 'admin@twinity.ai'
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Admin@1234'
const ADMIN_NAME     = process.env.ADMIN_NAME     || 'Super Admin'
const CLIENT_URL     = process.env.CLIENT_URL     || 'http://localhost:3000'

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
    bio: "Global football icon and five-time Ballon d'Or winner.",
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
    bio: "World's most subscribed YouTuber with viral philanthropic content.",
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
  await prisma.$connect()
  console.log('Connected to PostgreSQL\n')

  // 1. Super Admin
  const existingAdmin = await prisma.admin.findUnique({ where: { email: ADMIN_EMAIL } })
  if (existingAdmin) {
    console.log(`[skip] Super Admin already exists: ${ADMIN_EMAIL}`)
  } else {
    const hashedPw = await bcrypt.hash(ADMIN_PASSWORD, 12)
    await prisma.admin.create({
      data: { name: ADMIN_NAME, email: ADMIN_EMAIL, password: hashedPw, role: 'super_admin', isActive: true },
    })
    console.log(`[ok]   Super Admin created: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`)
  }

  // 2. Celebrities
  const celebMap: Record<string, string> = {}
  for (const c of CELEBRITIES) {
    const existing = await prisma.celebrity.findUnique({ where: { slug: c.slug } })
    if (existing) {
      celebMap[c.slug] = existing.id
      if (!existing.thumbnailUrl && c.thumbnailUrl) {
        await prisma.celebrity.update({ where: { id: existing.id }, data: { thumbnailUrl: c.thumbnailUrl } })
        console.log(`[patch] Celebrity thumbnailUrl updated: ${c.name}`)
      } else {
        console.log(`[skip] Celebrity already exists: ${c.name}`)
      }
    } else {
      const created = await prisma.celebrity.create({
        data: {
          name:          c.name,
          nameAr:        c.nameAr,
          slug:          c.slug,
          industry:      c.industry,
          nationality:   c.nationality,
          nationalityAr: c.nationalityAr,
          languages:     c.languages,
          tags:          c.tags,
          tagsAr:        c.tagsAr,
          bio:           c.bio,
          bioAr:         c.bioAr,
          initials:      c.initials,
          avatarColor:   c.avatarColor,
          thumbnailUrl:  c.thumbnailUrl,
          isActive:      c.isActive,
          isFeatured:    c.isFeatured,
          totalOrders:   c.totalOrders,
          priceRange:    c.priceRange,
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
          name:             u.name,
          email:            u.email,
          password:         hashedPw,
          phone:            u.phone,
          company:          u.company,
          status:           u.status,
          isEmailVerified:  u.isEmailVerified,
          authProvider:     u.authProvider,
          hasEmailPassword: u.hasEmailPassword,
        },
      })
      userMap[u.email] = created.id
      console.log(`[ok]   User created: ${u.name} (${u.email})`)
    }
  }

  // 4. Video Jobs
  const VIDEO_JOBS = [
    { ref: 'TWN-2025-0001', userEmail: 'ahmed@gmail.com',  celebSlug: 'mohamed-salah',     productType: 'greeting'       as const, status: 'delivered'   as const, estimatedPrice: 1600,  downloadEnabled: true,  purpose: 'Brand campaign for Ramadan promotion' },
    { ref: 'TWN-2025-0002', userEmail: 'sara@outlook.com', celebSlug: 'cristiano-ronaldo', productType: 'full_body'      as const, status: 'in_progress' as const, estimatedPrice: 20000, downloadEnabled: false, purpose: 'Global sports brand advertisement' },
    { ref: 'TWN-2025-0003', userEmail: 'khalid@co.sa',     celebSlug: 'amr-diab',          productType: 'avatar_studio'  as const, status: 'review'      as const, estimatedPrice: 4000,  downloadEnabled: false, purpose: 'Product launch event invitation' },
    { ref: 'TWN-2025-0004', userEmail: 'layla@mkt.ae',     celebSlug: 'nancy-ajram',       productType: 'greeting'       as const, status: 'pending'     as const, estimatedPrice: 1000,  downloadEnabled: false, purpose: 'Birthday greeting for VIP client' },
    { ref: 'TWN-2025-0005', userEmail: 'omar@brand.ae',    celebSlug: 'mrbeast',           productType: 'greeting'       as const, status: 'delivered'   as const, estimatedPrice: 1650,  downloadEnabled: true,  purpose: 'Social media marketing campaign' },
    { ref: 'TWN-2025-0006', userEmail: 'noura@company.qa', celebSlug: 'haifa-wehbe',       productType: 'avatar_studio'  as const, status: 'failed'      as const, estimatedPrice: 2750,  downloadEnabled: false, purpose: 'Corporate entertainment event' },
  ]

  for (const j of VIDEO_JOBS) {
    const existing = await prisma.videoJob.findUnique({ where: { referenceId: j.ref } })
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
    await prisma.videoJob.create({
      data: {
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
        statusHistory:  [{ status: j.status, timestamp: new Date().toISOString() }],
        ...(j.status === 'delivered' ? { deliveredAt: new Date() } : {}),
      },
    })
    console.log(`[ok]   Video job created: ${j.ref} (${j.status})`)
  }

  // 5. Leads
  const LEADS = [
    { userEmail: 'ahmed@gmail.com',  celebName: 'Mohamed Salah',     productType: 'greeting',      purpose: 'Brand campaign',          estimatedValue: 4200,  status: 'new'         as const, source: 'book_call'    as const, phone: '+971501234567', company: 'Brand Co.'      },
    { userEmail: 'sara@outlook.com', celebName: 'Cristiano Ronaldo', productType: 'full-body',     purpose: 'Global advertisement',    estimatedValue: 18000, status: 'contacted'   as const, source: 'book_call'    as const, phone: '+966551234567', company: 'Digital Agency' },
    { userEmail: 'khalid@co.sa',     celebName: 'Amr Diab',          productType: 'avatar-studio', purpose: 'Product launch',          estimatedValue: 8500,  status: 'negotiating' as const, source: 'book_call'    as const, phone: '+966541234567', company: 'KSA Brands'     },
    { userEmail: 'layla@mkt.ae',     celebName: 'Nancy Ajram',       productType: 'greeting',      purpose: 'VIP birthday greeting',   estimatedValue: 1500,  status: 'paid'        as const, source: 'book_call'    as const, phone: '+971551234567', company: 'Marketing Plus' },
    { userEmail: 'omar@brand.ae',    celebName: 'MrBeast',           productType: 'greeting',      purpose: 'Social media campaign',   estimatedValue: 800,   status: 'closed'      as const, source: 'contact_form' as const, phone: '+971561234567', company: 'Event Masters'  },
    { userEmail: 'noura@company.qa', celebName: 'Haifa Wehbe',       productType: 'avatar-studio', purpose: 'Corporate entertainment', estimatedValue: 1200,  status: 'lost'        as const, source: 'book_call'    as const, phone: '+97451234567',  company: 'Qatar Ventures' },
  ]

  for (const l of LEADS) {
    const existing = await prisma.lead.findFirst({ where: { email: l.userEmail, celebrityName: l.celebName } })
    if (existing) {
      console.log(`[skip] Lead already exists: ${l.userEmail} / ${l.celebName}`)
      continue
    }
    const user = USERS.find(u => u.email === l.userEmail)
    await prisma.lead.create({
      data: {
        userId:         userMap[l.userEmail],
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
        statusHistory:  [{ status: l.status, timestamp: new Date().toISOString() }],
      },
    })
    console.log(`[ok]   Lead created: ${user?.name} → ${l.celebName} (${l.status})`)
  }

  // 6. Prompt Templates
  const TEMPLATES = [
    {
      name: 'Birthday Wish',
      nameAr: 'تهنئة عيد الميلاد',
      description: 'A warm, personalised birthday greeting from a celebrity to a fan or loved one.',
      descriptionAr: 'تهنئة عيد ميلاد دافئة وشخصية من نجم مشهور لمعجب أو شخص عزيز.',
      purpose: 'Birthday Wish',
      purposeAr: 'تهنئة عيد الميلاد',
      sampleScript: `Hey [Name]! It's me, and I just wanted to take a moment to wish you the most amazing birthday ever. You deserve every bit of happiness today and always. Keep chasing your dreams — you've got what it takes. Happy Birthday, superstar!`,
      sampleScriptAr: `مرحباً [الاسم]! أنا هنا لأتمنى لك عيد ميلاد رائع ومميز. أنت تستحق كل سعادة اليوم وكل يوم. استمر في السعي نحو أحلامك — لديك كل ما يلزم. عيد ميلاد سعيد يا نجم!`,
      productTypes: ['greeting'],
      duration: '30s',
      isActive: true,
    },
    {
      name: 'Ramadan & Eid Greeting',
      nameAr: 'تهنئة رمضان والعيد',
      description: 'A heartfelt seasonal greeting for Ramadan or Eid celebrations, perfect for the Arab market.',
      descriptionAr: 'تهنئة موسمية صادقة لشهر رمضان أو عيد الفطر، مثالية للسوق العربي.',
      purpose: 'Holiday Greeting',
      purposeAr: 'تهنئة موسمية',
      sampleScript: `Ramadan Kareem, everyone! This holy month is a time for reflection, gratitude, and being close to the people we love. I'm wishing you and your entire family a blessed Ramadan filled with peace, joy, and countless blessings. Ramadan Mubarak!`,
      sampleScriptAr: `رمضان كريم يا أصدقاء! هذا الشهر الكريم هو وقت للتأمل والامتنان والقرب من من نحبهم. أتمنى لكم ولعائلتكم رمضاناً مباركاً مليئاً بالسلام والبهجة والبركات. رمضان مبارك!`,
      productTypes: ['greeting', 'avatar-studio'],
      duration: '30s',
      isActive: true,
    },
    {
      name: 'Congratulations',
      nameAr: 'مبروك',
      description: 'A celebratory message for achievements such as graduation, promotion, or a new business.',
      descriptionAr: 'رسالة احتفالية للإنجازات كالتخرج أو الترقية أو بدء مشروع جديد.',
      purpose: 'Congratulations',
      purposeAr: 'تهنئة بالإنجاز',
      sampleScript: `[Name], congratulations! What you've achieved is no small thing — it takes real dedication, hard work, and heart to get there. I'm proud of you and I know this is just the beginning of something incredible. Well done, and keep going!`,
      sampleScriptAr: `[الاسم]، مبروك! ما حققته ليس أمراً بسيطاً — يتطلب تفانياً حقيقياً وعملاً دؤوباً وشجاعة للوصول إلى هنا. أنا فخور بك وأعلم أن هذه مجرد البداية لشيء رائع. أحسنت، واستمر في التقدم!`,
      productTypes: ['greeting', 'avatar-studio'],
      duration: '30s',
      isActive: true,
    },
    {
      name: 'Motivational Shoutout',
      nameAr: 'رسالة تحفيزية',
      description: 'A high-energy motivational message to inspire someone to push through challenges.',
      descriptionAr: 'رسالة تحفيزية عالية الطاقة لإلهام شخص ما لتجاوز التحديات.',
      purpose: 'Motivation',
      purposeAr: 'تحفيز وإلهام',
      sampleScript: `Listen, [Name] — I need you to hear this: you are capable of more than you know. Every champion has been exactly where you are right now, doubting themselves, feeling the pressure. But the ones who make it are the ones who don't quit. Get up. Keep going. The world needs what only you can bring.`,
      sampleScriptAr: `اسمعني يا [الاسم] — أحتاج منك أن تستمع لهذا: أنت قادر على أكثر مما تتخيل. كل بطل كان في مكانك تماماً، يشك في نفسه، يشعر بالضغط. لكن من ينجحون هم من لا يستسلمون. قم. استمر. العالم يحتاج ما لا يستطيع أحد تقديمه غيرك.`,
      productTypes: ['greeting', 'avatar-studio', 'full-body'],
      duration: '45s',
      isActive: true,
    },
    {
      name: 'Product Launch Announcement',
      nameAr: 'إطلاق منتج جديد',
      description: 'A compelling celebrity-led announcement for a new product or service launch.',
      descriptionAr: 'إعلان جذاب بقيادة نجم مشهور لإطلاق منتج أو خدمة جديدة.',
      purpose: 'Product Launch',
      purposeAr: 'إطلاق منتج',
      sampleScript: `I'm excited to tell you about something that's genuinely changing the game — [Product Name]. I've seen a lot of products come and go, but this one is different. It's built for people who want results, not excuses. I use it myself and the difference is real. Go check it out at [Website] — trust me, you won't regret it.`,
      sampleScriptAr: `أنا متحمس لأخبركم عن شيء يغير قواعد اللعبة حقاً — [اسم المنتج]. رأيت الكثير من المنتجات تأتي وتذهب، لكن هذا مختلف. صُنع للأشخاص الذين يريدون نتائج حقيقية. أستخدمه بنفسي والفرق واضح. اذهب وتحقق منه على [الموقع] — ثق بي، لن تندم.`,
      productTypes: ['avatar-studio', 'full-body'],
      duration: '60s',
      isActive: true,
    },
    {
      name: 'Brand Endorsement',
      nameAr: 'تأييد علامة تجارية',
      description: 'A professional brand endorsement video for corporate clients and advertisers.',
      descriptionAr: 'فيديو احترافي للمصادقة على علامة تجارية للعملاء المؤسسيين والمعلنين.',
      purpose: 'Business Intro',
      purposeAr: 'تقديم تجاري',
      sampleScript: `When it comes to [Brand Name], I don't just talk about it — I believe in it. They stand for quality, for excellence, and for the kind of standards that I hold myself to every single day. If you're looking for the best in [industry/category], look no further. [Brand Name] — this is the real deal.`,
      sampleScriptAr: `عندما يتعلق الأمر بـ[اسم العلامة التجارية]، أنا لا أتحدث عنها فحسب — بل أؤمن بها. إنها تمثل الجودة والتميز والمعايير التي أحمل نفسي عليها كل يوم. إذا كنت تبحث عن الأفضل في [القطاع/الفئة]، لا تبحث أكثر. [اسم العلامة التجارية] — هذا هو الأصل.`,
      productTypes: ['avatar-studio', 'full-body'],
      duration: '45s',
      isActive: true,
    },
    {
      name: 'Wedding Congratulations',
      nameAr: 'تهنئة الزواج',
      description: 'A romantic and memorable wedding congratulations from a celebrity for the happy couple.',
      descriptionAr: 'تهنئة زواج رومانسية ولا تُنسى من نجم مشهور للزوجين السعيدين.',
      purpose: 'Wedding',
      purposeAr: 'تهنئة الزواج',
      sampleScript: `[Groom] and [Bride], congratulations on your wedding day! Today you're not just starting a new chapter — you're beginning the greatest adventure of your lives together. Love each other deeply, laugh often, and face every challenge as a team. Wishing you a lifetime of happiness, joy, and beautiful memories. You make a truly wonderful couple!`,
      sampleScriptAr: `[اسم العريس] و[اسم العروس]، مبروك يوم زفافكم! اليوم أنتم لا تبدأون فصلاً جديداً فحسب — بل تبدأون أعظم مغامرة في حياتكم معاً. أحبا بعضكما بعمق، واضحكا كثيراً، وواجها كل تحدٍ كفريق واحد. أتمنى لكم حياة مليئة بالسعادة والبهجة والذكريات الجميلة. أنتما زوجان رائعان حقاً!`,
      productTypes: ['greeting'],
      duration: '45s',
      isActive: true,
    },
    {
      name: 'Business Opening & Grand Launch',
      nameAr: 'افتتاح عمل تجاري',
      description: 'An exciting grand opening message for a new business, store, or restaurant.',
      descriptionAr: 'رسالة افتتاح رائعة لعمل تجاري أو متجر أو مطعم جديد.',
      purpose: 'Business Intro',
      purposeAr: 'تقديم عمل تجاري',
      sampleScript: `Something exciting is happening — [Business Name] is officially open! I've seen what the team behind this has built and I'm telling you, it's something special. Whether you're looking for [product/service], this is the place to be. Come check it out, support [Name] and what they've worked so hard to create. Congratulations on the grand opening — this is just the beginning!`,
      sampleScriptAr: `شيء مثير للاهتمام يحدث — [اسم العمل التجاري] افتتح رسمياً! رأيت ما بناه الفريق وراء هذا وأقول لكم إنه شيء مميز. سواء كنت تبحث عن [المنتج/الخدمة]، هذا هو المكان المناسب. تعالوا وتفقدوا وادعموا [الاسم] وما عمل بجد لإنشائه. مبروك على الافتتاح الرسمي — هذه مجرد البداية!`,
      productTypes: ['avatar-studio', 'full-body'],
      duration: '60s',
      isActive: true,
    },
    {
      name: 'Thank You Message',
      nameAr: 'رسالة شكر',
      description: 'A sincere thank-you message to express gratitude to a person, team, or community.',
      descriptionAr: 'رسالة شكر صادقة للتعبير عن الامتنان لشخص أو فريق أو مجتمع.',
      purpose: 'Thank You',
      purposeAr: 'رسالة شكر',
      sampleScript: `[Name], I want you to know how much your support means to me — and to all of us. People like you are the reason we keep pushing. The loyalty, the energy, the love you bring — it never goes unnoticed. From the bottom of my heart, thank you. This one's for you.`,
      sampleScriptAr: `[الاسم]، أريدك أن تعلم مدى أهمية دعمك لي — ولنا جميعاً. أشخاص مثلك هم السبب الذي يجعلنا نستمر. الولاء والطاقة والمحبة التي تجلبها — لا تمر دون أن نلاحظها أبداً. من أعماق قلبي، شكراً لك. هذه لك.`,
      productTypes: ['greeting'],
      duration: '30s',
      isActive: true,
    },
    {
      name: 'Sports Team Shoutout',
      nameAr: 'تشجيع فريق رياضي',
      description: 'A high-energy shoutout to a sports team, club, or athlete to fire them up for a big match.',
      descriptionAr: 'تشجيع بطاقة عالية لفريق رياضي أو نادٍ أو رياضي استعداداً لمباراة كبيرة.',
      purpose: 'Shoutout',
      purposeAr: 'تشجيع رياضي',
      sampleScript: `[Team Name] — I'm talking to you. You've trained for this. You've sacrificed for this. Every early morning, every tough session, every moment of doubt — it all led to right now. Go out there and show the world what you're made of. Believe in each other. Fight for every second. Let's go — you've got this!`,
      sampleScriptAr: `[اسم الفريق] — أتحدث إليكم. لقد تدربتم من أجل هذا. ضحيتم من أجل هذا. كل صباح مبكر، كل جلسة صعبة، كل لحظة شك — كل ذلك قاد إلى هذه اللحظة. اخرجوا وأروا العالم ما أنتم عليه. ثقوا ببعضكم. قاتلوا في كل ثانية. هيا — أنتم قادرون!`,
      productTypes: ['greeting', 'avatar-studio'],
      duration: '30s',
      isActive: true,
    },
    {
      name: 'Graduation Celebration',
      nameAr: 'احتفال بالتخرج',
      description: 'A proud and inspiring graduation congratulations message for students and their families.',
      descriptionAr: 'رسالة تهنئة تخرج فخورة وملهمة للطلاب وعائلاتهم.',
      purpose: 'Graduation',
      purposeAr: 'تهنئة التخرج',
      sampleScript: `[Name], you did it! Graduation day is here and I couldn't be more proud of you. All those late nights studying, all those moments of pressure — they shaped you into the person standing here today. This degree is yours. The future is yours. Go out there and change the world — it's waiting for you.`,
      sampleScriptAr: `[الاسم]، أنجزت المهمة! يوم التخرج وصل ولا يمكنني أن أكون أكثر فخراً بك. كل تلك الليالي المتأخرة في الدراسة، كل لحظات الضغط — شكّلتك لتصبح الشخص الواقف هنا اليوم. هذه الشهادة لك. المستقبل لك. اذهب وغيّر العالم — إنه ينتظرك.`,
      productTypes: ['greeting'],
      duration: '30s',
      isActive: true,
    },
    {
      name: 'Corporate Event & Conference Invite',
      nameAr: 'دعوة فعالية أو مؤتمر',
      description: 'A professional celebrity-led invite to drive attendance at corporate events and conferences.',
      descriptionAr: 'دعوة احترافية بقيادة نجم مشهور لزيادة الحضور في الفعاليات والمؤتمرات.',
      purpose: 'Business Intro',
      purposeAr: 'دعوة فعالية',
      sampleScript: `I want to personally invite you to [Event Name], happening on [Date] in [Location]. This isn't just another event — it's where the biggest names in [industry] come together to share ideas, make connections, and shape the future. Don't miss your chance to be part of something historic. Register now at [Website] — I'll see you there.`,
      sampleScriptAr: `أريد أن أدعوك شخصياً إلى [اسم الفعالية]، التي تقام في [التاريخ] في [الموقع]. هذه ليست مجرد فعالية عادية — إنها المكان الذي تجتمع فيه أكبر الأسماء في [القطاع] لتبادل الأفكار وبناء العلاقات وتشكيل المستقبل. لا تفوّت فرصتك للمشاركة في شيء تاريخي. سجّل الآن على [الموقع] — سأراك هناك.`,
      productTypes: ['avatar-studio', 'full-body'],
      duration: '60s',
      isActive: true,
    },
    {
      name: 'New Year Message',
      nameAr: 'رسالة رأس السنة',
      description: 'An inspirational new year message to reflect on the past and embrace the year ahead.',
      descriptionAr: 'رسالة ملهمة لرأس السنة للتأمل في الماضي واحتضان العام القادم.',
      purpose: 'Holiday Greeting',
      purposeAr: 'تهنئة رأس السنة',
      sampleScript: `Happy New Year! A brand new year means a brand new chapter — and this one is yours to write. Leave behind whatever held you back, carry forward everything that made you strong, and step into this year with confidence and courage. Make it count. Happy New Year — let's make this one unforgettable.`,
      sampleScriptAr: `كل عام وأنتم بخير! عام جديد يعني فصلاً جديداً — وهذا الفصل لك لتكتبه. اترك خلفك ما أعاقك، واحمل معك كل ما جعلك أقوى، وادخل هذا العام بثقة وشجاعة. اجعله مميزاً. كل عام وأنتم بخير — لنجعل هذا العام لا يُنسى.`,
      productTypes: ['greeting', 'avatar-studio'],
      duration: '30s',
      isActive: true,
    },
  ]

  for (const t of TEMPLATES) {
    const existing = await prisma.template.findFirst({ where: { name: t.name } })
    if (existing) {
      console.log(`[skip] Template already exists: ${t.name}`)
    } else {
      await prisma.template.create({ data: t })
      console.log(`[ok]   Template created: ${t.name}`)
    }
  }

  console.log('\nSeeding complete.')
  await prisma.$disconnect()
}

seed().catch(err => {
  console.error('Seeder failed:', err)
  process.exit(1)
})
