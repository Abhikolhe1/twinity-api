import { prisma } from '../lib/prisma'

async function main() {
  await prisma.productType.update({
    where: { slug: 'greeting' },
    data:  { name: 'Personal Greetings' },
  })
  console.log('[ok]   greeting → Personal Greetings')

  await prisma.productType.update({
    where: { slug: 'avatar-studio' },
    data:  { name: 'Video Ad' },
  })
  console.log('[ok]   avatar-studio → Video Ad')

  await prisma.productType.update({
    where: { slug: 'full-body' },
    data:  { is_active: false },
  })
  console.log('[ok]   full-body deactivated')
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
