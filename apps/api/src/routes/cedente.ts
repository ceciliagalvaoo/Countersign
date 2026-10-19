import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import jwt from 'jsonwebtoken';

import { JWT_SECRET } from '../config/env.js';

const createCedenteSchema = z.object({
  name: z.string().min(1),
  fantasyName: z.string().optional(),
  document: z.string().min(11),
  cnae: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  website: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  country: z.string().optional(),
  postalCode: z.string().optional(),
  beneficialOwners: z.string().optional(),
  isPep: z.boolean().optional(),
  revenueLast12m: z.number().optional(),
  totalDebt: z.number().optional(),
  mainBanks: z.string().optional(),
  riskRating: z.string().optional(),
  operationDescription: z.string().optional(),
  creditPolicy: z.string().optional(),
  guarantees: z.string().optional(),
  publicKey: z.string().optional(),
  fundId: z.string()
});

const updateStatusSchema = z.object({
  status: z.enum(['APPROVED', 'REJECTED'])
});

function verifyToken(token: string) {
  try {
    return jwt.verify(token, JWT_SECRET) as any;
  } catch {
    throw new Error('Invalid token');
  }
}

export async function cedenteRoutes(fastify: FastifyInstance) {
  // Create cedente (Consultor only) - now requires fundId
  fastify.post('/', async (request, reply) => {
    try {
      const token = request.headers.authorization?.replace('Bearer ', '');
      if (!token) {
        return reply.status(401).send({ error: 'No token provided' });
      }

      const payload = verifyToken(token);
      if (payload.role !== 'CONSULTOR') {
        return reply.status(403).send({ error: 'Only consultors can create cedentes' });
      }

      const body = createCedenteSchema.parse(request.body);

      // Verify fund belongs to consultor
      const fund = await fastify.prisma.fund.findFirst({
        where: {
          id: body.fundId,
          consultorId: payload.id
        }
      });

      if (!fund) {
        return reply.status(404).send({ error: 'Fund not found or you do not have permission' });
      }

      const cedente = await fastify.prisma.cedente.create({
        data: {
          name: body.name,
          fantasyName: body.fantasyName,
          document: body.document,
          cnae: body.cnae,
          email: body.email,
          phone: body.phone,
          website: body.website,
          address: body.address,
          city: body.city,
          state: body.state,
          country: body.country,
          postalCode: body.postalCode,
          beneficialOwners: body.beneficialOwners,
          isPep: body.isPep,
          revenueLast12m: body.revenueLast12m,
          totalDebt: body.totalDebt,
          mainBanks: body.mainBanks,
          riskRating: body.riskRating,
          operationDescription: body.operationDescription,
          creditPolicy: body.creditPolicy,
          guarantees: body.guarantees,
          publicKey: body.publicKey,
          consultorId: payload.id,
          fundId: body.fundId
        }
      });

      return { cedente };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Invalid input', details: error.errors });
      }
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // Get cedentes by fund
  fastify.get('/fund/:fundId', async (request, reply) => {
    try {
      const token = request.headers.authorization?.replace('Bearer ', '');
      if (!token) {
        return reply.status(401).send({ error: 'No token provided' });
      }

      const payload = verifyToken(token);
      const { fundId } = request.params as { fundId: string };

      // Verify fund belongs to consultor (if consultor role)
      if (payload.role === 'CONSULTOR') {
        const fund = await fastify.prisma.fund.findFirst({
          where: {
            id: fundId,
            consultorId: payload.id
          }
        });

        if (!fund) {
          return reply.status(404).send({ error: 'Fund not found or you do not have permission' });
        }
      }

      const cedentes = await fastify.prisma.cedente.findMany({
        where: { 
          fundId,
          ...(payload.role === 'CONSULTOR' && { consultorId: payload.id })
        },
        include: {
          consultor: {
            select: { email: true, role: true }
          },
          fund: {
            select: { name: true, id: true }
          }
        },
        orderBy: { createdAt: 'desc' }
      });

      return { cedentes };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // List all cedentes (Gestor sees all, Consultor sees own) - now includes fund info
  fastify.get('/', async (request, reply) => {
    try {
      const token = request.headers.authorization?.replace('Bearer ', '');
      if (!token) {
        return reply.status(401).send({ error: 'No token provided' });
      }

      const payload = verifyToken(token);
      const { page = '1', limit = '50' } = request.query as { page?: string; limit?: string };
      const skip = (parseInt(page) - 1) * parseInt(limit);
      const take = parseInt(limit);

      const where = payload.role === 'CONSULTOR' 
        ? { consultorId: payload.id }
        : {};

      const [cedentes, total] = await Promise.all([
        fastify.prisma.cedente.findMany({
          where,
          select: {
            id: true,
            name: true,
            fantasyName: true,
            document: true,
            email: true,
            status: true,
            createdAt: true,
            consultor: {
              select: { email: true, role: true }
            },
            fund: {
              select: { name: true, id: true }
            }
          },
          skip,
          take,
          orderBy: { createdAt: 'desc' }
        }),
        fastify.prisma.cedente.count({ where })
      ]);

      return { 
        cedentes,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          totalPages: Math.ceil(total / parseInt(limit))
        }
      };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // Update cedente status (Gestor only)
  fastify.patch('/:id/status', async (request, reply) => {
    try {
      const token = request.headers.authorization?.replace('Bearer ', '');
      if (!token) {
        return reply.status(401).send({ error: 'No token provided' });
      }

      const payload = verifyToken(token);
      if (payload.role !== 'GESTOR') {
        return reply.status(403).send({ error: 'Only gestors can update status' });
      }

      const { id } = request.params as { id: string };
      const body = updateStatusSchema.parse(request.body);

      const cedente = await fastify.prisma.cedente.update({
        where: { id },
        data: { status: body.status },
        include: {
          consultor: {
            select: { email: true, role: true }
          },
          fund: {
            select: { name: true, id: true }
          }
        }
      });

      return { cedente };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Invalid input', details: error.errors });
      }
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });
}
