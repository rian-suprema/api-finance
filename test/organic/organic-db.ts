import { execFileSync } from 'node:child_process';

/**
 * Leitura/escrita direta no Postgres do `docker compose --profile full`, de
 * FORA da aplicação — `docker exec` + `psql`, exatamente como
 * PLANO-TESTES-ORGANICOS-FINANCE.md §4.3 pede. Não é um cliente `pg`: o
 * objetivo é provar o dado que está mesmo na tabela do container, não uma
 * segunda conexão que ainda confiaria na mesma configuração da aplicação.
 *
 * `-F '\x1f'` (unit separator) evita colisão com qualquer conteúdo de texto
 * real (nota do operador, nome de contraparte) — nunca usar vírgula/pipe.
 */
const CONTAINER = 'api-finance-postgres';
const FIELD_SEPARATOR = '\x1f';
// Caminho absoluto, não o nome resolvido via PATH (sonarjs/no-os-command-from-path)
// — em qualquer distro Linux/CI comum, `docker` vive em `/usr/bin/docker`.
const DOCKER_BIN = '/usr/bin/docker';

export function psql(sql: string): string[][] {
  const out = execFileSync(
    DOCKER_BIN,
    [
      'exec',
      '-i',
      CONTAINER,
      'psql',
      '-U',
      'users',
      '-d',
      'users',
      '-t',
      '-A',
      '-F',
      FIELD_SEPARATOR,
      '-c',
      sql,
    ],
    { encoding: 'utf8' },
  );

  return out
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .map((line) => line.split(FIELD_SEPARATOR));
}

/** Primeira linha do resultado, ou `undefined` se a consulta não devolveu nada. */
export function psqlOne(sql: string): string[] | undefined {
  return psql(sql)[0];
}

/** Quantidade de linhas — para as verificações "esperado: N". */
export function psqlCount(sql: string): number {
  const row = psqlOne(sql);
  return row ? Number(row[0]) : 0;
}
