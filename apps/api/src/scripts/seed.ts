import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function seed() {
  console.log('🌱 Starting seed...');

  // Clear existing data
  await prisma.order.deleteMany();
  await prisma.receivable.deleteMany();
  await prisma.fund.deleteMany();
  await prisma.cedente.deleteMany();
  await prisma.sacado.deleteMany();
  await prisma.user.deleteMany();

  // Create users
  const hashedPassword = await bcrypt.hash('123456', 10);

  const consultor = await prisma.user.create({
    data: {
      email: 'consultor@vero.com.br',
      password: hashedPassword,
      role: 'CONSULTOR',
      publicKey: 'GAXJXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX'
    }
  });

  const gestor = await prisma.user.create({
    data: {
      email: 'gestor@vero.com.br',
      password: hashedPassword,
      role: 'GESTOR',
      publicKey: 'GBXJXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX'
    }
  });

  const investidor = await prisma.user.create({
    data: {
      email: 'investidor@vero.com.br',
      password: hashedPassword,
      role: 'INVESTIDOR',
      publicKey: 'GCXJXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX'
    }
  });

  // Create cedentes and sacados
  const cedente = await prisma.cedente.create({
    data: {
      name: 'Fazenda São José',
      document: '12.345.678/0001-90',
      address: 'Rodovia BR-163, Km 120, Sorriso - MT',
      status: 'APPROVED',
      consultorId: consultor.id
    }
  });

  const sacado = await prisma.sacado.create({
    data: {
      name: 'Agrotrading S/A',
      document: '98.765.432/0001-10',
      address: 'Av. Paulista, 1000, São Paulo - SP',
      status: 'APPROVED',
      consultorId: consultor.id
    }
  });

  // Create fund
  const fund = await prisma.fund.create({
    data: {
      name: 'FIDC Soja Safra 2025',
      symbol: 'SOJA25',
      maxSupply: 10000,
      totalIssued: 5000,
      price: 100.0
    }
  });

  // Create receivable
  const receivable = await prisma.receivable.create({
    data: {
      faceValue: 500000.0,
      dueDate: new Date('2025-12-31'),
      status: 'PENDING',
      fundId: fund.id,
      sacadoId: sacado.id
    }
  });

  // Create a sample order
  const order = await prisma.order.create({
    data: {
      quantity: 100,
      price: 100.0,
      total: 10000.0,
      status: 'COMPLETED',
      txHash: 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      investorId: investidor.id,
      fundId: fund.id
    }
  });

  console.log('✅ Seed completed!');
  console.log(`📧 Consultor: ${consultor.email} (password: 123456)`);
  console.log(`📧 Gestor: ${gestor.email} (password: 123456)`);
  console.log(`📧 Investidor: ${investidor.email} (password: 123456)`);
  console.log(`🏦 Fund: ${fund.name} (${fund.symbol})`);
  console.log(`📄 Receivable: R$ ${receivable.faceValue.toLocaleString('pt-BR')}`);
  console.log(`📋 Order: ${order.quantity} quotas for R$ ${order.total.toLocaleString('pt-BR')}`);
}

seed()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });