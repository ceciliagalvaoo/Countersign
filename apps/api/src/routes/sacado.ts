import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import jwt from 'jsonwebtoken';

import { JWT_SECRET } from '../config/env.js';

const createSacadoSchema = z.object({
  name: z.string().min(1),
  document: z.string().min(11),
  personType: z.enum(['PF', 'PJ']).optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  country: z.string().optional(),
  postalCode: z.string().optional(),
  sector: z.string().optional(),
  size: z.string().optional(),
  rating: z.string().optional(),
  paymentHistory: z.string().optional(),
  exposure: z.number().optional(),
  creditLimitFund: z.number().optional(),
  concentrationPercent: z.number().optional(),
  defaultRate30d: z.number().optional(),
  defaultRate60d: z.number().optional(),
  defaultRate90d: z.number().optional(),
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

export async function sacadoRoutes(fastify: FastifyInstance) {
  // Create sacado (Consultor only) - now requires fundId
  fastify.post('/', async (request, reply) => {
    try {
      const token = request.headers.authorization?.replace('Bearer ', '');
      if (!token) {
        return reply.status(401).send({ error: 'No token provided' });
      }

      const payload = verifyToken(token);
      if (payload.role !== 'CONSULTOR') {
        return reply.status(403).send({ error: 'Only consultors can create sacados' });
      }

      const body = createSacadoSchema.parse(request.body);

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

      const sacado = await fastify.prisma.sacado.create({
        data: {
          name: body.name,
          personType: body.personType,
          document: body.document,
          address: body.address,
          city: body.city,
          state: body.state,
          country: body.country,
          postalCode: body.postalCode,
          email: body.email,
          phone: body.phone,
          sector: body.sector,
          size: body.size,
          rating: body.rating,
          paymentHistory: body.paymentHistory,
          exposure: body.exposure,
          creditLimitFund: body.creditLimitFund,
          concentrationPercent: body.concentrationPercent,
          defaultRate30d: body.defaultRate30d,
          defaultRate60d: body.defaultRate60d,
          defaultRate90d: body.defaultRate90d,
          publicKey: body.publicKey,
          consultorId: payload.id,
          fundId: body.fundId
        }
      });

      return { sacado };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Invalid input', details: error.errors });
      }
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // Get sacados by fund
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

      const sacados = await fastify.prisma.sacado.findMany({
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

      return { sacados };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // List all sacados (Gestor sees all, Consultor sees own) - now includes fund info
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

      const [sacados, total] = await Promise.all([
        fastify.prisma.sacado.findMany({
          where,
          select: {
            id: true,
            name: true,
            document: true,
            personType: true,
            email: true,
            status: true,
            rating: true,
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
        fastify.prisma.sacado.count({ where })
      ]);

      return { 
        sacados,
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

  // Update sacado status (Gestor only)
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

      const sacado = await fastify.prisma.sacado.update({
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

      return { sacado };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Invalid input', details: error.errors });
      }
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });
}
