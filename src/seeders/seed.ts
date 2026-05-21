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
    name: 'Cristiano Ronaldo', name_ar: 'كريستيانو رونالدو', slug: 'cristiano-ronaldo',
    industry: 'sports', nationality: 'Portuguese', nationality_ar: 'برتغالي',
    languages: ['en', 'pt'], tags: ['football', 'sports', 'global'],
    tags_ar: ['كرة القدم', 'رياضة'],
    initials: 'CR', avatar_color: 'linear-gradient(135deg,#1a73e8,#0d47a1)',
    thumbnail_url: `${CLIENT_URL}/celebs/cr7.svg`,
    is_active: true, is_featured: true, total_orders: 34,
    bio: "Global football icon and five-time Ballon d'Or winner.",
    bio_ar: 'أيقونة كرة القدم العالمية والفائز بخمس جوائز الكرة الذهبية.',
    price_range: { greeting: { min: 1200, max: 3500 }, 'video-ad': { min: 4000, max: 10000 } },
  },
  {
    name: 'Mohamed Salah', name_ar: 'محمد صلاح', slug: 'mohamed-salah',
    industry: 'sports', nationality: 'Egyptian', nationality_ar: 'مصري',
    languages: ['ar', 'en'], tags: ['football', 'sports', 'arabic'],
    tags_ar: ['كرة القدم', 'رياضة', 'عربي'],
    initials: 'MS', avatar_color: 'linear-gradient(135deg,#e53935,#b71c1c)',
    thumbnail_url: `${CLIENT_URL}/celebs/salah.svg`,
    is_active: true, is_featured: true, total_orders: 28,
    bio: 'Egyptian football king, Liverpool and Egypt captain.',
    bio_ar: 'ملك الكرة المصري، قائد ليفربول ومنتخب مصر.',
    price_range: { greeting: { min: 900, max: 2500 }, 'video-ad': { min: 3000, max: 8000 } },
  },
  {
    name: 'Amr Diab', name_ar: 'عمرو دياب', slug: 'amr-diab',
    industry: 'music', nationality: 'Egyptian', nationality_ar: 'مصري',
    languages: ['ar'], tags: ['music', 'arabic', 'pop'],
    tags_ar: ['موسيقى', 'عربي', 'بوب'],
    initials: 'AD', avatar_color: 'linear-gradient(135deg,#f57c00,#e65100)',
    thumbnail_url: `${CLIENT_URL}/celebs/amr-diab.svg`,
    is_active: true, is_featured: false, total_orders: 17,
    bio: 'Legend of Arabic pop music with over 30 years of hits.',
    bio_ar: 'أسطورة الموسيقى العربية مع أكثر من 30 عاماً من النجاحات.',
    price_range: { greeting: { min: 600, max: 1800 }, 'video-ad': { min: 2000, max: 6000 } },
  },
  {
    name: 'Nancy Ajram', name_ar: 'نانسي عجرم', slug: 'nancy-ajram',
    industry: 'music', nationality: 'Lebanese', nationality_ar: 'لبنانية',
    languages: ['ar', 'en'], tags: ['music', 'arabic', 'pop'],
    tags_ar: ['موسيقى', 'عربي', 'بوب'],
    initials: 'NA', avatar_color: 'linear-gradient(135deg,#e91e8c,#ad1457)',
    thumbnail_url: `${CLIENT_URL}/celebs/nancy-ajram.svg`,
    is_active: true, is_featured: false, total_orders: 12,
    bio: 'Lebanese pop star known throughout the Arab world.',
    bio_ar: 'نجمة البوب اللبنانية المعروفة في جميع أنحاء العالم العربي.',
    price_range: { greeting: { min: 500, max: 1500 }, 'video-ad': { min: 1800, max: 5000 } },
  },
  {
    name: 'MrBeast', name_ar: 'مستر بيست', slug: 'mrbeast',
    industry: 'social-media', nationality: 'American', nationality_ar: 'أمريكي',
    languages: ['en'], tags: ['youtube', 'viral', 'social-media'],
    tags_ar: ['يوتيوب', 'فيروسي', 'سوشيال ميديا'],
    initials: 'MB', avatar_color: 'linear-gradient(135deg,#43a047,#1b5e20)',
    thumbnail_url: `${CLIENT_URL}/celebs/mrbeast.svg`,
    is_active: true, is_featured: false, total_orders: 9,
    bio: "World's most subscribed YouTuber with viral philanthropic content.",
    bio_ar: 'أكثر يوتيوبر اشتراكاً في العالم بمحتوى فيروسي.',
    price_range: { greeting: { min: 800, max: 2500 }, 'video-ad': { min: 3000, max: 9000 } },
  },
  {
    name: 'Haifa Wehbe', name_ar: 'هيفاء وهبي', slug: 'haifa-wehbe',
    industry: 'entertainment', nationality: 'Lebanese', nationality_ar: 'لبنانية',
    languages: ['ar'], tags: ['music', 'entertainment', 'arabic'],
    tags_ar: ['موسيقى', 'ترفيه', 'عربي'],
    initials: 'HW', avatar_color: 'linear-gradient(135deg,#7b1fa2,#4a148c)',
    thumbnail_url: `${CLIENT_URL}/celebs/haifa.svg`,
    is_active: false, is_featured: false, total_orders: 6,
    bio: 'Lebanese entertainment icon with a massive Middle East fanbase.',
    bio_ar: 'أيقونة الترفيه اللبنانية بقاعدة جماهيرية ضخمة في الشرق الأوسط.',
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
          name:           c.name,
          name_ar:        c.name_ar,
          slug:           c.slug,
          industry:       c.industry,
          nationality:    c.nationality,
          nationality_ar: c.nationality_ar,
          languages:      c.languages,
          tags:           c.tags,
          tags_ar:        c.tags_ar,
          bio:            c.bio,
          bio_ar:         c.bio_ar,
          initials:       c.initials,
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

  // 5. Templates
  const TEMPLATES = [
    {
      name: 'Birthday Wish', name_ar: 'تهنئة عيد الميلاد',
      description: 'A warm, personalised birthday greeting from a celebrity to a fan or loved one.',
      description_ar: 'تهنئة عيد ميلاد دافئة وشخصية من نجم مشهور لمعجب أو شخص عزيز.',
      purpose: 'Birthday Wish', purpose_ar: 'تهنئة عيد الميلاد',
      sample_script: `Hey [Name]! It's me, and I just wanted to take a moment to wish you the most amazing birthday ever. You deserve every bit of happiness today and always. Keep chasing your dreams — you've got what it takes. Happy Birthday, superstar!`,
      sample_script_ar: `مرحباً [الاسم]! أنا هنا لأتمنى لك عيد ميلاد رائع ومميز. أنت تستحق كل سعادة اليوم وكل يوم. استمر في السعي نحو أحلامك — لديك كل ما يلزم. عيد ميلاد سعيد يا نجم!`,
      product_types: ['greeting'], duration: '30s', is_active: true,
    },
    {
      name: 'Ramadan & Eid Greeting', name_ar: 'تهنئة رمضان والعيد',
      description: 'A heartfelt seasonal greeting for Ramadan or Eid celebrations, perfect for the Arab market.',
      description_ar: 'تهنئة موسمية صادقة لشهر رمضان أو عيد الفطر، مثالية للسوق العربي.',
      purpose: 'Holiday Greeting', purpose_ar: 'تهنئة موسمية',
      sample_script: `Ramadan Kareem, everyone! This holy month is a time for reflection, gratitude, and being close to the people we love. I'm wishing you and your entire family a blessed Ramadan filled with peace, joy, and countless blessings. Ramadan Mubarak!`,
      sample_script_ar: `رمضان كريم يا أصدقاء! هذا الشهر الكريم هو وقت للتأمل والامتنان والقرب من من نحبهم. أتمنى لكم ولعائلتكم رمضاناً مباركاً مليئاً بالسلام والبهجة والبركات. رمضان مبارك!`,
      product_types: ['greeting', 'video-ad'], duration: '30s', is_active: true,
    },
    {
      name: 'Congratulations', name_ar: 'مبروك',
      description: 'A celebratory message for achievements such as graduation, promotion, or a new business.',
      description_ar: 'رسالة احتفالية للإنجازات كالتخرج أو الترقية أو بدء مشروع جديد.',
      purpose: 'Congratulations', purpose_ar: 'تهنئة بالإنجاز',
      sample_script: `[Name], congratulations! What you've achieved is no small thing — it takes real dedication, hard work, and heart to get there. I'm proud of you and I know this is just the beginning of something incredible. Well done, and keep going!`,
      sample_script_ar: `[الاسم]، مبروك! ما حققته ليس أمراً بسيطاً — يتطلب تفانياً حقيقياً وعملاً دؤوباً وشجاعة للوصول إلى هنا. أنا فخور بك وأعلم أن هذه مجرد البداية لشيء رائع. أحسنت، واستمر في التقدم!`,
      product_types: ['greeting', 'video-ad'], duration: '30s', is_active: true,
    },
    {
      name: 'Motivational Shoutout', name_ar: 'رسالة تحفيزية',
      description: 'A high-energy motivational message to inspire someone to push through challenges.',
      description_ar: 'رسالة تحفيزية عالية الطاقة لإلهام شخص ما لتجاوز التحديات.',
      purpose: 'Motivation', purpose_ar: 'تحفيز وإلهام',
      sample_script: `Listen, [Name] — I need you to hear this: you are capable of more than you know. Every champion has been exactly where you are right now, doubting themselves, feeling the pressure. But the ones who make it are the ones who don't quit. Get up. Keep going. The world needs what only you can bring.`,
      sample_script_ar: `اسمعني يا [الاسم] — أحتاج منك أن تستمع لهذا: أنت قادر على أكثر مما تتخيل. كل بطل كان في مكانك تماماً، يشك في نفسه، يشعر بالضغط. لكن من ينجحون هم من لا يستسلمون. قم. استمر. العالم يحتاج ما لا يستطيع أحد تقديمه غيرك.`,
      product_types: ['greeting', 'video-ad'], duration: '45s', is_active: true,
    },
    {
      name: 'Product Launch Announcement', name_ar: 'إطلاق منتج جديد',
      description: 'A compelling celebrity-led announcement for a new product or service launch.',
      description_ar: 'إعلان جذاب بقيادة نجم مشهور لإطلاق منتج أو خدمة جديدة.',
      purpose: 'Product Launch', purpose_ar: 'إطلاق منتج',
      sample_script: `I'm excited to tell you about something that's genuinely changing the game — [Product Name]. I've seen a lot of products come and go, but this one is different. It's built for people who want results, not excuses. I use it myself and the difference is real. Go check it out at [Website] — trust me, you won't regret it.`,
      sample_script_ar: `أنا متحمس لأخبركم عن شيء يغير قواعد اللعبة حقاً — [اسم المنتج]. رأيت الكثير من المنتجات تأتي وتذهب، لكن هذا مختلف. صُنع للأشخاص الذين يريدون نتائج حقيقية. أستخدمه بنفسي والفرق واضح. اذهب وتحقق منه على [الموقع] — ثق بي، لن تندم.`,
      product_types: ['video-ad'], duration: '60s', is_active: true,
    },
    {
      name: 'Brand Endorsement', name_ar: 'تأييد علامة تجارية',
      description: 'A professional brand endorsement video for corporate clients and advertisers.',
      description_ar: 'فيديو احترافي للمصادقة على علامة تجارية للعملاء المؤسسيين والمعلنين.',
      purpose: 'Business Intro', purpose_ar: 'تقديم تجاري',
      sample_script: `When it comes to [Brand Name], I don't just talk about it — I believe in it. They stand for quality, for excellence, and for the kind of standards that I hold myself to every single day. If you're looking for the best in [industry/category], look no further. [Brand Name] — this is the real deal.`,
      sample_script_ar: `عندما يتعلق الأمر بـ[اسم العلامة التجارية]، أنا لا أتحدث عنها فحسب — بل أؤمن بها. إنها تمثل الجودة والتميز والمعايير التي أحمل نفسي عليها كل يوم. إذا كنت تبحث عن الأفضل في [القطاع/الفئة]، لا تبحث أكثر. [اسم العلامة التجارية] — هذا هو الأصل.`,
      product_types: ['video-ad'], duration: '45s', is_active: true,
    },
    {
      name: 'Wedding Congratulations', name_ar: 'تهنئة الزواج',
      description: 'A romantic and memorable wedding congratulations from a celebrity for the happy couple.',
      description_ar: 'تهنئة زواج رومانسية ولا تُنسى من نجم مشهور للزوجين السعيدين.',
      purpose: 'Wedding', purpose_ar: 'تهنئة الزواج',
      sample_script: `[Groom] and [Bride], congratulations on your wedding day! Today you're not just starting a new chapter — you're beginning the greatest adventure of your lives together. Love each other deeply, laugh often, and face every challenge as a team. Wishing you a lifetime of happiness, joy, and beautiful memories. You make a truly wonderful couple!`,
      sample_script_ar: `[اسم العريس] و[اسم العروس]، مبروك يوم زفافكم! اليوم أنتم لا تبدأون فصلاً جديداً فحسب — بل تبدأون أعظم مغامرة في حياتكم معاً. أحبا بعضكما بعمق، واضحكا كثيراً، وواجها كل تحدٍ كفريق واحد. أتمنى لكم حياة مليئة بالسعادة والبهجة والذكريات الجميلة. أنتما زوجان رائعان حقاً!`,
      product_types: ['greeting'], duration: '45s', is_active: true,
    },
    {
      name: 'Business Opening & Grand Launch', name_ar: 'افتتاح عمل تجاري',
      description: 'An exciting grand opening message for a new business, store, or restaurant.',
      description_ar: 'رسالة افتتاح رائعة لعمل تجاري أو متجر أو مطعم جديد.',
      purpose: 'Business Intro', purpose_ar: 'تقديم عمل تجاري',
      sample_script: `Something exciting is happening — [Business Name] is officially open! I've seen what the team behind this has built and I'm telling you, it's something special. Whether you're looking for [product/service], this is the place to be. Come check it out, support [Name] and what they've worked so hard to create. Congratulations on the grand opening — this is just the beginning!`,
      sample_script_ar: `شيء مثير للاهتمام يحدث — [اسم العمل التجاري] افتتح رسمياً! رأيت ما بناه الفريق وراء هذا وأقول لكم إنه شيء مميز. سواء كنت تبحث عن [المنتج/الخدمة]، هذا هو المكان المناسب. تعالوا وتفقدوا وادعموا [الاسم] وما عمل بجد لإنشائه. مبروك على الافتتاح الرسمي — هذه مجرد البداية!`,
      product_types: ['video-ad'], duration: '60s', is_active: true,
    },
    {
      name: 'Thank You Message', name_ar: 'رسالة شكر',
      description: 'A sincere thank-you message to express gratitude to a person, team, or community.',
      description_ar: 'رسالة شكر صادقة للتعبير عن الامتنان لشخص أو فريق أو مجتمع.',
      purpose: 'Thank You', purpose_ar: 'رسالة شكر',
      sample_script: `[Name], I want you to know how much your support means to me — and to all of us. People like you are the reason we keep pushing. The loyalty, the energy, the love you bring — it never goes unnoticed. From the bottom of my heart, thank you. This one's for you.`,
      sample_script_ar: `[الاسم]، أريدك أن تعلم مدى أهمية دعمك لي — ولنا جميعاً. أشخاص مثلك هم السبب الذي يجعلنا نستمر. الولاء والطاقة والمحبة التي تجلبها — لا تمر دون أن نلاحظها أبداً. من أعماق قلبي، شكراً لك. هذه لك.`,
      product_types: ['greeting'], duration: '30s', is_active: true,
    },
    {
      name: 'Sports Team Shoutout', name_ar: 'تشجيع فريق رياضي',
      description: 'A high-energy shoutout to a sports team, club, or athlete to fire them up for a big match.',
      description_ar: 'تشجيع بطاقة عالية لفريق رياضي أو نادٍ أو رياضي استعداداً لمباراة كبيرة.',
      purpose: 'Shoutout', purpose_ar: 'تشجيع رياضي',
      sample_script: `[Team Name] — I'm talking to you. You've trained for this. You've sacrificed for this. Every early morning, every tough session, every moment of doubt — it all led to right now. Go out there and show the world what you're made of. Believe in each other. Fight for every second. Let's go — you've got this!`,
      sample_script_ar: `[اسم الفريق] — أتحدث إليكم. لقد تدربتم من أجل هذا. ضحيتم من أجل هذا. كل صباح مبكر، كل جلسة صعبة، كل لحظة شك — كل ذلك قاد إلى هذه اللحظة. اخرجوا وأروا العالم ما أنتم عليه. ثقوا ببعضكم. قاتلوا في كل ثانية. هيا — أنتم قادرون!`,
      product_types: ['greeting', 'video-ad'], duration: '30s', is_active: true,
    },
    {
      name: 'Graduation Celebration', name_ar: 'احتفال بالتخرج',
      description: 'A proud and inspiring graduation congratulations message for students and their families.',
      description_ar: 'رسالة تهنئة تخرج فخورة وملهمة للطلاب وعائلاتهم.',
      purpose: 'Graduation', purpose_ar: 'تهنئة التخرج',
      sample_script: `[Name], you did it! Graduation day is here and I couldn't be more proud of you. All those late nights studying, all those moments of pressure — they shaped you into the person standing here today. This degree is yours. The future is yours. Go out there and change the world — it's waiting for you.`,
      sample_script_ar: `[الاسم]، أنجزت المهمة! يوم التخرج وصل ولا يمكنني أن أكون أكثر فخراً بك. كل تلك الليالي المتأخرة في الدراسة، كل لحظات الضغط — شكّلتك لتصبح الشخص الواقف هنا اليوم. هذه الشهادة لك. المستقبل لك. اذهب وغيّر العالم — إنه ينتظرك.`,
      product_types: ['greeting'], duration: '30s', is_active: true,
    },
    {
      name: 'Corporate Event & Conference Invite', name_ar: 'دعوة فعالية أو مؤتمر',
      description: 'A professional celebrity-led invite to drive attendance at corporate events and conferences.',
      description_ar: 'دعوة احترافية بقيادة نجم مشهور لزيادة الحضور في الفعاليات والمؤتمرات.',
      purpose: 'Business Intro', purpose_ar: 'دعوة فعالية',
      sample_script: `I want to personally invite you to [Event Name], happening on [Date] in [Location]. This isn't just another event — it's where the biggest names in [industry] come together to share ideas, make connections, and shape the future. Don't miss your chance to be part of something historic. Register now at [Website] — I'll see you there.`,
      sample_script_ar: `أريد أن أدعوك شخصياً إلى [اسم الفعالية]، التي تقام في [التاريخ] في [الموقع]. هذه ليست مجرد فعالية عادية — إنها المكان الذي تجتمع فيه أكبر الأسماء في [القطاع] لتبادل الأفكار وبناء العلاقات وتشكيل المستقبل. لا تفوّت فرصتك للمشاركة في شيء تاريخي. سجّل الآن على [الموقع] — سأراك هناك.`,
      product_types: ['video-ad'], duration: '60s', is_active: true,
    },
    {
      name: 'New Year Message', name_ar: 'رسالة رأس السنة',
      description: 'An inspirational new year message to reflect on the past and embrace the year ahead.',
      description_ar: 'رسالة ملهمة لرأس السنة للتأمل في الماضي واحتضان العام القادم.',
      purpose: 'Holiday Greeting', purpose_ar: 'تهنئة رأس السنة',
      sample_script: `Happy New Year! A brand new year means a brand new chapter — and this one is yours to write. Leave behind whatever held you back, carry forward everything that made you strong, and step into this year with confidence and courage. Make it count. Happy New Year — let's make this one unforgettable.`,
      sample_script_ar: `كل عام وأنتم بخير! عام جديد يعني فصلاً جديداً — وهذا الفصل لك لتكتبه. اترك خلفك ما أعاقك، واحمل معك كل ما جعلك أقوى، وادخل هذا العام بثقة وشجاعة. اجعله مميزاً. كل عام وأنتم بخير — لنجعل هذا العام لا يُنسى.`,
      product_types: ['greeting', 'video-ad'], duration: '30s', is_active: true,
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

  // 6. Product Types
  const PRODUCT_TYPES = [
    {
      slug: 'greeting', name: 'Personal Greetings', name_ar: 'تحيات المشاهير',
      description: 'Personal occasions', description_ar: 'المناسبات الشخصية',
      detail: 'Personalized celebrity messages for birthdays, weddings, graduations, and heartfelt appreciations.',
      detail_ar: 'رسائل مشاهير شخصية لأعياد الميلاد والأعراس والتخرج وعبارات الامتنان.',
      icon: '🎉', price_from: 149,
      duration: 'Delivery in 1–2 business days', duration_ar: 'التسليم في غضون 1–2 يوم عمل',
      use_cases: ['Birthdays', 'Weddings', 'Graduations', 'Corporate Appreciation'],
      use_cases_ar: ['أعياد الميلاد', 'الأعراس', 'حفلات التخرج', 'التقدير المؤسسي'],
      video_prompt: 'Warm, friendly, and celebratory tone. Bright and cheerful setting. Natural smiling expression with genuine emotion. Soft, flattering lighting. Avoid: formal or stiff posture, dark or moody lighting, serious expression, corporate aesthetic.',
      gemini_system_prompt: 'You are a creative scene designer for personal celebrity greeting videos. Generate warm, celebratory, and heartfelt background scenes. The scene should feel personal, joyful, and appropriate for special occasions like birthdays, weddings, and graduations. Focus on bright colors, soft lighting, and uplifting atmospheres.',
      is_active: true, order: 0,
    },
    {
      slug: 'video-ad', name: 'Video Ad', name_ar: 'إعلان فيديو',
      description: 'Short celebrity Ad', description_ar: 'الرأس والكتفين',
      detail: 'Hyper-realistic video avatars ideal for ads, product launches, and official announcements.',
      detail_ar: 'أفاتارات فيديو فائقة الواقعية مثالية للإعلانات وإطلاق المنتجات والإعلانات الرسمية.',
      icon: '🎬', price_from: 299,
      duration: 'Delivery in 3–5 business days', duration_ar: 'التسليم في غضون 3–5 أيام عمل',
      use_cases: ['Brand Ads', 'Product Launches', 'Corporate Announcements', 'Social Media Posts'],
      use_cases_ar: ['إعلانات العلامة التجارية', 'إطلاق المنتجات', 'الإعلانات الشركاتية', 'منشورات وسائل التواصل الاجتماعي'],
      video_prompt: 'Maintain a calm, authoritative, and professional manner. Smiling, friendly expression. Subtle eyebrow raise on key statements, natural hand movements.',
      gemini_system_prompt: 'You are a professional scene designer for celebrity product advertisement videos. Generate clean, modern, and brand-appropriate background scenes.',
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

  // 7. Settings (key-value store defaults)
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
