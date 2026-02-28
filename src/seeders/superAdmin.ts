import dotenv from 'dotenv'
dotenv.config()

import mongoose from 'mongoose'
import { Admin } from '../models/Admin'

const MONGO_URI  = process.env.MONGODB_URI        || 'mongodb://localhost:27017/twinity'
const ADMIN_EMAIL    = process.env.ADMIN_EMAIL     || 'admin@twinity.ai'
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD  || 'Admin@1234'
const ADMIN_NAME     = process.env.ADMIN_NAME      || 'Super Admin'

async function seed() {
  await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 5000 })
  console.log('Connected to MongoDB')

  const existing = await Admin.findOne({ email: ADMIN_EMAIL })

  if (existing) {
    console.log(`Super Admin already exists: ${existing.email} (role: ${existing.role})`)
    await mongoose.disconnect()
    return
  }

  await Admin.create({
    name:     ADMIN_NAME,
    email:    ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
    role:     'super-admin',
    isActive: true,
  })

  console.log('Super Admin seeded successfully')
  console.log(`  Email:    ${ADMIN_EMAIL}`)
  console.log(`  Password: ${ADMIN_PASSWORD}`)
  console.log(`  Role:     super-admin`)

  await mongoose.disconnect()
}

seed().catch(err => {
  console.error('Seeder failed:', err)
  process.exit(1)
})
