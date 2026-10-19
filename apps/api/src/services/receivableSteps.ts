export function describeReceivableStep(rec: any, id: string) {
  const details: Record<string, { label: string; entity: { id: string; name: string; kind: string } }> = {
    fund: { label: 'Register fund', entity: { id: rec.fundId, name: rec.fund.name, kind: 'fund' } },
    cedente: { label: 'Register assignor', entity: { id: rec.cedente.id, name: rec.cedente.name, kind: 'cedente' } },
    sacado: { label: 'Register debtor', entity: { id: rec.sacadoId, name: rec.sacado.name, kind: 'sacado' } },
    register: { label: 'Register receivable', entity: { id: rec.id, name: rec.id, kind: 'receivable' } },
    pay: { label: 'Pay receivable', entity: { id: rec.id, name: rec.id, kind: 'receivable' } },
    distribute: { label: 'Distribute payment', entity: { id: rec.id, name: rec.id, kind: 'receivable' } },
  };
  return { stepId: id, ...details[id] };
}
