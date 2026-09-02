/**
 * Configuração do módulo Balanço de Caixa.
 *
 * Marcas e bancos são configuração, não dados: alterar aqui propaga para
 * backend e frontend (o frontend lê o catálogo via GET /cash-balance/banks).
 */

export const BRAND_KEYS = ['suprema', 'ultra', 'maxima'] as const;

export type BrandKey = (typeof BRAND_KEYS)[number];

export interface BrandConfig {
  key: BrandKey;
  label: string;
  /** Slug do Tenant na plataforma — usado para resolver acesso via /auth/me. */
  tenantSlug: string;
}

/**
 * A origem tinha `trioAccountEnvKey` (nome da env com o `bank_account.id` da
 * Trio) para o `TrioBankingClient` ler `process.env` na hora. Nesta trilha o
 * `TrioBankingClient.accountIdFor()` (Fase 06) já lê `trioConfig.accountIds`
 * (injetado, `{suprema,ultra,maxima}`) direto pela própria `BrandKey` — o
 * campo ficaria sem nenhum consumidor real, então não foi portado.
 */
export const BRANDS: readonly BrandConfig[] = [
  { key: 'suprema', label: 'Suprema', tenantSlug: 'suprema-bet' },
  { key: 'ultra', label: 'Ultra', tenantSlug: 'ultra-bet' },
  { key: 'maxima', label: 'Maxima', tenantSlug: 'maxima-bet' },
];

export type BankType = 'API' | 'MANUAL';

export interface BankConfig {
  key: string;
  label: string;
  type: BankType;
}

/** `API` = saldo vem de integração (read-only). `MANUAL` = usuário digita. */
export const BANKS: readonly BankConfig[] = [
  { key: 'caixa', label: 'Caixa', type: 'MANUAL' },
  { key: 'trio', label: 'Trio', type: 'API' },
  { key: 'onekey', label: 'OneKey', type: 'MANUAL' },
  { key: 'zro', label: 'Zro', type: 'MANUAL' },
  { key: 'celcoin', label: 'Celcoin', type: 'MANUAL' },
  { key: 'okto', label: 'Okto', type: 'MANUAL' },
  { key: 'topazio', label: 'Topázio', type: 'MANUAL' },
  { key: 'genial', label: 'Genial', type: 'MANUAL' },
];

export const TRIO_BANK_KEY = 'trio';

/** Intervalo aberto por padrão no histórico, em dias corridos. */
export const HISTORY_DEFAULT_RANGE_DAYS = 15;

/**
 * Teto do intervalo do histórico. Existe para o request não varrer anos de
 * snapshot de uma vez — a tela não pagina.
 */
export const HISTORY_MAX_RANGE_DAYS = 180;

export const MANUAL_BANKS = BANKS.filter((bank) => bank.type === 'MANUAL');

export function findBrand(key: string): BrandConfig | undefined {
  return BRANDS.find((brand) => brand.key === key);
}

/**
 * Defesa em profundidade do caminho job (Fase 15) — nenhum guard/RLS protege
 * jobs e CLIs hoje, então este é o único ponto que impede uma marca fora do
 * catálogo de chegar a uma escrita. Decisão do usuário entre 3 opções (ver
 * CLAUDE.md item 5): não habilitar RLS/FORCE nas tabelas do Finance, porque
 * quebraria silenciosamente as 14 rotas HTTP que não usam GUC nenhum — a
 * defesa vira esta asserção de aplicação, não uma policy de banco.
 */
export function assertKnownBrand(key: string): BrandKey {
  if (!(BRAND_KEYS as readonly string[]).includes(key)) {
    throw new Error(`marca desconhecida: ${key}`);
  }
  return key as BrandKey;
}

export function findBank(key: string): BankConfig | undefined {
  return BANKS.find((bank) => bank.key === key);
}
