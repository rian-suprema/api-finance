import { psql, psqlCount, psqlOne } from './organic-db';
import { ALL_FINANCE_PERMISSIONS, signOrganicToken } from './organic-auth';
import { api, ensureOrganicEnvironmentUp, PREFIX } from './organic-http';

/**
 * Testes orgânicos do Balanço de Caixa — PLANO-TESTES-ORGANICOS-FINANCE.md
 * §7.1 (T01–T07b). Batem por HTTP na aplicação real do
 * `docker compose --profile full` (porta 3005) e conferem o efeito direto no
 * Postgres do compose via `docker exec ... psql` — ver §4 do plano para como
 * levantar o ambiente antes de rodar `npm run test:organic`.
 */

interface ErrorBody {
  code: string;
  message: string;
  pendingBanks?: string[];
}

const MANUAL_BANKS = ['caixa', 'onekey', 'zro', 'celcoin', 'okto', 'topazio', 'genial'];

describe('Finance — Balanço de Caixa (teste orgânico, Docker completo)', () => {
  let bearer: string;
  let bearerLimited: string;

  const confirmBank = (brand: string, bank: string, date: string, balance: number) =>
    api()
      .post(`${PREFIX}/cash-balance/${brand}/banks/${bank}/confirm`)
      .set('Authorization', bearer)
      .send({ balance, date });

  const confirmAllManualBanks = async (
    brand: string,
    date: string,
    balance = 100,
    skip: string[] = [],
  ): Promise<void> => {
    for (const bank of MANUAL_BANKS) {
      if (skip.includes(bank)) continue;
      const res = await confirmBank(brand, bank, date, balance);
      expect(res.status).toBe(204);
    }
  };

  const register = (brand: string, date: string) =>
    api()
      .post(`${PREFIX}/cash-balance/${brand}/register`)
      .set('Authorization', bearer)
      .send({ date });

  const reopen = (brand: string, date: string) =>
    api()
      .post(`${PREFIX}/cash-balance/${brand}/reopen`)
      .set('Authorization', bearer)
      .send({ date });

  const seedTrioClosing = (
    brand: string,
    date: string,
    balance: number,
    exact: boolean,
    method: 'POINT_IN_TIME' | 'RECONSTRUCTED',
  ) =>
    psql(`
      INSERT INTO trio_closing_balances (reference_date, brand, bank_account_id, balance, cutoff_at, captured_at, exact, method)
      VALUES ('${date}', '${brand}', 'acc-${brand}', ${balance}, now(), now(), ${exact}, '${method}')
      ON CONFLICT (reference_date, brand) DO UPDATE SET balance = EXCLUDED.balance, exact = EXCLUDED.exact, method = EXCLUDED.method;
    `);

  const dailyStatus = (date: string, brand: string): string | undefined =>
    psqlOne(
      `SELECT status FROM cash_balance_daily WHERE reference_date = '${date}' AND brand = '${brand}';`,
    )?.[0];

  const dayStatus = (date: string): string | undefined =>
    psqlOne(`SELECT status FROM cash_balance_days WHERE reference_date = '${date}';`)?.[0];

  const bankEntryCount = (date: string, brand: string, bank: string): number =>
    psqlCount(`
      SELECT count(*) FROM cash_balance_bank_entries e
      JOIN cash_balance_daily d ON d.id = e.daily_id
      WHERE d.reference_date = '${date}' AND d.brand = '${brand}' AND e.bank = '${bank}';
    `);

  const bankEntryRow = (date: string, brand: string, bank: string): string[] | undefined =>
    psqlOne(`
      SELECT e.confirmed, e.balance, e.confirmed_by FROM cash_balance_bank_entries e
      JOIN cash_balance_daily d ON d.id = e.daily_id
      WHERE d.reference_date = '${date}' AND d.brand = '${brand}' AND e.bank = '${bank}';
    `);

  const snapshot = (date: string, brand: string): string[] | undefined =>
    psqlOne(`
      SELECT saldo_transacional, saldo_jogadores, total_balanco FROM cash_balance_brand_snapshots s
      JOIN cash_balance_daily d ON d.id = s.daily_id
      WHERE d.reference_date = '${date}' AND d.brand = '${brand}';
    `);

  const snapshotCount = (date: string, brand: string): number =>
    psqlCount(`
      SELECT count(*) FROM cash_balance_brand_snapshots s
      JOIN cash_balance_daily d ON d.id = s.daily_id
      WHERE d.reference_date = '${date}' AND d.brand = '${brand}';
    `);

  const FIXTURE_DATES = [
    '2026-09-10',
    '2026-09-11',
    '2026-09-12',
    '2026-09-13',
    '2026-09-14',
    '2026-09-16',
    '2026-09-17',
    '2026-09-20',
  ];

  beforeAll(async () => {
    await ensureOrganicEnvironmentUp();
    bearer = `Bearer ${signOrganicToken({ permissions: ALL_FINANCE_PERMISSIONS })}`;
    bearerLimited = `Bearer ${signOrganicToken({ permissions: ALL_FINANCE_PERMISSIONS, sub: 'user-limited-brands' })}`;

    // O Postgres do `docker compose --profile full` é PERSISTENTE — limpar só
    // as datas fixas desta suíte antes de rodar, para o resultado não
    // depender de execuções anteriores (ver mesmo cuidado no arquivo de
    // conciliação).
    for (const date of FIXTURE_DATES) {
      psql(`
        DELETE FROM cash_balance_bank_entries WHERE daily_id IN (
          SELECT id FROM cash_balance_daily WHERE reference_date = '${date}'
        );
      `);
      psql(`
        DELETE FROM cash_balance_brand_snapshots WHERE daily_id IN (
          SELECT id FROM cash_balance_daily WHERE reference_date = '${date}'
        );
      `);
      psql(`DELETE FROM cash_balance_daily WHERE reference_date = '${date}';`);
      psql(`DELETE FROM cash_balance_days WHERE reference_date = '${date}';`);
      psql(`DELETE FROM trio_closing_balances WHERE reference_date = '${date}';`);
    }
  });

  describe('T01 — GET /cash-balance/summary — o resumo só mostra o que Marina pode ver', () => {
    it('usuário com acesso só à Ultra não vê os cards de Suprema/Maxima (invariante #25)', async () => {
      const res = await api()
        .get(`${PREFIX}/cash-balance/summary?date=2026-09-10`)
        .set('Authorization', bearerLimited);

      expect(res.status).toBe(200);
      const body = res.body as { depositsYesterday: { byBrand: { brand: string }[] } };
      const brands = body.depositsYesterday.byBrand.map((b) => b.brand);
      expect(brands).toEqual(['ultra']);
    });
  });

  describe('T02 — GET /cash-balance/banks — o saldo sugerido vem do último dia conhecido', () => {
    const DAY = '2026-09-10';
    const NEXT_DAY = '2026-09-11';

    beforeAll(async () => {
      await confirmAllManualBanks('suprema', DAY, 500);
      seedTrioClosing('suprema', DAY, 200, true, 'POINT_IN_TIME');
      const res = await register('suprema', DAY);
      expect(res.status).toBe(201);
    });

    it('banco manual não confirmado no dia seguinte sugere o saldo confirmado ontem, não zero', async () => {
      const res = await api()
        .get(`${PREFIX}/cash-balance/banks?date=${NEXT_DAY}`)
        .set('Authorization', bearer);
      expect(res.status).toBe(200);

      const body = res.body as {
        brands: {
          brand: string;
          banks: { bank: string; confirmed: boolean; suggested: boolean; balance: number }[];
        }[];
      };
      const suprema = body.brands.find((b) => b.brand === 'suprema');
      const manual = suprema?.banks.filter((b) => MANUAL_BANKS.includes(b.bank)) ?? [];

      expect(manual).toHaveLength(7);
      for (const bank of manual) {
        expect(bank.confirmed).toBe(false);
        expect(bank.suggested).toBe(true);
        expect(bank.balance).toBe(500);
      }
    });

    it('nenhuma linha em cash_balance_bank_entries para o dia seguinte — o valor não veio de um entry escondido', () => {
      expect(bankEntryCount(NEXT_DAY, 'suprema', 'caixa')).toBe(0);
      const total = psqlCount(`
        SELECT count(*) FROM cash_balance_bank_entries e
        JOIN cash_balance_daily d ON d.id = e.daily_id
        WHERE d.reference_date = '${NEXT_DAY}' AND d.brand = 'suprema';
      `);
      expect(total).toBe(0);
    });
  });

  describe('T03 — GET /cash-balance/history — dias registrados ≠ dias do intervalo', () => {
    const DAY_10 = '2026-09-10'; // já registrado pelo T02
    const DAY_11 = '2026-09-11'; // deliberadamente nunca tocado
    const DAY_12 = '2026-09-12';

    beforeAll(async () => {
      await confirmAllManualBanks('suprema', DAY_12, 300);
      seedTrioClosing('suprema', DAY_12, 150, true, 'POINT_IN_TIME');
      const res = await register('suprema', DAY_12);
      expect(res.status).toBe(201);
    });

    it('registeredDays conta só os dias com snapshot (10 e 12), rangeDays conta os 3 dias corridos', async () => {
      const res = await api()
        .get(`${PREFIX}/cash-balance/history?from=${DAY_10}&to=${DAY_12}`)
        .set('Authorization', bearer);
      expect(res.status).toBe(200);

      const body = res.body as {
        rangeDays: number;
        registeredDays: number;
        days: { referenceDate: string }[];
      };
      expect(body.rangeDays).toBe(3);
      expect(body.registeredDays).toBe(2);
      expect(body.days.map((d) => d.referenceDate).sort((a, b) => a.localeCompare(b))).toEqual([
        DAY_10,
        DAY_12,
      ]);
      expect(body.days.some((d) => d.referenceDate === DAY_11)).toBe(false);
    });

    it('Postgres confirma: 2 linhas CONFIRMED em cash_balance_daily no intervalo, nenhuma no dia 11', () => {
      const rows = psql(`
        SELECT reference_date, status FROM cash_balance_daily
        WHERE brand = 'suprema' AND reference_date BETWEEN '${DAY_10}' AND '${DAY_12}'
        ORDER BY reference_date;
      `);
      expect(rows).toHaveLength(2);
      expect(rows.map((r) => r[0])).toEqual([DAY_10, DAY_12]);
      expect(rows.every((r) => r[1] === 'CONFIRMED')).toBe(true);
    });
  });

  describe('T04 — GET /cash-balance/trio/refresh — os 3 estados da captura', () => {
    const DATE = '2026-09-13';

    beforeAll(() => {
      // 3 marcas do catálogo, uma para cada estado — evita colidir com a
      // constraint única (reference_date, brand) numa única marca.
      seedTrioClosing('ultra', DATE, 1800, true, 'POINT_IN_TIME');
      seedTrioClosing('maxima', DATE, 907.5, false, 'RECONSTRUCTED');
      // suprema fica de propósito sem nenhuma linha — representa "ausente".
    });

    it('ausente (suprema) / exato (ultra) / reconstruído (maxima), lido do Postgres — invariante #3', async () => {
      const res = await api()
        .get(`${PREFIX}/cash-balance/trio/refresh?date=${DATE}`)
        .set('Authorization', bearer);
      expect(res.status).toBe(200);

      const body = res.body as {
        brand: string;
        available: boolean;
        exact: boolean;
        balance: number | null;
        message?: string;
      }[];

      const suprema = body.find((b) => b.brand === 'suprema');
      expect(suprema?.available).toBe(false);
      expect(suprema?.balance).toBeNull();

      const ultra = body.find((b) => b.brand === 'ultra');
      expect(ultra?.available).toBe(true);
      expect(ultra?.exact).toBe(true);
      expect(ultra?.balance).toBe(1800);

      const maxima = body.find((b) => b.brand === 'maxima');
      expect(maxima?.available).toBe(true);
      expect(maxima?.exact).toBe(false);
      expect(maxima?.message).toContain('convergência');
    });
  });

  describe('T05a — POST /:brand/banks/trio/confirm — a Trio é somente leitura', () => {
    const DATE = '2026-09-16';

    it('confirmar bank=trio manualmente é recusado com 400 (invariante de guarda)', async () => {
      const res = await confirmBank('suprema', 'trio', DATE, 999);
      expect(res.status).toBe(400);
      expect((res.body as ErrorBody).message).toContain('somente leitura');
    });

    it('nenhuma linha nova em cash_balance_bank_entries para bank=trio — a recusa foi antes de escrever', () => {
      expect(bankEntryCount(DATE, 'suprema', 'trio')).toBe(0);
    });
  });

  describe('T05b — POST /:brand/banks/:bank/confirm — confirmar cria o dia, reconfirmar sobrescreve', () => {
    const DATE = '2026-09-17';

    it('primeira confirmação cria o dia sozinha; segunda confirmação sobrescreve o valor (upsert)', async () => {
      const first = await confirmBank('suprema', 'onekey', DATE, 10000);
      expect(first.status).toBe(204);

      const second = await confirmBank('suprema', 'onekey', DATE, 10500);
      expect(second.status).toBe(204);
    });

    it('Postgres reflete 1 linha só, balance = 10500.00, confirmed = true', () => {
      const row = bankEntryRow(DATE, 'suprema', 'onekey');
      expect(row).toBeDefined();
      expect(row?.[0]).toBe('t');
      expect(Number(row?.[1])).toBe(10500);

      const count = bankEntryCount(DATE, 'suprema', 'onekey');
      expect(count).toBe(1);

      expect(dailyStatus(DATE, 'suprema')).toBe('DRAFT');
      expect(dayStatus(DATE)).toBe('OPEN');
    });
  });

  describe('T06 — POST /:brand/register — corpo, bancos pendentes, gate da Trio, sinal, e fechamento das 3 marcas', () => {
    const DATE = '2026-09-14';

    describe('T06a — o corpo não aceita saldo', () => {
      it('campo extra "balance" no corpo → 400 (forbidNonWhitelisted, invariante #6)', async () => {
        const res = await api()
          .post(`${PREFIX}/cash-balance/suprema/register`)
          .set('Authorization', bearer)
          .send({ date: DATE, balance: 999999 });
        expect(res.status).toBe(400);
      });

      it('nenhum estado criado pela chamada rejeitada', () => {
        expect(dailyStatus(DATE, 'suprema')).toBeUndefined();
      });
    });

    describe('T06b — faltando bancos, o erro diz quais', () => {
      beforeAll(async () => {
        await confirmAllManualBanks('suprema', DATE, 400, ['okto', 'genial']);
      });

      it('5/7 confirmados → 400 com pendingBanks = ["okto","genial"]', async () => {
        const res = await api()
          .post(`${PREFIX}/cash-balance/suprema/register`)
          .set('Authorization', bearer)
          .send({ date: DATE });
        expect(res.status).toBe(400);
        expect((res.body as ErrorBody).pendingBanks).toEqual(['okto', 'genial']);
      });

      it('cash_balance_daily continua DRAFT — a chamada rejeitada não gravou nada', () => {
        expect(dailyStatus(DATE, 'suprema')).toBe('DRAFT');
      });
    });

    describe('T06c — sem captura da Trio, falha sem gravar nada pela metade', () => {
      beforeAll(async () => {
        await confirmAllManualBanks('suprema', DATE, 400, []); // completa okto e genial
      });

      it('7/7 confirmados, sem trio_closing_balances → 503 (invariante #3, corrigiu 8/18 fechamentos errados)', async () => {
        const res = await api()
          .post(`${PREFIX}/cash-balance/suprema/register`)
          .set('Authorization', bearer)
          .send({ date: DATE });
        expect(res.status).toBe(503);
      });

      it('status continua DRAFT e nenhum snapshot foi criado', () => {
        expect(dailyStatus(DATE, 'suprema')).toBe('DRAFT');
        expect(snapshotCount(DATE, 'suprema')).toBe(0);
      });
    });

    describe('T06d — o sinal é transacional menos jogadores', () => {
      beforeAll(() => {
        seedTrioClosing('suprema', DATE, 200, true, 'POINT_IN_TIME');
      });

      it('completo → 201, totalBalanco = saldoTransacional - saldoJogadores (invariante #1, bug de 30/07/2026)', async () => {
        const res = await api()
          .post(`${PREFIX}/cash-balance/suprema/register`)
          .set('Authorization', bearer)
          .send({ date: DATE });
        expect(res.status).toBe(201);

        const body = res.body as {
          saldoTransacional: number;
          saldoJogadores: number;
          totalBalanco: number;
        };
        expect(body.totalBalanco).toBe(body.saldoTransacional - body.saldoJogadores);
        expect(dailyStatus(DATE, 'suprema')).toBe('CONFIRMED');
      });

      it('Postgres: total_balanco = saldo_transacional - saldo_jogadores, exatamente', () => {
        const row = snapshot(DATE, 'suprema');
        expect(row).toBeDefined();
        const [transacional, jogadores, total] = row!.map(Number);
        expect(total).toBeCloseTo(transacional - jogadores, 2);
      });
    });

    describe('T06e — o dia só fecha com as 3 marcas', () => {
      beforeAll(async () => {
        for (const brand of ['ultra', 'maxima']) {
          await confirmAllManualBanks(brand, DATE, 350);
          seedTrioClosing(brand, DATE, 175, true, 'POINT_IN_TIME');
        }
      });

      it('registrar ultra → dayStatus OPEN (Maxima ainda falta)', async () => {
        const res = await api()
          .post(`${PREFIX}/cash-balance/ultra/register`)
          .set('Authorization', bearer)
          .send({ date: DATE });
        expect(res.status).toBe(201);
        expect((res.body as { dayStatus: string }).dayStatus).toBe('OPEN');
      });

      it('registrar maxima → dayStatus CLOSED, allBrandsConfirmed true (invariante #7)', async () => {
        const res = await api()
          .post(`${PREFIX}/cash-balance/maxima/register`)
          .set('Authorization', bearer)
          .send({ date: DATE });
        expect(res.status).toBe(201);

        const body = res.body as { dayStatus: string; allBrandsConfirmed: boolean };
        expect(body.dayStatus).toBe('CLOSED');
        expect(body.allBrandsConfirmed).toBe(true);
      });

      it('Postgres: cash_balance_days.status = CLOSED, closed_at/closed_by preenchidos', () => {
        const row = psqlOne(
          `SELECT status, closed_at, closed_by FROM cash_balance_days WHERE reference_date = '${DATE}';`,
        );
        expect(row?.[0]).toBe('CLOSED');
        expect(row?.[1]).not.toBe('');
        expect(row?.[2]).not.toBe('');
      });
    });
  });

  describe('T07a — POST /:brand/reopen — reabrir sem registro é 404', () => {
    it('marca nunca registrada nesta data → 404', async () => {
      const res = await reopen('suprema', '2026-09-20');
      expect(res.status).toBe(404);
    });
  });

  describe('T07b — POST /:brand/reopen — reabre o dia inteiro, preserva o snapshot antigo', () => {
    const DATE = '2026-09-14'; // fechado (CLOSED) pelo T06e

    it('reabrir suprema → 204', async () => {
      const res = await reopen('suprema', DATE);
      expect(res.status).toBe(204);
    });

    it('GET /cash-balance/history não traz mais suprema neste dia', async () => {
      const res = await api()
        .get(`${PREFIX}/cash-balance/history?from=${DATE}&to=${DATE}`)
        .set('Authorization', bearer);
      const body = res.body as { days: { referenceDate: string; brands: { brand: string }[] }[] };
      const day = body.days.find((d) => d.referenceDate === DATE);
      expect(day?.brands.some((b) => b.brand === 'suprema')).toBe(false);
    });

    it('Postgres: o dia inteiro volta a OPEN mesmo com ultra/maxima ainda CONFIRMED (invariante #8)', () => {
      expect(dayStatus(DATE)).toBe('OPEN');
      expect(dailyStatus(DATE, 'suprema')).toBe('DRAFT');
      expect(dailyStatus(DATE, 'ultra')).toBe('CONFIRMED');
      expect(dailyStatus(DATE, 'maxima')).toBe('CONFIRMED');
    });

    it('o snapshot antigo de suprema continua gravado — reabrir não apaga, só deixa de listar', () => {
      expect(snapshotCount(DATE, 'suprema')).toBe(1);
    });
  });
});
