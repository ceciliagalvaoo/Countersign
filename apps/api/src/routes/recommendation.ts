// src/routes/recommendation.ts
import { FastifyInstance } from "fastify";
import { getRecommendedFunds } from "../services/recommendationService.js";
import { requireAuth } from "../config/auth.js";

export default async function recommendationRoutes(fastify: FastifyInstance) {
  // GET /api/recommended-funds?investorId=abc123
  fastify.get("/recommended-funds", async (request, reply) => {
    try {
      const authUser = requireAuth(request, reply);
      if (!authUser) return reply;

      const { investorId } = request.query as { investorId?: string };

      if (!investorId) {
        return reply.status(400).send({ error: "investorId é obrigatório" });
      }
      if (authUser.id !== investorId && authUser.role !== "GESTOR") {
        return reply.status(403).send({ error: "Access denied" });
      }

      const recommendations = await getRecommendedFunds(fastify.prisma, investorId);

      // formato de resposta pensado pra UI de cards
      const response = recommendations.map((item) => ({
        id: item.fund.id,
        name: item.fund.name,
        symbol: item.fund.symbol,
        fundType: item.fund.fundType,
        riskLevel: item.fund.riskLevel,
        sector: item.fund.sector,
        durationMonths: item.fund.durationMonths,
        minTicket: item.fund.minTicket,
        status: item.fund.status,
        targetAmount: item.fund.targetAmount,
        description: item.fund.description,
        price: item.fund.price,
        totalIssued: item.fund.totalIssued,
        maxSupply: item.fund.maxSupply,
        score: item.score,
        reason: item.reason,
      }));

      return reply.send(response);
    } catch (err) {
      console.error(err);
      return reply
        .status(500)
        .send({ error: "Erro ao buscar fundos recomendados" });
    }
  });

  // GET /api/investor-profile?investorId=abc123
  // Endpoint adicional para ver o perfil do investidor
  fastify.get("/investor-profile", async (request, reply) => {
    try {
      const authUser = requireAuth(request, reply);
      if (!authUser) return reply;

      const { investorId } = request.query as { investorId?: string };

      if (!investorId) {
        return reply.status(400).send({ error: "investorId é obrigatório" });
      }
      if (authUser.id !== investorId && authUser.role !== "GESTOR") {
        return reply.status(403).send({ error: "Access denied" });
      }

      const { buildInvestorProfile } = await import(
        "../services/recommendationService.js"
      );
      const profile = await buildInvestorProfile(fastify.prisma, investorId);

      if (!profile) {
        return reply.send({
          message:
            "Perfil ainda não disponível. Interaja com fundos para construir seu perfil.",
          profile: null,
        });
      }

      return reply.send({ profile });
    } catch (err) {
      console.error(err);
      return reply
        .status(500)
        .send({ error: "Erro ao buscar perfil do investidor" });
    }
  });
}
