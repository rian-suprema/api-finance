/**
 * CLI de captura e backfill do fechamento da Trio — invocado pelo `CronJob`
 * de `00:03` BRT (`trio-closing-capture`).
 *
 * Uso (imagem de produção, sem `npm`):
 *   node dist/cli/capture-trio-closing.js 2026-07-29
 *   node dist/cli/capture-trio-closing.js 2026-07-29 --overwrite
 *   node dist/cli/capture-trio-closing.js 2026-07-29 --brands=ultra
 *
 * Dia que acabou de fechar e dia passado custam o mesmo: é uma leitura do
 * saldo no instante do corte, uma requisição por marca. `--overwrite`
 * reescreve fechamento já gravado — o job agendado nunca passa essa flag.
 */
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from '../app.module';
import { isIsoDate } from '../common/utils/date.util';
import {
  assertKnownBrand,
  BRAND_KEYS,
  type BrandKey,
} from '../modules/finance-cash-balance/cash-balance.constants';
import { CaptureTrioClosingUseCase } from '../modules/finance-cash-balance/domain/use-cases/capture-trio-closing.use-case';

export interface CliOptions {
  referenceDate: string;
  overwrite: boolean;
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

  const referenceDate = positional[0];
  if (!referenceDate || !isIsoDate(referenceDate)) {
    throw new Error('informe a data de referência no formato YYYY-MM-DD');
  }

  const requested = flags.get('brands')?.split(',').filter(Boolean);
  const brands = (requested ?? [...BRAND_KEYS]).map((brand) => assertKnownBrand(brand));

  return { referenceDate, overwrite: flags.get('overwrite') === 'true', brands };
}

export async function main(): Promise<void> {
  const logger = new Logger('CaptureTrioClosingCli');
  const options = parseArgs(process.argv.slice(2));

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const useCase = app.get(CaptureTrioClosingUseCase);

    logger.log(
      `Fechamento de ${options.referenceDate} — marcas ${options.brands.join(', ')}${options.overwrite ? ', sobrescrevendo' : ''}`,
    );

    const results = await useCase.execute(options);

    let failed = 0;
    for (const result of results) {
      if (result.error) {
        failed++;
        logger.error(`${result.brand}: ${result.error}`);
        continue;
      }
      logger.log(`${result.brand}: ${result.balance} (${result.saved ? 'gravado' : 'já existia'})`);
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
