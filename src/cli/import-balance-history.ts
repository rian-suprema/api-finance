/**
 * CLI de carga de balanços históricos a partir de CSV.
 *
 * Uso (imagem de produção, sem `npm`):
 *   node dist/cli/import-balance-history.js ../data/balanco-julho-2026.csv              # simula
 *   node dist/cli/import-balance-history.js ../data/balanco-julho-2026.csv --apply      # grava
 *   node dist/cli/import-balance-history.js ../data/balanco-julho-2026.csv --apply --overwrite
 *
 * Sem `--apply` nada é escrito: valida o arquivo e imprime o relatório.
 *
 * Cabeçalho esperado do CSV:
 *   reference_date,brand,celcoin,genial,zro,trio,caixa,saldo_bancos,
 *   saldo_jogadores,total_balanco
 *
 * Não é rota HTTP de propósito: carga de dado histórico é operação de
 * manutenção, feita por quem tem acesso ao servidor, não pela tela.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from '../app.module';
import { isIsoDate } from '../common/utils/date.util';
import {
  assertKnownBrand,
  type BrandKey,
} from '../modules/finance-cash-balance/cash-balance.constants';
import {
  ImportBalanceHistoryUseCase,
  type ImportBalanceRow,
} from '../modules/finance-cash-balance/domain/use-cases/import-balance-history.use-case';

/** Colunas de saldo do CSV e o banco do catálogo que cada uma alimenta. */
const BANK_COLUMNS: Record<string, string> = {
  celcoin: 'celcoin',
  genial: 'genial',
  zro: 'zro',
  trio: 'trio',
  caixa: 'caixa',
};

const IMPORTED_BY = 'cli:import-balance-history';

export interface CliOptions {
  file: string;
  apply: boolean;
  overwrite: boolean;
}

export function parseArgs(argv: string[]): CliOptions {
  const positional = argv.filter((arg) => !arg.startsWith('--'));
  const flags = new Set(argv.filter((arg) => arg.startsWith('--')).map((arg) => arg.slice(2)));

  if (!positional[0]) throw new Error('informe o caminho do CSV');

  return {
    file: resolve(process.cwd(), positional[0]),
    apply: flags.has('apply'),
    overwrite: flags.has('overwrite'),
  };
}

function parseAmount(raw: string, label: string): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${label}: valor inválido "${raw}"`);
  return value;
}

export function parseCsv(content: string): ImportBalanceRow[] {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) throw new Error('CSV sem linhas de dado');

  const header = lines[0].split(',').map((column) => column.trim());
  const indexOf = (column: string): number => {
    const index = header.indexOf(column);
    if (index < 0) throw new Error(`coluna obrigatória ausente no CSV: ${column}`);
    return index;
  };

  const dateIndex = indexOf('reference_date');
  const brandIndex = indexOf('brand');
  const transacionalIndex = indexOf('saldo_bancos');
  const jogadoresIndex = indexOf('saldo_jogadores');
  const balancoIndex = indexOf('total_balanco');
  const bankIndexes = Object.entries(BANK_COLUMNS).map(
    ([column, bank]) => [bank, indexOf(column)] as const,
  );

  return lines.slice(1).map((line, position) => {
    const cells = line.split(',').map((cell) => cell.trim());
    const label = `linha ${position + 2}`;

    const referenceDate = cells[dateIndex];
    if (!isIsoDate(referenceDate)) throw new Error(`${label}: data inválida "${referenceDate}"`);

    const brand: BrandKey = assertKnownBrand(cells[brandIndex]);

    const bankBalances = new Map<string, number>(
      bankIndexes.map(([bank, index]) => [bank, parseAmount(cells[index], `${label}/${bank}`)]),
    );

    return {
      referenceDate,
      brand,
      bankBalances,
      saldoTransacional: parseAmount(cells[transacionalIndex], `${label}/saldo_bancos`),
      saldoJogadores: parseAmount(cells[jogadoresIndex], `${label}/saldo_jogadores`),
      totalBalanco: parseAmount(cells[balancoIndex], `${label}/total_balanco`),
    };
  });
}

export async function main(): Promise<void> {
  const logger = new Logger('ImportBalanceHistoryCli');
  const options = parseArgs(process.argv.slice(2));

  const rows = parseCsv(readFileSync(options.file, 'utf8'));
  logger.log(`${rows.length} linhas lidas de ${options.file}`);

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const report = await app.get(ImportBalanceHistoryUseCase).execute({
      rows,
      importedBy: IMPORTED_BY,
      apply: options.apply,
      overwrite: options.overwrite,
    });

    const mode = options.apply ? 'GRAVANDO' : 'SIMULAÇÃO (use --apply para gravar)';
    logger.log(`Modo: ${mode}`);

    if (report.range) logger.log(`Intervalo: ${report.range.from} a ${report.range.to}`);
    logger.log(
      `${report.imported} de ${report.totalRows} linhas ${options.apply ? 'gravadas' : 'a gravar'}`,
    );

    for (const skipped of report.skipped) {
      logger.warn(`pulado ${skipped.referenceDate} ${skipped.brand}: ${skipped.reason}`);
    }

    if (report.problems.length) {
      logger.warn(`${report.problems.length} divergências de conferência:`);
      report.problems.forEach((problem) => logger.warn(`  ${problem}`));
    } else {
      logger.log('Conferência: soma dos bancos e total do balanço fecham em todas as linhas');
    }

    if (options.apply) {
      logger.log(`Dias fechados (3 marcas): ${report.daysClosed.length}`);
      logger.log(`Snapshots com acumulado mensal recalculado: ${report.accumulatedRecomputed}`);
    }

    await app.close();
    process.exit(0);
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
