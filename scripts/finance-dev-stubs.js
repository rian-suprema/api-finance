/**
 * Stubs locais das três dependências externas do módulo Finance, para
 * desenvolver e testar sem acesso à plataforma, à Trio ou ao ClickHouse.
 *
 *   :3100  API principal do SayPlus  → GET /auth/me
 *   :9001  banking-api da Trio       → /banking/bank_accounts/:id/transactions
 *                                      /banking/virtual_accounts (lista e saldo)
 *   :8123  ClickHouse (HTTP)         → marts dw_bet.*
 *
 * Uso: node scripts/finance-dev-stubs.js
 */
const http = require('http')

// ─── API principal: marcas do usuário ────────────────────────────────────────
const TENANTS = [
  { id: '11111111-1111-1111-1111-111111111111', slug: 'suprema-bet', name: 'Suprema Bet' },
  { id: '22222222-2222-2222-2222-222222222222', slug: 'ultra-bet', name: 'ULTRA bet' },
  { id: '33333333-3333-3333-3333-333333333333', slug: 'maxima-bet', name: 'Máxima Bet' },
]

http
  .createServer((req, res) => {
    if (req.url.startsWith('/auth/me')) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ data: { id: 'dev-user', tenants: TENANTS } }))
      return
    }
    res.writeHead(404).end()
  })
  .listen(3100, () => console.log('stub API principal  :3100  /auth/me'))

// ─── Trio ────────────────────────────────────────────────────────────────────
// Formato igual ao de produção: saldo aninhado em available_balance e inteiro em
// centavos.
const TRIO_BALANCE_CENTS = {
  'acc-suprema': 250025,
  'acc-ultra': 180000,
  'acc-maxima': 90075,
}

/**
 * Conta virtual por conta bancária. O fechamento é lido daqui, com `at_datetime`
 * — é a rota que aceita instante, e a de `bank_accounts` não.
 *
 * Uma conta virtual por conta bancária, como em produção: o cliente **falha** de
 * propósito se aparecer mais de uma aprovada, porque escolher errado significaria
 * gravar o saldo da conta errada como fechamento do dia.
 */
const TRIO_VIRTUAL_ACCOUNTS = {
  'acc-suprema': { id: 'vacc-suprema', number: '11359970', description: 'Transacional (SUPREMA BET)' },
  'acc-ultra': { id: 'vacc-ultra', number: '11413652', description: 'Transacional (ULTRABET)' },
  'acc-maxima': { id: 'vacc-maxima', number: '90222326', description: 'Transacional (MAXIMA BET)' },
}

/** Saldo por conta virtual. O stub não varia no tempo: `at_datetime` é aceito e ignorado. */
const TRIO_VIRTUAL_BALANCE_CENTS = Object.fromEntries(
  Object.entries(TRIO_VIRTUAL_ACCOUNTS).map(([bankAccountId, virtual]) => [
    virtual.id,
    TRIO_BALANCE_CENTS[bankAccountId],
  ]),
)

/**
 * Dia usado só pela conciliação. Fora dele o endpoint de transações devolve
 * lista vazia, que é o que a captura do fechamento precisa para convergir de
 * primeira (o sliver dela é sempre "agora", nunca este dia).
 */
const RECON_DATE = '2026-06-15'
/** Início da janela do dia em BRT convertido para UTC — 00:00 BRT = 03:00 UTC. */
const RECON_CORE_START = `${RECON_DATE}T03:00:00`

const OWN_TAX_NUMBER = '56183358000151'

/**
 * Extrato do dia da conciliação, só na conta da Suprema. Convenção de sinal da
 * Trio: `amount` negativo é dinheiro entrando.
 *
 * Casa com os lançamentos da plataforma no stub do ClickHouse pela chave
 * (`external_id` daqui = `external_key` de lá), deixando de propósito: um
 * crédito só do banco (33,00), um crédito faltando (50,00), um débito faltando
 * (70,00), um crédito que casa com o registro do dia anterior (12,00), uma
 * transferência para o CNPJ próprio (500,00) e uma tarifa.
 *
 * Os três últimos débitos são pagamento manual a jogador bloqueado — débito sem
 * saque na plataforma, que é o que a busca de correção de saldo trata. Um para
 * cada caminho da busca: 45,00 tem correção de valor exato achada pela ponte do
 * `pix_key`, 80,00 tem correção de outro valor (evidência parcial), 15,00 é de CPF
 * que não dá para identificar e 90,00 casa pela coluna `cpf` da própria correção,
 * sem ponte nenhuma.
 *
 * O par `trio-saq-2` é o **estorno**: um débito de 60,00 que o banco devolveu no
 * mesmo dia (`ref_type = payment_refund`, crédito de mesma chave). Reproduz o caso
 * real de 15/08/2026 na Maxima. Os três lançamentos da chave — o saque da
 * plataforma, o débito e a devolução — saem da conciliação juntos, então nenhum
 * total abaixo muda por causa deles e o estorno aparece como item já tratado.
 *
 * `trio-saq-3` é o mesmo caso **sem** lançamento na plataforma: o pagamento de
 * 35,00 foi devolvido e a plataforma nunca teve saque aprovado com essa chave.
 * Cobre o outro caminho do aviso — sem `platformReprocessPending`, porque não há
 * o que reprocessar.
 */
const RECON_BANK_ROWS = [
  { cents: -10000, type: 'regular', posting: 'credit', ref: 'trio-dep-1', name: 'ANA SOUZA', tax: '11111111111' },
  { cents: -2500, type: 'regular', posting: 'credit', ref: 'trio-dep-2', name: 'BRUNO LIMA', tax: '22222222222' },
  { cents: -3300, type: 'regular', posting: 'credit', ref: 'trio-dep-3', name: 'CARLA DIAS', tax: '33333333333' },
  { cents: -1200, type: 'regular', posting: 'credit', ref: 'trio-dep-4', name: 'DANIEL ROCHA', tax: '44444444444' },
  { cents: 20000, type: 'regular', posting: 'debit', ref: 'trio-saq-1', name: 'ELISA MOURA', tax: '55555555555' },
  { cents: 6000, type: 'regular', posting: 'debit', ref: 'trio-saq-2', name: 'JOANA REIS', tax: '10101010101' },
  { cents: -6000, type: 'regular', posting: 'credit', ref: 'trio-saq-2-est', externalRef: 'trio-saq-2', refType: 'payment_refund', name: 'JOANA REIS', tax: '10101010101' },
  { cents: 3500, type: 'regular', posting: 'debit', ref: 'trio-saq-3', name: 'KLEBER TOSTA', tax: '12121212121' },
  { cents: -3500, type: 'regular', posting: 'credit', ref: 'trio-saq-3-est', externalRef: 'trio-saq-3', refType: 'payment_refund', name: 'KLEBER TOSTA', tax: '12121212121' },
  { cents: 4500, type: 'regular', posting: 'debit', ref: 'trio-man-1', name: 'FABIO NUNES', tax: '66666666666' },
  { cents: 8000, type: 'regular', posting: 'debit', ref: 'trio-man-2', name: 'GISELE PRADO', tax: '77777777777' },
  { cents: 1500, type: 'regular', posting: 'debit', ref: 'trio-man-3', name: 'HELIO BRAGA', tax: '88888888888' },
  { cents: 9000, type: 'regular', posting: 'debit', ref: 'trio-man-4', name: 'IVONE CASTRO', tax: '99999999999' },
  { cents: 50000, type: 'regular', posting: 'debit', ref: 'trio-tes-1', name: 'SUPREMA BET LTDA', tax: OWN_TAX_NUMBER },
  { cents: 5, type: 'fee', posting: 'debit', ref: 'trio-fee-1', name: 'ANA SOUZA', tax: '11111111111' },
]

/**
 * `ref_id` no formato da Trio: UUIDv7 com o instante nos 48 primeiros bits, sem
 * os bits de versão setados. É de onde o módulo tira a hora do PIX, já que
 * `transaction_date` vem nulo. Cada linha ganha um instante diferente dentro do
 * dia, a partir das 12:00 UTC.
 */
const trioRefId = (index) => {
  const at = Date.parse(`${RECON_DATE}T12:00:00.000Z`) + index * 60_000
  const hex = at.toString(16).padStart(12, '0')
  const tail = String(index).padStart(4, '0')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-1131-1eb4-e8b349bd${tail}`
}

const trioTransactions = (accountId, url) => {
  const from = new URL(url, 'http://localhost').searchParams.get('from_datetime') ?? ''

  if (accountId !== 'acc-suprema' || !from.startsWith(RECON_CORE_START)) return []

  return RECON_BANK_ROWS.map((row, index) => ({
    amount: { currency: 'BRL', amount: row.cents },
    // O estorno carrega a chave do lançamento que ele desfaz (`externalRef`), que
    // é o que permite liquidar os dois juntos.
    external_id: (row.externalRef ?? row.ref).replace('trio-', 'ext-'),
    end_to_end_id: `E00000000${RECON_DATE.replace(/-/g, '')}${row.ref}`,
    transaction_date: null,
    ref_id: trioRefId(index),
    reconciliation_id: `${row.ref}-rec`,
    ref_type: row.refType ?? (row.posting === 'credit' ? 'collection' : 'payment'),
    transaction_type: row.type,
    posting_type: row.posting,
    document_type: 'pix',
    bank_account_id: accountId,
    counterparty_name: row.name,
    counterparty_tax_number: row.tax,
  }))
}

http
  .createServer((req, res) => {
    const path = req.url.split('?')[0]

    // Lista de contas virtuais de uma conta bancária. Em produção o
    // bank_account_id é obrigatório (422 sem ele) — o stub reproduz isso.
    if (path === '/banking/virtual_accounts') {
      const bankAccountId = new URL(req.url, 'http://localhost').searchParams.get('bank_account_id')

      if (!bankAccountId) {
        res.writeHead(422, { 'content-type': 'application/json' })
        res.end(
          JSON.stringify({
            errors: [
              {
                title: 'Invalid value',
                source: { pointer: '/bank_account_id' },
                detail: 'Missing field: bank_account_id',
              },
            ],
          }),
        )
        return
      }

      const virtual = TRIO_VIRTUAL_ACCOUNTS[bankAccountId]
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify({
          data: virtual ? [{ ...virtual, status: 'approved', type: 'checking' }] : [],
        }),
      )
      return
    }

    // Saldo da conta virtual num instante. É a rota do fechamento.
    const virtualBalance = path.match(/^\/banking\/virtual_accounts\/([^/]+)\/balances$/)
    if (virtualBalance) {
      const cents = TRIO_VIRTUAL_BALANCE_CENTS[virtualBalance[1]]

      if (cents === undefined) {
        res.writeHead(404, { 'content-type': 'application/json' })
        res.end(
          JSON.stringify({
            error: {
              error_message: `Conta não encontrada. Referência: ${virtualBalance[1]}`,
              error_code: 'NOT_FOUND_RESOURCE',
            },
          }),
        )
        return
      }

      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ data: { available_balance: { currency: 'BRL', amount: cents } } }))
      return
    }

    // Saldo do agora, por conta bancária. Rejeita data, como em produção.
    const balance = path.match(/^\/banking\/bank_accounts\/([^/]+)\/balances$/)
    if (balance && TRIO_BALANCE_CENTS[balance[1]] !== undefined) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify({
          data: { available_balance: { currency: 'BRL', amount: TRIO_BALANCE_CENTS[balance[1]] } },
        }),
      )
      return
    }

    const transactions = path.match(/^\/banking\/bank_accounts\/([^/]+)\/transactions$/)
    if (transactions && TRIO_BALANCE_CENTS[transactions[1]] !== undefined) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify({
          data: trioTransactions(transactions[1], req.url),
          metadata: { after: null, before: null, has_more: false },
        }),
      )
      return
    }

    res.writeHead(404).end()
  })
  .listen(9001, () =>
    console.log('stub Trio           :9001  /banking/{bank_accounts,virtual_accounts}'),
  )

// ─── ClickHouse ──────────────────────────────────────────────────────────────
const KPI_ROWS = [
  { marca: 'Suprema', total_deposito: '150000.00', qtd_depositos: 1200, total_saque: '90000.00', qtd_saques: 400 },
  { marca: 'Ultra', total_deposito: '80000.00', qtd_depositos: 700, total_saque: '50000.00', qtd_saques: 220 },
  { marca: 'Maxima', total_deposito: '40000.00', qtd_depositos: 300, total_saque: '25000.00', qtd_saques: 110 },
]

const MONTH_ROWS = KPI_ROWS.map((row) => ({
  marca: row.marca,
  total_deposito: String(Number(row.total_deposito) * 20),
  total_saque: String(Number(row.total_saque) * 20),
}))

/**
 * Histórico: uma linha por dia do intervalo e por marca, com os mesmos valores
 * diários acima. O intervalo vem nos `param_*` que o cliente do ClickHouse
 * manda na URL, então o total do período é sempre dias × valor do dia.
 */
const buildHistoryRows = (url) => {
  const params = new URL(url, 'http://localhost').searchParams
  const from = params.get('param_data_inicio')
  const to = params.get('param_data_final')
  if (!from || !to) return []

  const rows = []
  const last = new Date(`${to}T00:00:00Z`).getTime()

  for (let at = new Date(`${from}T00:00:00Z`).getTime(); at <= last; at += 86400000) {
    const dia = new Date(at).toISOString().slice(0, 10)
    for (const row of KPI_ROWS) {
      rows.push({
        dia,
        marca: row.marca,
        total_deposito: row.total_deposito,
        total_saque: row.total_saque,
      })
    }
  }

  return rows
}

/**
 * Lançamentos da plataforma no dia da conciliação, só na Suprema. O
 * `occurred_at` sai no formato do ClickHouse (UTC, sem timezone na string).
 *
 * `external_key` é o `gateway_external_id` do mart, e é o único critério de
 * casamento: tem de ser igual ao `external_id` da linha correspondente do
 * extrato (`ext-<ref>` em `trioTransactions`). Os órfãos usam chave que não
 * existe no banco de propósito.
 *
 * `dep-borda` cai 15 minutos antes da meia-noite BRT, então é do dia anterior:
 * é o caso de registrado num dia e postado no outro, e casa pela chave com o
 * crédito de 12,00 do extrato.
 */
const RECON_PLATFORM_DEPOSITS = [
  { document_id: 'dep-a', external_key: 'ext-dep-1', occurred_at: `${RECON_DATE} 12:00:00.000`, amount: '100.00' },
  { document_id: 'dep-b', external_key: 'ext-dep-orfa', occurred_at: `${RECON_DATE} 13:00:00.000`, amount: '50.00' },
  { document_id: 'dep-c', external_key: 'ext-dep-2', occurred_at: `${RECON_DATE} 14:00:00.000`, amount: '25.00' },
  { document_id: 'dep-borda', external_key: 'ext-dep-4', occurred_at: `${RECON_DATE} 02:45:00.000`, amount: '12.00' },
]

const RECON_PLATFORM_WITHDRAWALS = [
  { document_id: 'saq-a', external_key: 'ext-saq-1', occurred_at: `${RECON_DATE} 15:00:00.000`, amount: '200.00' },
  { document_id: 'saq-b', external_key: 'ext-saq-orfa', occurred_at: `${RECON_DATE} 16:00:00.000`, amount: '70.00' },
  // Saque que o banco pagou e devolveu no mesmo dia: sai da conciliação junto com
  // as duas linhas do extrato, e por isso não entra em `platformWithdrawals`.
  { document_id: 'saq-c', external_key: 'ext-saq-2', occurred_at: `${RECON_DATE} 17:00:00.000`, amount: '60.00' },
]

/**
 * Só responde à marca da conciliação e quando a janela pedida contém o dia.
 *
 * A janela da plataforma vai de `D−1` a `D+1`, então não dá para comparar o
 * início com o dia de referência: o teste é de contenção.
 */
const buildReconRows = (url, rows) => {
  const params = new URL(url, 'http://localhost').searchParams
  const from = Date.parse(params.get('param_inicio') ?? '')
  const to = Date.parse(params.get('param_fim') ?? '')
  const coreStart = Date.parse(`${RECON_CORE_START}Z`)

  if (params.get('param_marca') !== 'suprema') return []
  if (!Number.isFinite(from) || !Number.isFinite(to)) return []

  return from <= coreStart && coreStart < to ? rows : []
}

/**
 * Ponte CPF → `client_id`, que em produção sai de `fct_withdrawal.pix_key`.
 *
 * `HELIO BRAGA` (`88888888888`) está fora de propósito: é o jogador que nunca
 * sacou pela plataforma, então a busca não consegue identificá-lo. É o caso mais
 * comum no dado real (63% das pendências de 12/08/2026).
 */
const RECON_PLAYER_BRIDGE = [
  { tax_number: '66666666666', brand: 'suprema', client_id: '900001' },
  { tax_number: '77777777777', brand: 'suprema', client_id: '900002' },
]

/** Data deslocada em dias, para as correções caírem dentro da janela de 7 dias. */
const shiftDay = (isoDate, days) =>
  new Date(new Date(`${isoDate}T00:00:00Z`).getTime() + days * 86_400_000)
    .toISOString()
    .slice(0, 10)

/**
 * Correções de saldo para baixo. A de 45,00 fecha no centavo com o débito do
 * FABIO; a de 30,00 é menor que o débito de 80,00 da GISELE, e por isso vira
 * evidência parcial em vez de explicação.
 *
 * O alias da data é `correction_day` porque chamar de `correction_date` faria o
 * ClickHouse resolver o nome do WHERE para o `toString` do SELECT.
 */
const RECON_CORRECTIONS = [
  {
    correction_id: 'bc:corr-900003',
    brand: 'suprema',
    client_id: '900003',
    // Único com `cpf` preenchido: reproduz a coluna nova de `fct_correction`. Este
    // jogador não está na ponte do `pix_key` de propósito — só a coluna o alcança.
    tax_number: '99999999999',
    correction_day: shiftDay(RECON_DATE, -3),
    occurred_at: `${shiftDay(RECON_DATE, -3)} 16:00:00.000`,
    amount: '90.00',
  },
  {
    correction_id: 'bc:corr-900001',
    brand: 'suprema',
    client_id: '900001',
    tax_number: '',
    correction_day: shiftDay(RECON_DATE, -4),
    occurred_at: `${shiftDay(RECON_DATE, -4)} 17:30:00.000`,
    amount: '45.00',
  },
  {
    correction_id: 'bc:corr-900002',
    brand: 'suprema',
    client_id: '900002',
    tax_number: '',
    correction_day: shiftDay(RECON_DATE, -2),
    occurred_at: `${shiftDay(RECON_DATE, -2)} 18:00:00.000`,
    amount: '30.00',
  },
]

/** Só devolve o CPF que a busca pediu — o filtro `IN` chega no `param_documentos`. */
const buildBridgeRows = (url) => {
  const asked = new URL(url, 'http://localhost').searchParams.get('param_documentos') ?? ''
  return RECON_PLAYER_BRIDGE.filter((row) => asked.includes(row.tax_number))
}

/**
 * Duas consultas caem aqui, e o parâmetro distingue: `param_documentos` é a busca
 * pelo CPF na própria linha da correção; `param_clientes` é a que vem depois da
 * ponte do `pix_key`. Só a linha com `tax_number` preenchido responde à primeira,
 * reproduzindo a coluna `cpf` ainda quase vazia em produção.
 */
const buildCorrectionRows = (url) => {
  const params = new URL(url, 'http://localhost').searchParams

  if (params.get('param_direcao') !== 'down') return []

  const from = params.get('param_dia_inicio') ?? ''
  const to = params.get('param_dia_fim') ?? ''
  const inWindow = (row) => row.correction_day >= from && row.correction_day <= to

  const documents = params.get('param_documentos')
  if (documents !== null) {
    return RECON_CORRECTIONS.filter(
      (row) => row.tax_number !== '' && documents.includes(row.tax_number) && inWindow(row),
    )
  }

  const clients = params.get('param_clientes') ?? ''
  return RECON_CORRECTIONS.filter((row) => clients.includes(row.client_id) && inWindow(row))
}

const PLAYERS_ROWS = [
  { marca: 'Suprema', saldo: '10000.00' },
  { marca: 'Ultra', saldo: '5000.00' },
  { marca: 'Maxima', saldo: '2500.00' },
]

// Resultado vazio tem de ser corpo vazio: uma linha em branco faz o cliente do
// ClickHouse falhar ao parsear JSONEachRow, e o módulo traduz isso para
// "Data warehouse indisponível".
const toJsonEachRow = (rows) =>
  rows.length === 0 ? '' : rows.map((row) => JSON.stringify(row)).join('\n') + '\n'

http
  .createServer((req, res) => {
    if (req.method === 'GET' && req.url.startsWith('/ping')) {
      res.writeHead(200, { 'content-type': 'text/plain' }).end('Ok.\n')
      return
    }

    let body = ''
    req.on('data', (chunk) => (body += chunk))
    req.on('end', () => {
      let rows = []
      if (body.includes('fct_sigap_saldo_diario')) rows = PLAYERS_ROWS
      else if (body.includes('fct_correction')) rows = buildCorrectionRows(req.url)
      // A ponte CPF → client_id também lê `fct_withdrawal`: casa antes dela.
      else if (body.includes('pix_key')) rows = buildBridgeRows(req.url)
      else if (body.includes('fct_deposit')) rows = buildReconRows(req.url, RECON_PLATFORM_DEPOSITS)
      else if (body.includes('fct_withdrawal')) rows = buildReconRows(req.url, RECON_PLATFORM_WITHDRAWALS)
      // A do histórico também filtra por intervalo: casa antes da mensal.
      else if (body.includes('GROUP BY dia, marca')) rows = buildHistoryRows(req.url)
      else if (body.includes('toDate({data_inicio:String})')) rows = MONTH_ROWS
      else if (body.includes('fct_kpi_daily')) rows = KPI_ROWS

      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(toJsonEachRow(rows))
    })
  })
  .listen(8123, () => console.log('stub ClickHouse     :8123  dw_bet.*'))

console.log('\nCtrl+C para parar.')
