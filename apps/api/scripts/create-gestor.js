// Creates a fund manager (GESTOR) account with a strong random password, for a real (non-demo) database.
// Managers cannot sign up through the app; consultants and investors register and a manager approves them.
//
// Usage: node scripts/create-gestor.js <email>
// The password is written only to apps/api/.gestor-credentials (git-ignored): store it in a password manager,
// then delete the file.
import 'dotenv/config';
import crypto from 'crypto';
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const email = process.argv[2];
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error('Usage: node scripts/create-gestor.js <email>');
  process.exit(1);
}

const prisma = new PrismaClient();
try {
  if (await prisma.user.findUnique({ where: { email } })) {
    console.error(`A user with email ${email} already exists`);
    process.exit(1);
  }

  // 24 characters from a 62-symbol alphabet (~143 bits)
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const password = Array.from({ length: 24 }, () => alphabet[crypto.randomInt(alphabet.length)]).join('');

  await prisma.user.create({
    data: { email, password: await bcrypt.hash(password, 12), role: 'GESTOR', status: 'APPROVED' },
  });

  const file = fileURLToPath(new URL('../.gestor-credentials', import.meta.url));
  writeFileSync(file, `email=${email}\npassword=${password}\n`, { mode: 0o600 });
  console.log(`Manager ${email} created. Credentials saved to apps/api/.gestor-credentials (store them, then delete the file).`);
} finally {
  await prisma.$disconnect();
}
