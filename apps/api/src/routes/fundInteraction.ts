// src/routes/fundInteraction.ts
import { FastifyInstance } from 'fastify';
import { requireAuth } from '../config/auth.js';

// Tipos válidos de interação (armazenados como texto)
const VALID_INTERACTION_TYPES = ['VIEW', 'CLICK', 'FAVORITE', 'START_ORDER'] as const;
type FundInteractionType = typeof VALID_INTERACTION_TYPES[number];

export default async function fundInteractionRoutes(fastify: FastifyInstance) {
  const prisma = fastify.prisma;

  // POST /api/funds/:fundId/interactions
  // Body: { investorId: string, type: "VIEW" | "CLICK" | "FAVORITE" | "START_ORDER" }
  fastify.post('/funds/:fundId/interactions', async (request, reply) => {
    try {
      const authUser = requireAuth(request, reply, ['INVESTIDOR']);
      if (!authUser) return reply;

      const { fundId } = request.params as { fundId: string };
      const { type } = (request.body ?? {}) as { type?: string };
      const investorId = authUser.id;

      if (!type) {
        return reply.status(400).send({ error: 'type é obrigatório' });
      }

      // Validar se o type é válido
      if (!VALID_INTERACTION_TYPES.includes(type as FundInteractionType)) {
        return reply.status(400).send({ 
          error: 'type inválido',
          validTypes: VALID_INTERACTION_TYPES 
        });
      }

      // Verificar se o fundo existe
      const fund = await prisma.fund.findUnique({
        where: { id: fundId },
      });

      if (!fund) {
        return reply.status(404).send({ error: 'Fundo não encontrado' });
      }

      // Verificar se o investidor existe
      const investor = await prisma.user.findUnique({
        where: { id: investorId },
      });

      if (!investor) {
        return reply.status(404).send({ error: 'Investidor não encontrado' });
      }

      if (investor.role !== 'INVESTIDOR') {
        return reply.status(403).send({ error: 'Apenas investidores podem registrar interações' });
      }

      // Criar a interação
      const interaction = await prisma.fundInteraction.create({
        data: {
          investorId,
          fundId,
          type: type as FundInteractionType,
        },
      });

      return reply.status(201).send({ 
        ok: true, 
        interaction: {
          id: interaction.id,
          type: interaction.type,
          createdAt: interaction.createdAt,
        }
      });
    } catch (err) {
      console.error(err);
      return reply.status(500).send({ error: 'Erro ao registrar interação' });
    }
  });

  // GET /api/funds/:fundId/interactions
  // Obter todas as interações de um fundo (útil para analytics)
  fastify.get('/funds/:fundId/interactions', async (request, reply) => {
    try {
      const authUser = requireAuth(request, reply, ['GESTOR', 'CONSULTOR']);
      if (!authUser) return reply;

      const { fundId } = request.params as { fundId: string };

      const interactions = await prisma.fundInteraction.findMany({
        where: { fundId },
        include: {
          investor: {
            select: {
              id: true,
              email: true,
              role: true,
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      // Estatísticas agregadas
      const stats = {
        total: interactions.length,
        byType: {
          VIEW: interactions.filter(i => i.type === 'VIEW').length,
          CLICK: interactions.filter(i => i.type === 'CLICK').length,
          FAVORITE: interactions.filter(i => i.type === 'FAVORITE').length,
          START_ORDER: interactions.filter(i => i.type === 'START_ORDER').length,
        },
        uniqueInvestors: new Set(interactions.map(i => i.investorId)).size,
      };

      return reply.send({
        interactions,
        stats,
      });
    } catch (err) {
      console.error(err);
      return reply.status(500).send({ error: 'Erro ao buscar interações' });
    }
  });

  // GET /api/investors/:investorId/interactions
  // Obter todas as interações de um investidor
  fastify.get('/investors/:investorId/interactions', async (request, reply) => {
    try {
      const authUser = requireAuth(request, reply);
      if (!authUser) return reply;

      const { investorId } = request.params as { investorId: string };
      if (authUser.id !== investorId && authUser.role !== 'GESTOR') {
        return reply.status(403).send({ error: 'Access denied' });
      }

      const interactions = await prisma.fundInteraction.findMany({
        where: { investorId },
        include: {
          fund: {
            select: {
              id: true,
              name: true,
              symbol: true,
              fundType: true,
              sector: true,
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      return reply.send({
        total: interactions.length,
        interactions,
      });
    } catch (err) {
      console.error(err);
      return reply.status(500).send({ error: 'Erro ao buscar interações do investidor' });
    }
  });
}
