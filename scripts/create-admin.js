#!/usr/bin/env node
/**
 * One-time script to create the first SUPER_ADMIN user.
 * Run on Render Shell:
 *   node scripts/create-admin.js
 *
 * Set these env vars first (or pass inline):
 *   ADMIN_EMAIL=you@example.com
 *   ADMIN_PASSWORD=yourpassword
 *   ADMIN_NAME="Your Name"
 *   DATABASE_URL=...  (already set on Render)
 *   ADMIN_SECRET=...  (already set on Render)
 */

const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

function hashPassword(password) {
  return crypto
    .createHash('sha256')
    .update(password + (process.env.ADMIN_SECRET || 'tf-admin-salt'))
    .digest('hex');
}

async function main() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  const fullName = process.env.ADMIN_NAME || 'Super Admin';

  if (!email || !password) {
    console.error('❌  Set ADMIN_EMAIL and ADMIN_PASSWORD env vars before running.');
    process.exit(1);
  }

  const existing = await prisma.adminUser.findUnique({ where: { email } });
  if (existing) {
    console.log(`ℹ️  Admin user ${email} already exists. Updating password...`);
    await prisma.adminUser.update({
      where: { email },
      data: { passwordHash: hashPassword(password), isActive: true },
    });
    console.log('✅  Password updated.');
    return;
  }

  const admin = await prisma.adminUser.create({
    data: {
      email,
      passwordHash: hashPassword(password),
      fullName,
      role: 'SUPER_ADMIN',
      isActive: true,
    },
  });

  console.log(`✅  Admin created: ${admin.email} (${admin.role})`);
}

main()
  .catch((e) => { console.error('❌ Error:', e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
