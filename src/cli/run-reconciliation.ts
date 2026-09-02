/**
 * CLI de conciliação bancária — invocado pelo `CronJob` das 04:00 BRT
 * (`daily-reconciliation`) e, sob demanda, para refazer um dia sem esperar o
 * horário do job.
 *
 * Uso (imagem de produção, sem `npm`):
 *   node dist/cli/run-reconciliation.js
 *   node dist/cli/run-reconciliation.js 2026-07-29
 *   node dist/cli/run-reconciliation.js 2026-07-29 --brands=suprema
 *
 * Sem data explícita, usa `yesterdayInBrt()` — o `CronJob` não passa data,
 * roda "às cegas" a cada execução. Concilia as marcas do CATÁLOGO, nunca de
 * um usuário: não há usuário no job.
 *
 * Leva minutos por marca — a varredura do extrato da Trio é por bisseção,
 * nunca por cursor (o cursor perde linhas; ver `TrioBankingClient`).
 */
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from '../app.module';
import {
  assertKnownBrand,
  BRAND_KEYS,
  type BrandKey,
} from '../modules/finance-cash-balance/cash-balance.constants';
import { yesterdayInBrt } from '../common/utils/date.util';
import type { RunOutcome } from '../modules/finance-reconciliation/domain/reconciliation.types';
import { RunReconciliationUseCase } from '../modules/finance-reconciliation/domain/use-cases/run-reconciliation.use-case';

export interface CliOptions {
  referenceDate: string;
  brands: BrandKey[];
}

export function parseArgs(argv: string[]): CliOptions {
  const positional = argv.filter((arg) => !arg.startsWith('--'));
  const flags = new Map(
    argv
      .filter((arg) => arg.startsWith('--'))
      .map((arg) => {
        const [key, value] = arg.replace(/^--/, '').split('=');
        return [key, value ?? 'true'];
      }),
  );

  const referenceDate = positional[0] ?? flags.get('date') ?? yesterdayInBrt();

  const requested = flags.get('brands')?.split(',').filter(Boolean);
  const brands = (requested ?? [...BRAND_KEYS]).map((brand) => assertKnownBrand(brand));

  return { referenceDate, brands };
}

function report(logger: Logger, outcome: RunOutcome): void {
  if (outcome.error) {
    logger.error(`${outcome.brand}: ${outcome.error}`);
    return;
  }

  logger.log(
    `${outcome.brand}: ${outcome.matchedCount ?? 0} conciliados, ${outcome.pendingCount ?? 0} pendências`,
  );
}

export async function main(): Promise<void> {
  const logger = new Logger('ReconciliationCli');
  const options = parseArgs(process.argv.slice(2));

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const useCase = app.get(RunReconciliationUseCase);

    logger.log(`Conciliando ${options.referenceDate} — marcas ${options.brands.join(', ')}`);

    const outcomes = await useCase.execute(options);

    let failed = 0;
    let pending = 0;

    for (const outcome of outcomes) {
      if (outcome.error) failed++;
      pending += outcome.pendingCount ?? 0;
      report(logger, outcome);
    }

    if (failed === 0) {
      logger.log(
        pending === 0
          ? `${options.referenceDate} conciliado sem pendências`
          : `${options.referenceDate} com ${pending} pendências a tratar na tela`,
      );
    }

    await app.close();
    process.exit(failed > 0 ? 1 : 0);
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
