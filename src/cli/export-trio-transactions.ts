/**
 * CLI de extrato analítico da Trio: uma linha por lançamento, para conciliação.
 *
 * Uso (imagem de produção, sem `npm`):
 *   node dist/cli/export-trio-transactions.js --from=2026-07-23 --to=2026-07-29
 *   node dist/cli/export-trio-transactions.js --from=2026-07-23 --to=2026-07-29 --types=regular,fee
 *   node dist/cli/export-trio-transactions.js --from=2026-07-29 --to=2026-07-29 --brands=ultra
 *
 * Destino padrão: `stdout` (`--out=-`), mesmo motivo do `export-trio-statement`
 * (`readOnlyRootFilesystem` da imagem).
 *
 * Por padrão só lançamentos `regular`: a tarifa vem como linha própria de
 * R$ 0,05 por operação e pode ser reconstruída pela contagem.
 *
 * ⚠️ **O CSV gerado contém nome e CNPJ/CPF de contraparte.** É dado pessoal —
 * nunca versionar, nunca subir para lugar público. Preferir rodar fora do
 * cluster ou com `--out=-` + redirecionamento na máquina do operador; se
 * precisar rodar em pod, o arquivo fica num volume efêmero de produção com
 * PII dentro — decisão de compliance, não de conveniência. Este CLI nunca
 * imprime nome/documento no terminal, só contagens.
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from '../app.module';
import { brtMidnightUtc, isIsoDate, nextDay } from '../common/utils/date.util';
import { roundCurrency } from '../common/utils/number.util';
import {
  assertKnownBrand,
  BRAND_KEYS,
  findBrand,
  type BrandKey,
} from '../modules/finance-cash-balance/cash-balance.constants';
import {
  TrioBankingClient,
  type TrioTransaction,
} from '../modules/finance-cash-balance/infrastructure/trio/trio-banking.client';

const CSV_HEADER = [
  'data',
  'marca',
  'reconciliation_id',
  'ref_id',
  'ref_type',
  'posting_type',
  'valor',
  'efeito_saldo',
  'contraparte',
  'cnpj_cpf',
  'tipo_documento',
  'bank_account_id',
  'virtual_account_id',
  'ledger_account_id',
  'end_to_end_id',
].join(',');

const DEFAULT_TYPES = ['regular'];

export interface TransactionRow {
  referenceDate: string;
  label: string;
  reconciliationId: string;
  refId: string;
  refType: string;
  postingType: string;
  amount: number;
  balanceEffect: number;
  counterpartyName: string;
  counterpartyTaxNumber: string;
  counterpartyDocumentType: string;
  bankAccountId: string;
  virtualAccountId: string;
  ledgerAccountId: string;
  endToEndId: string;
}

export interface CliOptions {
  from: string;
  to: string;
  brands: BrandKey[];
  types: string[];
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

  const types = flags.get('types')?.split(',').filter(Boolean) ?? DEFAULT_TYPES;
  const out = flags.get('out') ?? '-';

  return { from, to, brands, types, out };
}

/** Escapa campo de CSV: nome de contraparte tem vírgula e aspas. */
function cell(value: string | number): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(rows: TransactionRow[]): string {
  const lines = rows.map((row) =>
    [
      row.referenceDate,
      row.label,
      row.reconciliationId,
      row.refId,
      row.refType,
      row.postingType,
      row.amount.toFixed(2),
      row.balanceEffect.toFixed(2),
      row.counterpartyName,
      row.counterpartyTaxNumber,
      row.counterpartyDocumentType,
      row.bankAccountId,
      row.virtualAccountId,
      row.ledgerAccountId,
      row.endToEndId,
    ]
      .map(cell)
      .join(','),
  );

  return [CSV_HEADER, ...lines].join('\n') + '\n';
}

/** Só agregados: nada de contraparte ou documento no terminal. */
function logTotals(logger: Logger, rows: TransactionRow[]): void {
  const byBrand = new Map<string, { credits: number; debits: number; in: number; out: number }>();

  for (const row of rows) {
    const total = byBrand.get(row.label) ?? { credits: 0, debits: 0, in: 0, out: 0 };

    if (row.balanceEffect >= 0) {
      total.credits++;
      total.in += row.amount;
    } else {
      total.debits++;
      total.out += row.amount;
    }

    byBrand.set(row.label, total);
  }

  for (const [label, total] of byBrand) {
    logger.log(
      `${label}: ${total.credits} créditos (${total.in.toFixed(2)}) | ${total.debits} débitos (${total.out.toFixed(2)})`,
    );
  }
}

/** Campo textual da Trio é opcional no tipo — string vazia é "sem valor". */
const text = (value: string | undefined): string => value ?? '';

function toRow(
  transaction: TrioTransaction,
  trio: TrioBankingClient,
  brand: BrandKey,
  referenceDate: string,
): TransactionRow {
  const cents = Number(transaction.amount?.amount ?? 0);
  const amount = roundCurrency(Math.abs(trio.toCurrency(cents)));
  // Convenção da Trio: o saldo varia por -amount, então crédito vem negativo.
  const balanceEffect = roundCurrency(trio.toCurrency(-cents));

  return {
    referenceDate,
    label: findBrand(brand)?.label ?? brand,
    reconciliationId: text(transaction.reconciliation_id),
    refId: text(transaction.ref_id),
    refType: text(transaction.ref_type),
    postingType: text(transaction.posting_type),
    amount,
    balanceEffect,
    counterpartyName: text(transaction.counterparty_name),
    counterpartyTaxNumber: text(transaction.counterparty_tax_number),
    counterpartyDocumentType: text(transaction.document_type),
    bankAccountId: text(transaction.bank_account_id),
    virtualAccountId: text(transaction.virtual_account_id),
    ledgerAccountId: text(transaction.ledger_account_id),
    endToEndId: text(transaction.end_to_end_id),
  };
}

async function readDay(
  trio: TrioBankingClient,
  brand: BrandKey,
  referenceDate: string,
  types: Set<string>,
): Promise<{ rows: TransactionRow[]; discarded: number }> {
  const accountId = trio.accountIdFor(brand);
  if (!accountId) return { rows: [], discarded: 0 };

  const transactions = await trio.listTransactions(
    accountId,
    brtMidnightUtc(referenceDate),
    brtMidnightUtc(nextDay(referenceDate)),
  );

  const rows: TransactionRow[] = [];
  let discarded = 0;

  for (const transaction of transactions) {
    if (!types.has(transaction.transaction_type ?? '')) {
      discarded++;
      continue;
    }
    rows.push(toRow(transaction, trio, brand, referenceDate));
  }

  return { rows, discarded };
}

export async function main(): Promise<void> {
  const logger = new Logger('ExportTrioTransactionsCli');
  const options = parseArgs(process.argv.slice(2));

  // Mesmo motivo do export-trio-statement: `--out=-` escreve em stdout, e o
  // Logger de nível `log` também escreveria ali por padrão.
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: options.out === '-' ? ['error', 'warn'] : ['error', 'warn', 'log'],
  });

  try {
    logger.log(
      `Lançamentos de ${options.from} a ${options.to} — marcas ${options.brands.join(', ')}, tipos ${options.types.join(', ')}`,
    );

    const trio = app.get(TrioBankingClient);
    const types = new Set(options.types);
    const rows: TransactionRow[] = [];

    for (let day = options.from; day <= options.to; day = nextDay(day)) {
      const perBrand = await Promise.all(
        options.brands.map((brand) => readDay(trio, brand, day, types)),
      );
      const kept = perBrand.flatMap((result) => result.rows);
      const discarded = perBrand.reduce((total, result) => total + result.discarded, 0);

      rows.push(...kept);
      logger.log(`${day}: ${kept.length} lançamentos, ${discarded} descartados por tipo`);
    }

    const csv = toCsv(rows);
    if (options.out === '-') {
      process.stdout.write(csv);
    } else {
      writeFileSync(resolve(process.cwd(), options.out), csv, 'utf8');
      logger.log(`${rows.length} lançamentos escritos em ${options.out}`);
    }

    logTotals(logger, rows);
    logger.warn(
      'O CSV contém nome e CNPJ/CPF de contraparte — não versionar, não subir para lugar público',
    );

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
