// LOCAL DEMO DATABASES ONLY: wipes every table and creates demo accounts with the password 123456.
// For a real database use `npm run create-gestor -- <email>` instead.
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function createTestData() {
  try {
    console.log('🗃️  Deleting existing data...');

    // Delete existing data in foreign key order
    await prisma.$transaction([
      // Tabelas que dependem de User e Fund
      prisma.fundInteraction.deleteMany(), // fund_interactions (depende de fund e investor)

      prisma.order.deleteMany(),           // orders (depende de fund e investor)
      prisma.receivable.deleteMany(),      // receivables (depends on fund and sacado)

      prisma.pool.deleteMany(),            // pools (depende de fund)
      prisma.cedente.deleteMany(),         // cedentes (depends on fund and consultor)
      prisma.sacado.deleteMany(),          // sacados (depends on fund and consultor)

      prisma.fund.deleteMany(),            // funds (depends on consultor)
      prisma.user.deleteMany(),            // users
    ]);

    console.log('👥 Creating demo users...');

    // Same password for every demo user
    const defaultPassword = await bcrypt.hash('123456', 10);

    // 1. Create the GESTOR (manager)
    const gestor = await prisma.user.create({
      data: {
        email: 'gestor@example.com',
        password: defaultPassword,
        role: 'GESTOR',
        status: 'APPROVED',
      },
    });
    console.log('✅ Gestor criado:', gestor.email);

    // 2. Create the CONSULTOR
    const consultor = await prisma.user.create({
      data: {
        email: 'consultor@example.com',
        password: defaultPassword,
        role: 'CONSULTOR',
        status: 'APPROVED',
      },
    });
    console.log('✅ Consultor criado:', consultor.email);

    // 3. Create the INVESTIDOR (investor)
    const investidor = await prisma.user.create({
      data: {
        email: 'investidor@example.com',
        password: defaultPassword,
        role: 'INVESTIDOR',
        status: 'APPROVED',
      },
    });
    console.log('✅ Investidor criado:', investidor.email);

    // 4. Pending users
    const consultorPendente = await prisma.user.create({
      data: {
        email: 'consultor.pendente@example.com',
        password: defaultPassword,
        role: 'CONSULTOR',
        status: 'PENDING',
      },
    });
    console.log('⏳ Consultor pendente criado:', consultorPendente.email);

    const investidorPendente = await prisma.user.create({
      data: {
        email: 'investidor.pendente@example.com',
        password: defaultPassword,
        role: 'INVESTIDOR',
        status: 'PENDING',
      },
    });
    console.log('⏳ Investidor pendente criado:', investidorPendente.email);

    console.log('\n🎉 Demo data created.\n');
    
    console.log('📋 DEMO CREDENTIALS:');
    console.log('═══════════════════════════════════════');
    console.log('👨‍💼 GESTOR:');
    console.log('   Email: gestor@example.com');
    console.log('   Password: 123456');
    console.log('   Status: APPROVED');
    console.log('');
    console.log('👨‍💻 CONSULTOR:');
    console.log('   Email: consultor@example.com');
    console.log('   Password: 123456');
    console.log('   Status: APPROVED');
    console.log('');
    console.log('💰 INVESTIDOR:');
    console.log('   Email: investidor@example.com');
    console.log('   Password: 123456');
    console.log('   Status: APPROVED');
    console.log('');
    console.log('⏳ PENDING USERS (to test approval):');
    console.log('   consultor.pendente@example.com - 123456');
    console.log('   investidor.pendente@example.com - 123456');
    console.log('');
    console.log('💡 Clean database: only users were created');
    console.log('═══════════════════════════════════════');

  } catch (error) {
    console.error('❌ Error creating demo data:', error);
  } finally {
    await prisma.$disconnect();
  }
}

createTestData();
