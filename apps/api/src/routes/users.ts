import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import jwt from 'jsonwebtoken';

import { JWT_SECRET } from '../config/env.js';
import { isPublicKey } from '../services/stellarVerify.js';

const approvalSchema = z.object({
  status: z.enum(['APPROVED', 'REJECTED'])
});

function verifyToken(token: string) {
  try {
    return jwt.verify(token, JWT_SECRET) as any;
  } catch {
    throw new Error('Invalid token');
  }
}

export async function userRoutes(fastify: FastifyInstance) {
  // Get consultores (only for gestores)
  fastify.get('/consultores', async (request, reply) => {
    try {
      const token = request.headers.authorization?.replace('Bearer ', '');
      if (!token) {
        return reply.status(401).send({ error: 'No token provided' });
      }

      const user = verifyToken(token);
      
      if (user.role !== 'GESTOR') {
        return reply.status(403).send({ error: 'Access denied' });
      }

      const consultores = await fastify.prisma.user.findMany({
        where: { role: 'CONSULTOR' },
        select: {
          id: true,
          email: true,
          role: true,
          status: true,
          createdAt: true
        },
        orderBy: { createdAt: 'desc' }
      });

      return { consultores };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // Get investidores (only for gestores)
  fastify.get('/investidores', async (request, reply) => {
    try {
      const token = request.headers.authorization?.replace('Bearer ', '');
      if (!token) {
        return reply.status(401).send({ error: 'No token provided' });
      }

      const user = verifyToken(token);
      
      if (user.role !== 'GESTOR') {
        return reply.status(403).send({ error: 'Access denied' });
      }

      const investidores = await fastify.prisma.user.findMany({
        where: { role: 'INVESTIDOR' },
        select: {
          id: true,
          email: true,
          role: true,
          status: true,
          createdAt: true
        },
        orderBy: { createdAt: 'desc' }
      });

      return { investidores };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // Approve/reject user (consultor or investidor)
  fastify.patch('/:id/approval', async (request, reply) => {
    try {
      const token = request.headers.authorization?.replace('Bearer ', '');
      if (!token) {
        return reply.status(401).send({ error: 'No token provided' });
      }

      const user = verifyToken(token);
      const params = request.params as { id: string };
      
      if (user.role !== 'GESTOR') {
        return reply.status(403).send({ error: 'Access denied' });
      }

      const body = approvalSchema.parse(request.body);
      
      const targetUser = await fastify.prisma.user.findUnique({
        where: { id: params.id }
      });

      if (!targetUser) {
        return reply.status(404).send({ error: 'User not found' });
      }

      // Verify user is either consultor or investidor
      if (targetUser.role !== 'CONSULTOR' && targetUser.role !== 'INVESTIDOR') {
        return reply.status(400).send({ error: 'Only consultors and investors can be approved' });
      }

      const updatedUser = await fastify.prisma.user.update({
        where: { id: params.id },
        data: { status: body.status },
        select: {
          id: true,
          email: true,
          role: true,
          status: true,
          createdAt: true
        }
      });

      return { user: updatedUser };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Invalid input', details: error.errors });
      }
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // Update wallet public key
  fastify.patch('/wallet', async (request, reply) => {
    try {
      const token = request.headers.authorization?.replace('Bearer ', '');
      if (!token) {
        return reply.status(401).send({ error: 'No token provided' });
      }

      const user = verifyToken(token);
      const { publicKey } = z.object({ 
        publicKey: z.string().refine(isPublicKey, 'Invalid Stellar public key'),
      }).parse(request.body);

      const updatedUser = await fastify.prisma.user.update({
        where: { id: user.id },
        data: { publicKey },
        select: {
          id: true,
          email: true,
          role: true,
          publicKey: true
        }
      });

      return { user: updatedUser };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({ error: 'Invalid input', details: error.errors });
      }
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });
}