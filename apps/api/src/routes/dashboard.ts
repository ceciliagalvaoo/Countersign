import { FastifyInstance } from 'fastify';
import jwt from 'jsonwebtoken';

import { JWT_SECRET } from '../config/env.js';

function verifyToken(token: string) {
  try {
    return jwt.verify(token, JWT_SECRET) as any;
  } catch {
    throw new Error('Invalid token');
  }
}

export async function dashboardRoutes(fastify: FastifyInstance) {
  // Get investor dashboard with badge info
  fastify.get('/investor', async (request, reply) => {
    try {
      const token = request.headers.authorization?.replace('Bearer ', '');
      if (!token) {
        return reply.status(401).send({ error: 'No token provided' });
      }

      const userData = verifyToken(token);
      
      if (userData.role !== 'INVESTIDOR') {
        return reply.status(403).send({ error: 'Access denied' });
      }

      // Get user with badge info
      const user = await fastify.prisma.user.findUnique({
        where: { id: userData.id },
        select: {
          id: true,
          email: true,
          totalInvested: true,
          investorBadge: true,
          badgeCommitment: true,
          lastBadgeUpdate: true,
        }
      });

      if (!user) {
        return reply.status(404).send({ error: 'User not found' });
      }

      // Import badge service
      const { getBadgeInfo, getBadgeProgress, InvestorBadge } = await import('../services/zkBadge.js');
      
      const currentBadge = user.investorBadge as typeof InvestorBadge[keyof typeof InvestorBadge];
      const badgeInfo = getBadgeInfo(currentBadge);
      const progress = getBadgeProgress(user.totalInvested);

      // Get investment statistics
      const [completedOrders, pendingOrders] = await Promise.all([
        fastify.prisma.order.findMany({
          where: {
            investorId: user.id,
            status: 'COMPLETED',
            approvalStatus: { not: 'REJECTED' } // refunded orders are not investments
          },
          select: {
            id: true,
            total: true,
            approvalStatus: true,
            txHash: true,
            createdAt: true,
            fund: {
              select: {
                name: true,
                symbol: true
              }
            }
          },
          orderBy: {
            createdAt: 'desc'
          },
          take: 100
        }),
        fastify.prisma.order.count({
          where: {
            investorId: user.id,
            status: 'PENDING'
          }
        })
      ]);

      // Calculate portfolio distribution
      const portfolioByFund = completedOrders.reduce((acc, order) => {
        const fundName = order.fund.name;
        if (!acc[fundName]) {
          acc[fundName] = 0;
        }
        acc[fundName] += order.total;
        return acc;
      }, {} as Record<string, number>);

      return {
        user: {
          id: user.id,
          email: user.email,
          totalInvested: user.totalInvested,
          lastBadgeUpdate: user.lastBadgeUpdate,
        },
        badge: {
          ...badgeInfo,
          hasProof: !!user.badgeCommitment,
        },
        progress,
        statistics: {
          totalInvestments: completedOrders.length,
          pendingOrders,
          // totalInvested counts approved orders only (see refreshInvestorBadge), so average over those
          averageInvestment: (() => {
            const approved = completedOrders.filter((o) => o.approvalStatus === 'APPROVED').length;
            return approved > 0 ? user.totalInvested / approved : 0;
          })(),
          portfolioDistribution: portfolioByFund,
        },
        recentInvestments: completedOrders.slice(0, 5).map(order => ({
          id: order.id,
          fundName: order.fund.name,
          fundSymbol: order.fund.symbol,
          amount: order.total,
          date: order.createdAt,
          txHash: order.txHash,
        }))
      };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // Get pending counts for approval (Gestor only)
  fastify.get('/pending-counts', async (request, reply) => {
    try {
      const token = request.headers.authorization?.replace('Bearer ', '');
      if (!token) {
        return reply.status(401).send({ error: 'No token provided' });
      }

      const user = verifyToken(token);
      
      if (user.role !== 'GESTOR') {
        return reply.status(403).send({ error: 'Access denied' });
      }

      // Count pending consultores
      const pendingConsultores = await fastify.prisma.user.count({
        where: { 
          role: 'CONSULTOR',
          status: 'PENDING'
        }
      });

      // Count pending investidores
      const pendingInvestidores = await fastify.prisma.user.count({
        where: { 
          role: 'INVESTIDOR',
          status: 'PENDING'
        }
      });

      // Count pending funds
      const pendingFunds = await fastify.prisma.fund.count({
        where: { 
          status: 'PENDING'
        }
      });

      // Count pending cedentes (assignors)
      const pendingCedentes = await fastify.prisma.cedente.count({
        where: { 
          status: 'PENDING'
        }
      });

      // Count pending sacados (debtors)
      const pendingSacados = await fastify.prisma.sacado.count({
        where: { 
          status: 'PENDING'
        }
      });

      return {
        pendingCounts: {
          consultores: pendingConsultores,
          investidores: pendingInvestidores,
          funds: pendingFunds,
          assignors: pendingCedentes,
          debtors: pendingSacados
        }
      };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });
}
