import dotenv from 'dotenv'
dotenv.config()

import bcrypt from 'bcryptjs'
import prisma from '../lib/prisma'

const ADMIN_EMAIL    = process.env.ADMIN_EMAIL    || 'admin@twinity.ai'
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Admin@1234'
const ADMIN_NAME     = process.env.ADMIN_NAME     || 'Super Admin'

async function seed() {
  await prisma.$connect()
  console.log('Connected to PostgreSQL')

  const existing = await prisma.admin.findUnique({ where: { email: ADMIN_EMAIL } })
  if (existing) {
    console.log(`Super Admin already exists: ${existing.email} (role: ${existing.role})`)
    await prisma.$disconnect()
    return
  }

  const hashedPassword = await bcrypt.hash(ADMIN_PASSWORD, 12)
  await prisma.admin.create({
    data: {
      name:     ADMIN_NAME,
      email:    ADMIN_EMAIL,
      password: hashedPassword,
      role:     'super_admin',
      isActive: true,
    },
  })

  console.log('Super Admin seeded successfully')
  console.log(`  Email:    ${ADMIN_EMAIL}`)
  console.log(`  Password: ${ADMIN_PASSWORD}`)
  console.log(`  Role:     super-admin`)

  await prisma.$disconnect()
}

seed().catch(err => {
  console.error('Seeder failed:', err)
  process.exit(1)
})
