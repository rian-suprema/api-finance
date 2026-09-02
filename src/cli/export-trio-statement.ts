/**
 * CLI de extrato diário da Trio: total de entrada e total de saída por marca.
 *
 * Uso (imagem de produção, sem `npm`):
 *   node dist/cli/export-trio-statement.js --from=2026-07-23 --to=2026-07-29
 *   node dist/cli/export-trio-statement.js --from=2026-07-23 --to=2026-07-29 --brands=ultra
 *   node dist/cli/export-trio-statement.js --from=2026-07-23 --to=2026-07-29 --out=/tmp/extrato.csv
 *
 * Destino padrão: `stdout` (`--out=-`) — a imagem tem `readOnlyRootFilesystem`,
 * então `writeFileSync` falharia em qualquer caminho dentro do pod. O operador
 * redireciona (`... > extrato.csv`) na própria máquina.
 *
 * Utilitário operacional direto sobre `TrioBankingClient` — não é use-case de
 * domínio: só soma entrada/saída por dia, nada que a conciliação decida.
 *
 * Operação lenta de propósito: cada dia é varrido por bisseção porque o cursor
 * da Trio perde lançamentos.
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from '../app.module';
import { brtMidnightUtc, isIsoDate, nextDay } from '../common/utils/date.util';
import {
  assertKnownBrand,
  BRAND_KEYS,
  findBrand,
  type BrandKey,
} from '../modules/finance-cash-balance/cash-balance.constants';
import { TrioBankingClient } from '../modules/finance-cash-balance/infrastructure/trio/trio-banking.client';

const CSV_HEADER = [
  'data',
  'marca',
  'entradas',
  'qtd_entradas',
  'saidas',
  'qtd_saidas',
  'liquido',
  'qtd_lancamentos',
  'erro',
].join(',');

export interface StatementRow {
  referenceDate: string;
  label: string;
  inflow: number;
  inflowCount: number;
  outflow: number;
  outflowCount: number;
  net: number;
  count: number;
  error?: string;
}

export interface CliOptions {
  from: string;
  to: string;
  brands: BrandKey[];
  out: string;
}

export function parseArgs(argv: string[]): CliOptions {
  const flags = new Map(
    argv
      .filter((arg) => arg.startsWith('--'))
      .map((arg) => {
        const [key, value] = arg.replace(/^--/, '').split('=');
        return [key, value ?? 'true'];
      }),
  );

  const from = flags.get('from') ?? '';
  const to = flags.get('to') ?? '';

  if (!isIsoDate(from) || !isIsoDate(to)) {
    throw new Error('informe --from e --to no formato YYYY-MM-DD');
  }

  if (from > to) throw new Error('--from não pode ser posterior a --to');

  const requested = flags.get('brands')?.split(',').filter(Boolean);
  const brands = (requested ?? [...BRAND_KEYS]).map((brand) => assertKnownBrand(brand));

  // `-` (default) escreve em stdout — nunca em arquivo dentro do pod.
  const out = flags.get('out') ?? '-';

  return { from, to, brands, out };
}

/** Duas casas com ponto decimal: CSV para planilha, sem separador de milhar. */
const amount = (value: number): string => value.toFixed(2);

function toCsv(rows: StatementRow[]): string {
  const lines = rows.map((row) =>
    [
      row.referenceDate,
      row.label,
      amount(row.inflow),
      row.inflowCount,
      amount(row.outflow),
      row.outflowCount,
      amount(row.net),
      row.count,
      row.error ? `"${row.error.replace(/"/g, "'")}"` : '',
    ].join(','),
  );

  return [CSV_HEADER, ...lines].join('\n') + '\n';
}

function logTotals(logger: Logger, rows: StatementRow[]): void {
  const byBrand = new Map<string, { inflow: number; outflow: number }>();

  for (const row of rows) {
    const total = byBrand.get(row.label) ?? { inflow: 0, outflow: 0 };
    total.inflow += row.inflow;
    total.outflow += row.outflow;
    byBrand.set(row.label, total);
  }

  for (const [label, total] of byBrand) {
    logger.log(
      `${label}: entrada ${amount(total.inflow)} | saída ${amount(total.outflow)} | líquido ${amount(total.inflow - total.outflow)}`,
    );
  }
}

async function statementFor(
  trio: TrioBankingClient,
  referenceDate: string,
  brand: BrandKey,
): Promise<StatementRow> {
  const label = findBrand(brand)?.label ?? brand;
  const accountId = trio.accountIdFor(brand);

  if (!accountId) {
    return {
      referenceDate,
      label,
      inflow: 0,
      inflowCount: 0,
      outflow: 0,
      outflowCount: 0,
      net: 0,
      count: 0,
      error: 'conta Trio não configurada para esta marca',
    };
  }

  try {
    const from = brtMidnightUtc(referenceDate);
    const to = brtMidnightUtc(nextDay(referenceDate));
    const summary = await trio.summarizeFlows(accountId, from, to);

    return {
      referenceDate,
      label,
      inflow: trio.toCurrency(summary.inflowCents),
      inflowCount: summary.inflowCount,
      outflow: trio.toCurrency(summary.outflowCents),
      outflowCount: summary.outflowCount,
      net: trio.toCurrency(summary.netCents),
      count: summary.count,
    };
  } catch (error) {
    return {
      referenceDate,
      label,
      inflow: 0,
      inflowCount: 0,
      outflow: 0,
      outflowCount: 0,
      net: 0,
      count: 0,
      error: (error as Error).message,
    };
  }
}

export async function main(): Promise<void> {
  const logger = new Logger('ExportTrioStatementCli');
  const options = parseArgs(process.argv.slice(2));

  // `--out=-` escreve o CSV em stdout: o Logger do Nest (nível `log`) também
  // escreve em stdout por padrão, e misturaria linha de progresso com linha
  // de CSV no mesmo redirecionamento. Desligar `log` (mantendo `error`/`warn`,
  // que vão para stderr) é o que mantém o stdout limpo nesse modo.
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: options.out === '-' ? ['error', 'warn'] : ['error', 'warn', 'log'],
  });

  try {
    logger.log(`Extrato de ${options.from} a ${options.to} — marcas ${options.brands.join(', ')}`);

    const trio = app.get(TrioBankingClient);
    const rows: StatementRow[] = [];

    for (let day = options.from; day <= options.to; day = nextDay(day)) {
      for (const brand of options.brands) {
        rows.push(await statementFor(trio, day, brand));
      }
      logger.log(`${day}: processado`);
    }

    const csv = toCsv(rows);
    if (options.out === '-') {
      process.stdout.write(csv);
    } else {
      writeFileSync(resolve(process.cwd(), options.out), csv, 'utf8');
      logger.log(`${rows.length} linhas escritas em ${options.out}`);
    }

    logTotals(logger, rows);

    const failed = rows.filter((row) => row.error).length;
    if (failed) logger.warn(`${failed} linha(s) com erro — ver coluna "erro" no CSV`);

    await app.close();
    process.exit(failed ? 1 : 0);
  } catch (error) {
    logger.error((error as Error).message);
    await app.close();
    process.exit(1);
  }
}

/* istanbul ignore next -- só dispara quando executado como script, nunca ao importar em teste */
if (require.main === module) {
  void main();
}
