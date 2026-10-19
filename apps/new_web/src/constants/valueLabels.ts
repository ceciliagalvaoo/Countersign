/**
 * English words for the stored values of funds and debtors (the database keeps the original codes).
 * Every screen that shows one of these values reads it through valueLabel.
 */
const VALUE_LABELS: Record<string, string> = {
  // Fund type
  FIDC: 'Receivables fund',
  FIDC_NP: 'Receivables fund (non-standard)',
  // Target investor
  GERAL: 'Open to all investors',
  QUALIFICADO: 'Tier proof required (zero-knowledge)',
  PROFISSIONAL: 'Professional',
  // Risk level
  BAIXO: 'Low',
  MEDIO: 'Medium',
  ALTO: 'High',
  // Sector
  AGRO: 'Agribusiness',
  VAREJO: 'Retail',
  INDUSTRIA: 'Industry',
  SERVICOS: 'Services',
  TECH: 'Technology',
  SAUDE: 'Health',
  OUTROS: 'Other',
  // Fund structure
  ABERTO: 'Open',
  FECHADO: 'Closed',
  RESTRITO: 'Restricted',
};

export function valueLabel(value: string | null | undefined): string | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  return VALUE_LABELS[value] ?? value;
}
