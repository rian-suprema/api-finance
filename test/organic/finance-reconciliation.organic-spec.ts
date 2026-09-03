import { psql, psqlCount, psqlOne } from './organic-db';
import { ALL_FINANCE_PERMISSIONS, signOrganicToken } from './organic-auth';
import { api, ensureOrganicEnvironmentUp, PREFIX, sleep } from './organic-http';

/**
 * Testes orgânicos da Conciliação Bancária —
 * PLANO-TESTES-ORGANICOS-FINANCE.md §7.2 (T08–T14). O golden dataset do stub
 * (`RECON_DATE = 2026-06-15`, marca `suprema`) é o mesmo usado pela suíte
 * trancada `test/finance-reconciliation.e2e-spec.ts` — os números batidos lá
 * (matchedCount:4, openCount:7, resolvedCount:2, reprocessPendingCount:1) são
 * o oráculo aqui também.
 *
 * T10e usa uma segunda data, isolada (`2026-07-20`), criada em
 * `scripts/finance-dev-stubs.js` especificamente para este teste — decisão
 * registrada em conversa com o usuário (opção "data isolada nova") para não
 * tocar nas contagens trancadas do golden dataset. Ver comentário de
 * `RECON_DATE_2` no stub.
 */

interface ReconciliationBrandBody {
  brand: string;
  status: string;
  matchedCount: number;
  openCount: number;
  resolvedCount: number;
  reprocessPendingCount: number;
  reconciled: boolean;
  totals: { fees: { total: number; count: number } };
}

interface ReconciliationBody {
  brands: ReconciliationBrandBody[];
}

const GOLDEN_DATE = '2026-06-15';
const CROSSOVER_DATE = '2026-07-20'; // T10e — data isolada, ver comentário acima.

describe('Finance — Conciliação Bancária (teste orgânico, Docker completo)', () => {
  let bearer: string;

  const runAndWait = async (date: string, brand = 'suprema'): Promise<void> => {
    const res = await api()
      .post(`${PREFIX}/reconciliation/run`)
      .set('Authorization', bearer)
      .send({ date });
    expect(res.status).toBe(202);

    for (let attempt = 0; attempt < 40; attempt++) {
      const status = psqlOne(
        `SELECT status FROM reconciliation_runs WHERE reference_date = '${date}' AND brand = '${brand}' AND bank = 'trio';`,
      )?.[0];
      if (status === 'DONE') return;
      if (status === 'FAILED') throw new Error(`Conciliação de ${date}/${brand} terminou FAILED`);
      await sleep(500);
    }
    throw new Error(`Conciliação de ${date}/${brand} não chegou a DONE a tempo`);
  };

  const itemByExternalKey = (
    date: string,
    brand: string,
    externalKey: string,
  ): string[] | undefined =>
    psqlOne(`
      SELECT status, side, flow, resolved_by, platform_reprocess_pending, still_pending
      FROM reconciliation_items
      WHERE reference_date = '${date}' AND brand = '${brand}' AND external_key = '${externalKey}';
    `);

  const countItemsByExternalKey = (date: string, brand: string, externalKey: string): number =>
    psqlCount(
      `SELECT count(*) FROM reconciliation_items WHERE reference_date = '${date}' AND brand = '${brand}' AND external_key = '${externalKey}';`,
    );

  const itemByAmount = (date: string, brand: string, amount: number): string[] | undefined =>
    psqlOne(`
      SELECT status, resolved_by, resolved_at FROM reconciliation_items
      WHERE reference_date = '${date}' AND brand = '${brand}' AND side = 'BANK' AND flow = 'WITHDRAWAL' AND amount = ${amount};
    `);

  beforeAll(async () => {
    await ensureOrganicEnvironmentUp();
    bearer = `Bearer ${signOrganicToken({ permissions: ALL_FINANCE_PERMISSIONS })}`;

    // O Postgres do `docker compose --profile full` é PERSISTENTE (não é o
    // Testcontainers efêmero do e2e trancado) — rodar esta suíte mais de uma
    // vez sem limpar deixaria "conciliações" anteriores (ex.: uma chamada
    // manual de dev com `npm run auth:token`, sub `dev-user`) contaminando o
    // golden dataset e mascarando o que T12/T13/T14 realmente verificam.
    // Limpar só as datas fixas que esta suíte usa — nunca um TRUNCATE geral.
    for (const date of ['2026-06-20', '2026-06-21', '2026-06-22', GOLDEN_DATE, CROSSOVER_DATE]) {
      psql(`DELETE FROM reconciliation_items WHERE reference_date = '${date}';`);
      psql(`DELETE FROM reconciliation_runs WHERE reference_date = '${date}';`);
    }

    // Setup comum a toda a seção 7.2 do plano — rodar a conciliação do
    // golden dataset uma única vez; os testes abaixo só leem o resultado.
    await runAndWait(GOLDEN_DATE);
  });

  describe('T08 — GET /reconciliation — estorno com reprocessamento pendente não trava o "conciliado"', () => {
    /**
     * `reconciled` exige `openCount === 0` (o dia inteiro, não só o estorno) —
     * o golden dataset tem 7 pendências abertas sem relação com o estorno
     * (T10a/T12), então `reconciled` só fica `true` depois que T11–T13
     * tratarem todas elas; verificar aqui exigiria adiantar esse tratamento
     * e sairia do que este teste orgânico se propõe a provar. O invariante
     * real (`REGRAS-NEGOCIO-ROTAS.md` §3.0/§3.1, "estorno pendente de
     * reprocessamento não bloqueia") é: o estorno nunca CONTA como pendência
     * aberta — `openCount` fica em 7 (os 7 sem relação com o estorno), não 9
     * (que seria 7 + as 2 pontas do estorno, se o bug reaparecesse).
     */
    it('suprema: openCount é 7 (não 9) — o estorno nunca entra como pendência aberta; reprocessPendingCount >= 1 (invariante #20)', async () => {
      const res = await api()
        .get(`${PREFIX}/reconciliation?date=${GOLDEN_DATE}`)
        .set('Authorization', bearer);
      expect(res.status).toBe(200);

      const body = res.body as ReconciliationBody;
      const suprema = body.brands.find((b) => b.brand === 'suprema');
      expect(suprema?.openCount).toBe(7);
      expect(suprema?.reprocessPendingCount).toBeGreaterThanOrEqual(1);
    });

    it('Postgres: o item liquidado (chave ext-saq-2) é RESOLVED/sistema — reprocess_pending reflete a operação ainda aprovada na plataforma', () => {
      const row = itemByExternalKey(GOLDEN_DATE, 'suprema', 'ext-saq-2');
      expect(row).toBeDefined();
      const [status, , , resolvedBy, reprocessPending, stillPending] = row!;
      expect(status).toBe('RESOLVED');
      expect(resolvedBy).toBe('sistema');
      expect(reprocessPending).toBe('t');
      // `still_pending` aqui significa "apareceu na última execução", não
      // "aguardando tratamento" — só vira `false` quando uma execução
      // POSTERIOR deixa de encontrar a linha (retireMissingItems). Ver
      // `reconciliation-item.repository-save-result.ts`.
      expect(stillPending).toBe('t');
    });
  });

  /**
   * T09a/T09b — a severidade do dia é o PIOR status entre as 3 marcas do
   * catálogo (NOT_RUN > FAILED > RUNNING > PENDING > RECONCILED, ver
   * `get-reconciliation-history.use-case.ts`). Por isso comparar dois dias
   * só pela marca suprema exigiria também dar às outras 2 marcas um veredito
   * que não seja "nunca rodou" — senão qualquer dia parcialmente semeado
   * herda NOT_RUN de ultra/maxima, mascarando o que este teste quer provar.
   */
  describe('T09a — GET /reconciliation/history — dia sem execução é mais grave que dia com pendência', () => {
    const NOT_RUN_DATE = '2026-06-20'; // nunca conciliado, nenhuma linha em reconciliation_runs
    const PENDING_DATE = GOLDEN_DATE; // as 3 marcas já rodaram (setup do describe pai); suprema tem pendência

    it('dia nunca rodado (NOT_RUN) é pior que dia com pendência conhecida (PENDING) — invariante #17', async () => {
      const res = await api()
        .get(`${PREFIX}/reconciliation/history?from=${PENDING_DATE}&to=${NOT_RUN_DATE}`)
        .set('Authorization', bearer);
      expect(res.status).toBe(200);

      const body = res.body as { days: { referenceDate: string; status: string }[] };
      const notRunDay = body.days.find((d) => d.referenceDate === NOT_RUN_DATE);
      const pendingDay = body.days.find((d) => d.referenceDate === PENDING_DATE);

      expect(notRunDay?.status).toBe('NOT_RUN');
      expect(pendingDay?.status).toBe('PENDING');
    });

    it('Postgres: nenhuma linha em reconciliation_runs para o dia NOT_RUN', () => {
      expect(
        psqlCount(
          `SELECT count(*) FROM reconciliation_runs WHERE reference_date = '${NOT_RUN_DATE}';`,
        ),
      ).toBe(0);
    });
  });

  describe('T09b — GET /reconciliation/history — missingDays não conta execução em andamento', () => {
    const RUNNING_DATE = '2026-06-21';
    const NOT_RUN_DATE = '2026-06-22';

    beforeAll(() => {
      // As 3 marcas do catálogo têm run neste dia — só assim o pior status
      // vira RUNNING (suprema) em vez de NOT_RUN herdado de ultra/maxima.
      psql(`
        INSERT INTO reconciliation_runs (reference_date, brand, bank, status, match_key, started_at, matched_count, pending_count)
        VALUES ('${RUNNING_DATE}', 'suprema', 'trio', 'RUNNING', 'EXTERNAL_KEY', now(), 0, 0)
        ON CONFLICT (reference_date, brand, bank) DO UPDATE SET status = 'RUNNING';
      `);
      for (const brand of ['ultra', 'maxima']) {
        psql(`
          INSERT INTO reconciliation_runs (reference_date, brand, bank, status, match_key, started_at, finished_at, matched_count, pending_count)
          VALUES ('${RUNNING_DATE}', '${brand}', 'trio', 'DONE', 'EXTERNAL_KEY', now(), now(), 1, 0)
          ON CONFLICT (reference_date, brand, bank) DO UPDATE SET status = 'DONE', finished_at = now();
        `);
      }
    });

    it('missingDays conta NOT_RUN + FAILED, nunca RUNNING (invariante #18)', async () => {
      const res = await api()
        .get(`${PREFIX}/reconciliation/history?from=${RUNNING_DATE}&to=${NOT_RUN_DATE}`)
        .set('Authorization', bearer);
      expect(res.status).toBe(200);

      const body = res.body as {
        missingDays: number;
        days: { referenceDate: string; status: string }[];
      };
      const runningDay = body.days.find((d) => d.referenceDate === RUNNING_DATE);
      expect(runningDay?.status).toBe('RUNNING');
      // Só o dia NOT_RUN entra na contagem — o RUNNING, mesmo sem resultado, não é "faltante".
      expect(body.missingDays).toBe(1);
    });
  });

  describe('T10a — POST /reconciliation/run — casamento é só por chave, nunca por valor', () => {
    it('saque órfão (ext-saq-orfa) fica pendência OPEN do lado da plataforma — invariante #2', () => {
      const row = itemByExternalKey(GOLDEN_DATE, 'suprema', 'ext-saq-orfa');
      expect(row).toBeDefined();
      const [status, side, flow] = row!;
      expect(status).toBe('OPEN');
      expect(side).toBe('PLATFORM');
      expect(flow).toBe('WITHDRAWAL');
    });
  });

  describe('T10b — POST /reconciliation/run — as 3 linhas de um estorno saem juntas, ou nenhuma', () => {
    it('chave ext-saq-3 (sem reprocessamento pendente): 1 linha só (o estorno), RESOLVED/sistema — invariante #4', () => {
      expect(countItemsByExternalKey(GOLDEN_DATE, 'suprema', 'ext-saq-3')).toBe(1);

      const row = itemByExternalKey(GOLDEN_DATE, 'suprema', 'ext-saq-3');
      const [status, , , resolvedBy, reprocessPending] = row!;
      expect(status).toBe('RESOLVED');
      expect(resolvedBy).toBe('sistema');
      expect(reprocessPending).toBe('f');
    });
  });

  describe('T10c — POST /reconciliation/run — transferência para a conta própria nunca é pendência', () => {
    it('flow=TREASURY nunca vira item (nem OPEN nem RESOLVED) — só entra no total — invariante #15', () => {
      const count = psqlCount(
        `SELECT count(*) FROM reconciliation_items WHERE reference_date = '${GOLDEN_DATE}' AND brand = 'suprema' AND flow = 'TREASURY';`,
      );
      expect(count).toBe(0);
    });

    it('o total de tesouraria aparece na resposta (R$ 500,00, 1 lançamento)', async () => {
      const res = await api()
        .get(`${PREFIX}/reconciliation?date=${GOLDEN_DATE}`)
        .set('Authorization', bearer);
      const suprema = (
        res.body as {
          brands: { brand: string; totals: { treasury: { total: number; count: number } } }[];
        }
      ).brands.find((b) => b.brand === 'suprema');
      expect(suprema?.totals.treasury).toEqual({ total: 500, count: 1 });
    });
  });

  describe('T10d — POST /reconciliation/run — tarifa fica fora do casamento', () => {
    it('lançamento de tarifa (R$ 0,05) nunca vira item — só soma em feesTotal — invariante #16', async () => {
      const count = psqlCount(
        `SELECT count(*) FROM reconciliation_items WHERE reference_date = '${GOLDEN_DATE}' AND brand = 'suprema' AND amount = 0.05;`,
      );
      expect(count).toBe(0);

      const res = await api()
        .get(`${PREFIX}/reconciliation?date=${GOLDEN_DATE}`)
        .set('Authorization', bearer);
      const suprema = (res.body as ReconciliationBody).brands.find((b) => b.brand === 'suprema');
      expect(suprema?.totals.fees).toEqual({ total: 0.05, count: 1 });
    });
  });

  describe('T10e — POST /reconciliation/run — saque usa a data de liberação, não a do pedido', () => {
    beforeAll(async () => {
      await runAndWait(CROSSOVER_DATE);
    });

    it('saque liberado 5min após a virada (00:05 BRT) entra na conciliação do dia da liberação — invariante #24', () => {
      const row = psqlOne(`
        SELECT reference_date, status, side, flow, external_key, occurred_at
        FROM reconciliation_items
        WHERE brand = 'suprema' AND external_key = 'ext-saq-borda';
      `);
      expect(row).toBeDefined();
      const [referenceDate, status, side, flow] = row!;
      expect(referenceDate).toBe(CROSSOVER_DATE);
      expect(status).toBe('OPEN');
      expect(side).toBe('PLATFORM');
      expect(flow).toBe('WITHDRAWAL');
    });

    it('nenhuma linha equivalente vazou para o dia anterior (2026-07-19)', () => {
      const count = psqlCount(
        `SELECT count(*) FROM reconciliation_items WHERE brand = 'suprema' AND external_key = 'ext-saq-borda' AND reference_date = '2026-07-19';`,
      );
      expect(count).toBe(0);
    });
  });

  describe('T11 — GET /reconciliation/:brand/corrections — a busca não altera nada', () => {
    it('status/resolved_at de todos os OPEN de suprema/GOLDEN_DATE são idênticos antes e depois da busca', async () => {
      const before = psql(`
        SELECT id, status, resolved_at FROM reconciliation_items
        WHERE reference_date = '${GOLDEN_DATE}' AND brand = 'suprema' AND status = 'OPEN' ORDER BY id;
      `);

      const res = await api()
        .get(`${PREFIX}/reconciliation/suprema/corrections?date=${GOLDEN_DATE}`)
        .set('Authorization', bearer);
      expect(res.status).toBe(200);

      const after = psql(`
        SELECT id, status, resolved_at FROM reconciliation_items
        WHERE reference_date = '${GOLDEN_DATE}' AND brand = 'suprema' AND status = 'OPEN' ORDER BY id;
      `);
      expect(after).toEqual(before);
    });
  });

  describe('T12a/T12b — GET .../corrections e POST .../apply — só EXACT dá baixa, PARTIAL nunca', () => {
    it('busca: GISELE (80,00) tem candidato PARTIAL como primeiro (e único) — invariante #13', async () => {
      const res = await api()
        .get(`${PREFIX}/reconciliation/suprema/corrections?date=${GOLDEN_DATE}`)
        .set('Authorization', bearer);
      const body = res.body as {
        items: { candidates: { confidence: string; exact: boolean }[] }[];
      };
      const giseleAmount80 = body.items.find((i) => i.candidates[0]?.confidence === 'PARTIAL');
      expect(giseleAmount80).toBeDefined();
      expect(giseleAmount80?.candidates[0].exact).toBe(false);
    });

    it('apply: FABIO (45,00) e IVONE (90,00) resolvem; GISELE (80,00, PARTIAL) e HELIO (15,00, sem CPF) continuam OPEN — invariante #12', async () => {
      const res = await api()
        .post(`${PREFIX}/reconciliation/suprema/corrections/apply?date=${GOLDEN_DATE}`)
        .set('Authorization', bearer)
        .send({ date: GOLDEN_DATE });
      expect(res.status).toBe(201);

      const body = res.body as { resolvedCount: number; partialCount: number };
      expect(body.resolvedCount).toBe(2);
      expect(body.partialCount).toBe(1);

      expect(itemByAmount(GOLDEN_DATE, 'suprema', 45)?.[0]).toBe('RESOLVED');
      expect(itemByAmount(GOLDEN_DATE, 'suprema', 90)?.[0]).toBe('RESOLVED');
      expect(itemByAmount(GOLDEN_DATE, 'suprema', 80)?.[0]).toBe('OPEN');
      expect(itemByAmount(GOLDEN_DATE, 'suprema', 15)?.[0]).toBe('OPEN');
    });

    it('autor da baixa automática é o sub do JWT (marina-organic), não "sistema"', () => {
      expect(itemByAmount(GOLDEN_DATE, 'suprema', 45)?.[1]).toBe('marina-organic');
    });
  });

  describe('T12c — POST .../corrections/apply — chamar duas vezes resolve zero na segunda', () => {
    it('segunda chamada: resolvedCount 0, resolved_at preservado (idempotente) — invariante #14', async () => {
      const before = itemByAmount(GOLDEN_DATE, 'suprema', 45)?.[2];

      const res = await api()
        .post(`${PREFIX}/reconciliation/suprema/corrections/apply?date=${GOLDEN_DATE}`)
        .set('Authorization', bearer)
        .send({ date: GOLDEN_DATE });
      expect(res.status).toBe(201);
      expect((res.body as { resolvedCount: number }).resolvedCount).toBe(0);

      const after = itemByAmount(GOLDEN_DATE, 'suprema', 45)?.[2];
      expect(after).toBe(before);
    });
  });

  describe('T13a — POST /reconciliation/items/:id/resolve — nota curta recusada, nota válida grava e recalcula pending_count', () => {
    let itemId: string;
    let pendingCountBefore: number;

    beforeAll(() => {
      itemId = psqlOne(
        `SELECT id FROM reconciliation_items WHERE reference_date = '${GOLDEN_DATE}' AND brand = 'suprema' AND external_key = 'ext-saq-orfa';`,
      )![0];
      pendingCountBefore = Number(
        psqlOne(
          `SELECT pending_count FROM reconciliation_runs WHERE reference_date = '${GOLDEN_DATE}' AND brand = 'suprema' AND bank = 'trio';`,
        )?.[0],
      );
    });

    it('nota só com espaços (< 10 chars após trim) → 400', async () => {
      const res = await api()
        .post(`${PREFIX}/reconciliation/items/${itemId}/resolve`)
        .set('Authorization', bearer)
        .send({ note: '   ' });
      expect(res.status).toBe(400);
    });

    it('nota válida → 204; Postgres: RESOLVED com autor e nota; pending_count decrementado — invariante #19', async () => {
      const note = 'Pago na mão pela conta Trio, jogador autoexcluído — ver correção de saldo.';
      const res = await api()
        .post(`${PREFIX}/reconciliation/items/${itemId}/resolve`)
        .set('Authorization', bearer)
        .send({ note });
      expect(res.status).toBe(204);

      const row = psqlOne(
        `SELECT status, note, resolved_by FROM reconciliation_items WHERE id = ${itemId};`,
      );
      expect(row?.[0]).toBe('RESOLVED');
      expect(row?.[1]).toBe(note);
      expect(row?.[2]).toBe('marina-organic');

      const pendingCountAfter = Number(
        psqlOne(
          `SELECT pending_count FROM reconciliation_runs WHERE reference_date = '${GOLDEN_DATE}' AND brand = 'suprema' AND bank = 'trio';`,
        )?.[0],
      );
      expect(pendingCountAfter).toBe(pendingCountBefore - 1);
    });

    describe('T13b — item já tratado não aceita nota por cima', () => {
      it('segunda tentativa de resolver o mesmo item → 409, nota original preservada', async () => {
        const res = await api()
          .post(`${PREFIX}/reconciliation/items/${itemId}/resolve`)
          .set('Authorization', bearer)
          .send({ note: 'Segunda tentativa de tratar a mesma pendência já tratada.' });
        expect(res.status).toBe(409);

        const row = psqlOne(`SELECT note FROM reconciliation_items WHERE id = ${itemId};`);
        expect(row?.[0]).toBe(
          'Pago na mão pela conta Trio, jogador autoexcluído — ver correção de saldo.',
        );
      });
    });

    describe('T14 — POST /reconciliation/items/:id/reopen — reabrir apaga a nota, sem versionar', () => {
      it('reopen → 204; Postgres: OPEN, note/resolved_at/resolved_by voltam a NULL', async () => {
        const res = await api()
          .post(`${PREFIX}/reconciliation/items/${itemId}/reopen`)
          .set('Authorization', bearer);
        expect(res.status).toBe(204);

        const row = psqlOne(
          `SELECT status, note, resolved_at, resolved_by FROM reconciliation_items WHERE id = ${itemId};`,
        );
        expect(row?.[0]).toBe('OPEN');
        expect(row?.[1]).toBe('');
        expect(row?.[2]).toBe('');
        expect(row?.[3]).toBe('');
      });

      it('GET /reconciliation volta a contar o item como pendência aberta', async () => {
        const res = await api()
          .get(`${PREFIX}/reconciliation?date=${GOLDEN_DATE}`)
          .set('Authorization', bearer);
        const suprema = (res.body as ReconciliationBody).brands.find((b) => b.brand === 'suprema');
        expect(suprema?.openCount).toBeGreaterThanOrEqual(1);
      });
    });
  });
});
