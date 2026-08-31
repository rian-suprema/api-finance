#!/usr/bin/env node
/**
 * Stop hook: detecta fases recem concluidas sem dados de custo,
 * le o transcript da sessao atual, calcula custo real (por modelo) e atualiza progress.json.
 * Execucao automatica: configurado como Stop hook em .claude/settings.json
 * Execucao manual: node scripts/update-phase-cost.js < /dev/null
 *
 * So editar PROGRESS_FILE e TRANSCRIPT_DIR abaixo para adaptar a outro projeto.
 * O restante (pricing, aliases, cursor de sessao, calibracao de custo) e fonte unica
 * mantida no skill criar-fase (assets/update-phase-cost.js) — nao duplicar/editar por projeto.
 */
const fs = require('fs')
const path = require('path')

// Ajustar caminhos para o projeto atual
const PROGRESS_FILE = path.join(__dirname, '../docs/migracao-finance/fases/progress.json')
const TRANSCRIPT_DIR = path.join(
  process.env.HOME,
  '.claude/projects/-home-feh-simplified-traditional-archetype',
)

// Preco por 1M de tokens, por modelo. Reconfirmar no catalogo (skill claude-api) antes
// de alterar — valores abaixo confirmados no catalogo cache 2026-06-24.
const MODEL_PRICING = {
  'claude-opus-4-8': { inputPerM: 5.0, outputPerM: 25.0, cacheWritePerM: 6.25, cacheReadPerM: 0.5 },
  'claude-sonnet-5': { inputPerM: 3.0, outputPerM: 15.0, cacheWritePerM: 3.75, cacheReadPerM: 0.3 },
  'claude-haiku-4-5-20251001': { inputPerM: 1.0, outputPerM: 5.0, cacheWritePerM: 1.25, cacheReadPerM: 0.1 },
}

// IDs legados/sem data que ainda aparecem em transcripts antigos ou configs de fase.
const MODEL_ALIASES = {
  'claude-sonnet-4-6': 'claude-sonnet-5',
  'claude-haiku-4-5': 'claude-haiku-4-5-20251001',
}

const FALLBACK_MODEL = 'claude-sonnet-5'

function resolvePricing(modelId) {
  const key = MODEL_ALIASES[modelId] ?? modelId
  const pricing = MODEL_PRICING[key]
  if (pricing) return pricing
  console.warn(
    `⚠️  Modelo desconhecido "${modelId}" — usando pricing de ${FALLBACK_MODEL} como fallback. Reconfirmar tabela de precos (skill claude-api) e adicionar o modelo em MODEL_PRICING/MODEL_ALIASES.`
  )
  return MODEL_PRICING[FALLBACK_MODEL]
}

function calcCost(tokens, pricing) {
  return (
    (tokens.input / 1e6) * pricing.inputPerM +
    (tokens.output / 1e6) * pricing.outputPerM +
    (tokens.cacheWrite / 1e6) * pricing.cacheWritePerM +
    (tokens.cacheRead / 1e6) * pricing.cacheReadPerM
  )
}

async function readStdin() {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  const raw = chunks.join('').trim()
  if (!raw) return {}
  try {
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

function findTranscript(sessionId) {
  if (!fs.existsSync(TRANSCRIPT_DIR)) return null
  if (sessionId) {
    const candidate = path.join(TRANSCRIPT_DIR, `${sessionId}.jsonl`)
    if (fs.existsSync(candidate)) return candidate
  }
  const files = fs
    .readdirSync(TRANSCRIPT_DIR)
    .filter((f) => f.endsWith('.jsonl'))
    .map((f) => ({ f, mtime: fs.statSync(path.join(TRANSCRIPT_DIR, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)
  return files.length ? path.join(TRANSCRIPT_DIR, files[0].f) : null
}

// Chave de cursor: session_id do hook quando disponivel; senao, nome do arquivo de
// transcript (que e o proprio session_id na maioria dos ambientes) — garante que sempre
// exista uma chave estavel mesmo em execucao manual sem stdin.
function sessionKeyFor(hookSessionId, transcriptPath) {
  return hookSessionId || path.basename(transcriptPath, '.jsonl')
}

function sumTokensFromTranscript(file) {
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
  const seen = new Set()
  let input = 0,
    output = 0,
    cacheWrite = 0,
    cacheRead = 0
  for (const line of lines) {
    try {
      const ev = JSON.parse(line)
      const usage = ev?.message?.usage ?? ev?.usage
      if (!usage) continue
      const id = ev?.message?.id ?? ev?.id
      if (id && seen.has(id)) continue
      if (id) seen.add(id)
      input += usage.input_tokens ?? 0
      output += usage.output_tokens ?? 0
      cacheWrite += usage.cache_creation_input_tokens ?? 0
      cacheRead += usage.cache_read_input_tokens ?? 0
    } catch {}
  }
  return { input, output, cacheWrite, cacheRead }
}

function emptyTokens() {
  return { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 }
}

function tokensDelta(current, cursor) {
  return {
    input: Math.max(0, current.input - (cursor?.input ?? 0)),
    output: Math.max(0, current.output - (cursor?.output ?? 0)),
    cacheWrite: Math.max(0, current.cacheWrite - (cursor?.cacheWrite ?? 0)),
    cacheRead: Math.max(0, current.cacheRead - (cursor?.cacheRead ?? 0)),
  }
}

function splitEvenly(tokens, n) {
  return {
    input: tokens.input / n,
    output: tokens.output / n,
    cacheWrite: tokens.cacheWrite / n,
    cacheRead: tokens.cacheRead / n,
  }
}

// Projecao auto-calibrada: mede o quanto as fases concluidas realmente custaram vs. o
// que foi estimado, e aplica esse fator ao restante — substitui a extrapolacao linear
// ingenua (que ignorava se as fases ja fechadas vieram mais caras/baratas que o previsto).
function projectTotalCost(progress) {
  const completed = progress.phases.filter((p) => p.status === 'completed' && p.costUsd != null)
  const estimatedSumCompleted = completed.reduce((s, p) => s + (p.estimatedCostUsd || 0), 0)
  const realSumCompleted = completed.reduce((s, p) => s + (p.costUsd || 0), 0)
  const calibrationFactor = estimatedSumCompleted > 0 ? realSumCompleted / estimatedSumCompleted : 1
  const remainingEstimated = progress.phases
    .filter((p) => p.status !== 'completed')
    .reduce((s, p) => s + (p.estimatedCostUsd || 0), 0)
  const projectedTotalCostUsd = realSumCompleted + calibrationFactor * remainingEstimated
  return {
    calibrationFactor: parseFloat(calibrationFactor.toFixed(4)),
    projectedTotalCostUsd: parseFloat(projectedTotalCostUsd.toFixed(2)),
  }
}

;(async () => {
  const hook = await readStdin()
  const progress = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'))
  progress.aiCosts.sessionCursors = progress.aiCosts.sessionCursors || {}

  const phasesToUpdate = progress.phases.filter((p) => p.status === 'completed' && !p.costUsd)
  if (!phasesToUpdate.length) {
    console.log('Nenhuma fase nova para atualizar.')
    return
  }

  const transcript = findTranscript(hook?.session_id)
  if (!transcript) {
    console.log('Transcript nao encontrado.')
    return
  }

  const sessionKey = sessionKeyFor(hook?.session_id, transcript)
  const cursor = progress.aiCosts.sessionCursors[sessionKey] ?? emptyTokens()
  const totals = sumTokensFromTranscript(transcript)
  const delta = tokensDelta(totals, cursor)

  // Divide o delta de tokens desde a ultima atribuicao entre as fases que fecham AGORA
  // nesta sessao, e precifica a fatia de cada fase pelo pricing do seu proprio modelo —
  // evita cobrar o custo cheio da sessao 2x+ quando 2+ fases fecham juntas.
  const share = splitEvenly(delta, phasesToUpdate.length)
  const costs = []
  for (const phase of phasesToUpdate) {
    const pricing = resolvePricing(phase.model)
    const cost = calcCost(share, pricing)
    phase.outputTokens = Math.round(share.output)
    phase.costUsd = parseFloat(cost.toFixed(4))
    costs.push({ id: phase.id, model: phase.model, costUsd: phase.costUsd })
  }

  progress.aiCosts.sessionCursors[sessionKey] = totals

  // Recalcular totais
  const totalCost = progress.phases.filter((p) => p.costUsd).reduce((s, p) => s + p.costUsd, 0)
  const completed = progress.phases.filter((p) => p.status === 'completed').length
  const { calibrationFactor, projectedTotalCostUsd } = projectTotalCost(progress)

  progress.aiCosts.totalInputTokens = (progress.aiCosts.totalInputTokens || 0) + delta.input
  progress.aiCosts.totalOutputTokens = (progress.aiCosts.totalOutputTokens || 0) + delta.output
  progress.aiCosts.totalCacheWriteTokens = (progress.aiCosts.totalCacheWriteTokens || 0) + delta.cacheWrite
  progress.aiCosts.totalCacheReadTokens = (progress.aiCosts.totalCacheReadTokens || 0) + delta.cacheRead
  progress.aiCosts.totalCostUsd = parseFloat(totalCost.toFixed(2))
  progress.aiCosts.costCalibrationFactor = calibrationFactor
  progress.aiCosts.projectedTotalCostUsd = projectedTotalCostUsd
  progress.summary.totalCostUsd = progress.aiCosts.totalCostUsd
  progress.summary.projectedTotalCostUsd = progress.aiCosts.projectedTotalCostUsd
  progress.summary.completed = completed
  progress.summary.pending = progress.phases.filter((p) => p.status === 'pending').length
  progress.project.lastUpdated = new Date().toISOString()

  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2))
  console.log(
    `✅ Custo atualizado: ${costs.map((c) => `fase ${c.id} (${c.model}) $${c.costUsd}`).join(', ')}`
  )

  // Sync EMBEDDED const in dashboard.html so it works even when opened as file://
  const DASHBOARD_FILE = path.join(path.dirname(PROGRESS_FILE), 'dashboard.html')
  if (fs.existsSync(DASHBOARD_FILE)) {
    const html = fs.readFileSync(DASHBOARD_FILE, 'utf8')
    const embeddedJson = JSON.stringify(progress)
    const updated = html.replace(
      /const EMBEDDED = \{[\s\S]*?\};(\s*\n)/,
      `const EMBEDDED = ${embeddedJson};$1`
    )
    if (updated !== html) {
      fs.writeFileSync(DASHBOARD_FILE, updated)
      console.log('✅ dashboard.html EMBEDDED sincronizado')
    }
  }
})()
