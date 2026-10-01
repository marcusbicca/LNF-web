import { useCallback, useEffect, useMemo, useState } from 'react'
import { useApp } from '../context/AppContext'
import { SupabaseService } from '../services/supabase'
import type { FatorEntry } from '../types'
import {
  convsToJson,
  convVazia,
  escreverConv,
  reconstruirConvs,
  type ConvEditavel,
} from '../utils/conversao'

// ─────────────────────────────────────────────────────────────────────────────
// Materiais — editor DIRETO de cadastro de material (tabela materiais).
//
// Difere do Mapeamento, que CRIA conversão cruzando NF↔pedido: aqui a pessoa
// abre um material que já existe e ajusta na mão — descrição, UMB do MIGO, as
// referências com suas conversões (a MESMA gramática de utils/conversao) e os
// aliases (referência que empresta a conversão de outra).
//
// Escreve uma linha por vez (svc.salvarMaterial), como a tela de usuários. A
// FK materiais→fornecedores é garantida no serviço.
// ─────────────────────────────────────────────────────────────────────────────

type Row = Record<string, unknown>

interface RefBloco {
  referencia: string
  convs: ConvEditavel[]
}
interface AliasRow {
  alias: string
  para: string
}
interface FormMaterial {
  codigo: string
  descricao: string
  umbMigo: string
  refs: RefBloco[]
  aliases: AliasRow[]
}

const inp =
  'w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm ' +
  'focus:outline-none focus:border-green-500 disabled:opacity-40'
const lbl = 'block text-[11px] uppercase tracking-wide text-zinc-500 mb-1'

function parseNum(s: string): number {
  const r = Number(String(s).replace(',', '.'))
  return Number.isFinite(r) ? r : 0
}

function itemToForm(codigo: string, item: Row): FormMaterial {
  const referencias = (item.referencias ?? {}) as Record<string, FatorEntry[]>
  const refs: RefBloco[] = Object.entries(referencias).map(([referencia, convs]) => ({
    referencia,
    convs: reconstruirConvs(convs),
  }))
  const aliasObj = (item.aliasReferencias ?? {}) as Record<string, unknown>
  const aliases: AliasRow[] = Object.entries(aliasObj).map(([alias, para]) => ({
    alias,
    para: String(para ?? ''),
  }))
  return {
    codigo,
    descricao: String(item.descricao ?? ''),
    umbMigo: String(item.UmbMigo ?? ''),
    refs: refs.length ? refs : [{ referencia: '', convs: [] }],
    aliases,
  }
}

function formToItem(f: FormMaterial): Row {
  const referencias: Record<string, FatorEntry[]> = {}
  for (const r of f.refs) {
    const ref = r.referencia.trim()
    if (!ref) continue
    referencias[ref] = convsToJson(r.convs) // pode ser [] (referência sem conversão)
  }
  const aliasReferencias: Record<string, string> = {}
  for (const a of f.aliases) {
    const al = a.alias.trim()
    const pa = a.para.trim()
    if (al && pa) aliasReferencias[al] = pa
  }
  const item: Row = {
    descricao: f.descricao.trim(),
    referencias,
    // undefined → o buildMaterialRow grava null e a coluna é limpa.
    UmbMigo: f.umbMigo.trim() || undefined,
  }
  if (Object.keys(aliasReferencias).length) item.aliasReferencias = aliasReferencias
  return item
}

const formVazio: FormMaterial = {
  codigo: '',
  descricao: '',
  umbMigo: '',
  refs: [{ referencia: '', convs: [] }],
  aliases: [],
}

export function Materiais() {
  const { config } = useApp()
  const svc = useMemo(() => (config ? new SupabaseService(config) : null), [config])

  const [fornecedores, setFornecedores] = useState<string[]>([])
  const [forn, setForn] = useState('')
  const [itens, setItens] = useState<Array<{ codigo: string; item: Row }>>([])
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const [filtro, setFiltro] = useState('')
  const [selCodigo, setSelCodigo] = useState<string | null>(null)
  const [editando, setEditando] = useState(false)
  const [form, setForm] = useState<FormMaterial>(formVazio)
  const [salvando, setSalvando] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  useEffect(() => {
    if (!svc) return
    let vivo = true
    svc
      .nomesFornecedores()
      .then(ns => vivo && setFornecedores(ns))
      .catch(() => vivo && setFornecedores([]))
    return () => {
      vivo = false
    }
  }, [svc])

  const carregarItens = useCallback(async () => {
    if (!svc || !forn) {
      setItens([])
      return
    }
    setCarregando(true)
    setErro(null)
    try {
      setItens(await svc.lerMateriaisDoForn(forn))
    } catch (e) {
      setErro((e as Error).message)
      setItens([])
    } finally {
      setCarregando(false)
    }
  }, [svc, forn])

  useEffect(() => {
    void carregarItens()
    setSelCodigo(null)
    setEditando(false)
    setForm(formVazio)
    setStatus(null)
    setFiltro('')
  }, [carregarItens])

  const filtrados = useMemo(() => {
    const f = filtro.trim().toLowerCase()
    if (!f) return itens
    return itens.filter(
      i =>
        i.codigo.toLowerCase().includes(f) ||
        String(i.item.descricao ?? '').toLowerCase().includes(f),
    )
  }, [itens, filtro])

  function selecionar(codigo: string, item: Row) {
    setSelCodigo(codigo)
    setForm(itemToForm(codigo, item))
    setEditando(true)
    setStatus(null)
  }
  function novo() {
    setSelCodigo(null)
    setForm(formVazio)
    setEditando(true)
    setStatus(null)
  }

  // ── referências / conversões / aliases ─────────────────────────────────────
  function setRef(i: number, patch: Partial<RefBloco>) {
    setForm(f => ({ ...f, refs: f.refs.map((r, k) => (k === i ? { ...r, ...patch } : r)) }))
  }
  function addRef() {
    setForm(f => ({ ...f, refs: [...f.refs, { referencia: '', convs: [] }] }))
  }
  function delRef(i: number) {
    setForm(f => ({ ...f, refs: f.refs.filter((_, k) => k !== i) }))
  }
  function setConv(ri: number, ci: number, patch: Partial<ConvEditavel>) {
    setForm(f => ({
      ...f,
      refs: f.refs.map((r, k) =>
        k === ri ? { ...r, convs: r.convs.map((c, j) => (j === ci ? { ...c, ...patch } : c)) } : r,
      ),
    }))
  }
  function addConv(ri: number) {
    setForm(f => ({
      ...f,
      refs: f.refs.map((r, k) => (k === ri ? { ...r, convs: [...r.convs, convVazia()] } : r)),
    }))
  }
  function delConv(ri: number, ci: number) {
    setForm(f => ({
      ...f,
      refs: f.refs.map((r, k) =>
        k === ri ? { ...r, convs: r.convs.filter((_, j) => j !== ci) } : r,
      ),
    }))
  }
  function setAlias(i: number, patch: Partial<AliasRow>) {
    setForm(f => ({ ...f, aliases: f.aliases.map((a, k) => (k === i ? { ...a, ...patch } : a)) }))
  }
  function addAlias() {
    setForm(f => ({ ...f, aliases: [...f.aliases, { alias: '', para: '' }] }))
  }
  function delAlias(i: number) {
    setForm(f => ({ ...f, aliases: f.aliases.filter((_, k) => k !== i) }))
  }

  async function salvar() {
    if (!svc || !forn) return
    const codigo = form.codigo.trim()
    if (!codigo) {
      setStatus('⚠️ Informe o código do material.')
      return
    }
    setSalvando(true)
    setStatus(null)
    try {
      const codigoAntigo = selCodigo && selCodigo !== codigo ? selCodigo : undefined
      await svc.salvarMaterial(forn, codigo, formToItem(form), codigoAntigo)
      setStatus(`✅ "${codigo}" salvo com sucesso`)
      await carregarItens()
      setSelCodigo(codigo)
    } catch (e) {
      setStatus(`❌ ${(e as Error).message}`)
    } finally {
      setSalvando(false)
    }
  }

  async function remover() {
    if (!svc || !forn || !selCodigo) return
    if (!window.confirm(`Remover o material "${selCodigo}" de ${forn}?`)) return
    setSalvando(true)
    setStatus(null)
    try {
      await svc.removerMaterial(forn, selCodigo)
      const removido = selCodigo
      await carregarItens()
      novo()
      setEditando(false)
      setStatus(`✅ "${removido}" removido`)
    } catch (e) {
      setStatus(`❌ ${(e as Error).message}`)
    } finally {
      setSalvando(false)
    }
  }

  if (!svc) {
    return (
      <div className="p-6 text-center text-zinc-400 mt-12 space-y-2">
        Configure o transporte em <span className="text-zinc-200">Configurações</span> para editar
        materiais.
      </div>
    )
  }

  return (
    <div className="p-4 space-y-4 max-w-3xl mx-auto">
      {/* Fornecedor */}
      <div>
        <label className={lbl}>Fornecedor</label>
        <div className="flex gap-2">
          <select
            value={forn}
            onChange={e => setForn(e.target.value)}
            className={inp + ' flex-1 min-w-0'}
          >
            <option value="">— selecione um fornecedor —</option>
            {fornecedores.map(n => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          {forn && (
            <button
              onClick={() => void carregarItens()}
              className="px-3 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 rounded-lg text-sm transition-colors"
            >
              Recarregar
            </button>
          )}
        </div>
      </div>

      {erro && (
        <div className="rounded-lg p-2.5 text-sm bg-red-950 border border-red-800 text-red-300">
          ❌ {erro}
        </div>
      )}

      {forn && (
        <>
          {/* Lista de materiais */}
          <div className="space-y-2">
            <div className="flex gap-2">
              <input
                value={filtro}
                onChange={e => setFiltro(e.target.value)}
                placeholder="Filtrar por código ou descrição..."
                className={inp + ' flex-1 min-w-0'}
              />
              <button
                onClick={novo}
                className="px-3 bg-green-700 hover:bg-green-600 text-white rounded-lg text-sm font-medium transition-colors whitespace-nowrap"
              >
                + Novo
              </button>
            </div>
            <p className="text-xs text-zinc-500">
              {carregando ? 'Carregando...' : `${filtrados.length} de ${itens.length} material(is)`}
            </p>
            <div className="border border-zinc-800 rounded-lg max-h-72 overflow-y-auto divide-y divide-zinc-800">
              {filtrados.map(({ codigo, item }) => (
                <button
                  key={codigo}
                  onClick={() => selecionar(codigo, item)}
                  className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                    codigo === selCodigo ? 'bg-green-900/40 text-white' : 'text-zinc-300 hover:bg-zinc-800/60'
                  }`}
                >
                  <span className="font-mono">{codigo}</span>
                  <span className="text-zinc-500"> — {String(item.descricao ?? '')}</span>
                </button>
              ))}
              {!carregando && filtrados.length === 0 && (
                <p className="text-xs text-zinc-500 p-3">Nenhum material.</p>
              )}
            </div>
          </div>

          {/* Editor */}
          {editando && (
            <div className="border border-zinc-800 rounded-lg p-3 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className={lbl}>Código</label>
                  <input
                    value={form.codigo}
                    onChange={e => setForm(f => ({ ...f, codigo: e.target.value }))}
                    placeholder={selCodigo ? '' : 'Novo código'}
                    className={inp}
                  />
                </div>
                <div>
                  <label className={lbl}>UMB do MIGO</label>
                  <input
                    value={form.umbMigo}
                    onChange={e => setForm(f => ({ ...f, umbMigo: e.target.value }))}
                    className={inp}
                  />
                </div>
              </div>
              <div>
                <label className={lbl}>Descrição</label>
                <input
                  value={form.descricao}
                  onChange={e => setForm(f => ({ ...f, descricao: e.target.value }))}
                  className={inp}
                />
              </div>

              {/* Referências */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] uppercase tracking-wide text-zinc-500">Referências</span>
                  <button
                    onClick={addRef}
                    className="px-2 py-1 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 rounded-lg text-xs transition-colors"
                  >
                    + Referência
                  </button>
                </div>

                {form.refs.map((r, ri) => {
                  const preview = escreverConv(convsToJson(r.convs))
                  return (
                    <div
                      key={ri}
                      className="border border-zinc-800 rounded-lg p-2.5 space-y-2 bg-zinc-950/40"
                    >
                      <div className="flex items-end gap-2">
                        <div className="flex-1 min-w-0">
                          <label className={lbl}>Referência (código do fornecedor)</label>
                          <input
                            value={r.referencia}
                            onChange={e => setRef(ri, { referencia: e.target.value })}
                            className={inp}
                          />
                        </div>
                        <button
                          onClick={() => delRef(ri)}
                          className="px-3 py-2 bg-zinc-800 hover:bg-red-900 border border-zinc-700 text-zinc-400 hover:text-red-200 rounded-lg text-xs transition-colors"
                          title="Remover referência"
                        >
                          ✕
                        </button>
                      </div>

                      {r.convs.map((c, ci) => (
                        <div
                          key={ci}
                          className="border border-zinc-800 rounded-lg p-2 space-y-2 bg-zinc-900/60"
                        >
                          <div className="flex items-center justify-between">
                            <label className="flex items-center gap-2 text-xs text-zinc-400">
                              <input
                                type="checkbox"
                                checked={c.umbsIguais}
                                onChange={e => setConv(ri, ci, { umbsIguais: e.target.checked })}
                              />
                              universal (vale para qualquer unidade)
                            </label>
                            <button
                              onClick={() => delConv(ri, ci)}
                              className="text-xs text-zinc-500 hover:text-red-300"
                            >
                              remover
                            </button>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className={lbl}>De (UMB)</label>
                              <input
                                value={c.de}
                                disabled={c.umbsIguais}
                                onChange={e => setConv(ri, ci, { de: e.target.value })}
                                className={inp}
                              />
                            </div>
                            <div>
                              <label className={lbl}>Para (UMB)</label>
                              <input
                                value={c.para}
                                disabled={c.umbsIguais}
                                onChange={e => setConv(ri, ci, { para: e.target.value })}
                                className={inp}
                              />
                            </div>
                          </div>
                          <div>
                            <label className={lbl}>Fator</label>
                            <input
                              type="number"
                              step="any"
                              value={c.fator}
                              onChange={e => setConv(ri, ci, { fator: parseNum(e.target.value) })}
                              className={inp}
                            />
                          </div>
                        </div>
                      ))}

                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs text-zinc-500 truncate">
                          {preview || 'sem conversão'}
                        </span>
                        <button
                          onClick={() => addConv(ri)}
                          className="px-2 py-1 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 rounded-lg text-xs transition-colors whitespace-nowrap"
                        >
                          + Conversão
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Aliases */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] uppercase tracking-wide text-zinc-500">
                    Aliases
                  </span>
                  <button
                    onClick={addAlias}
                    className="px-2 py-1 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 rounded-lg text-xs transition-colors"
                  >
                    + Alias
                  </button>
                </div>
                <p className="text-[11px] text-zinc-500">
                  Uma referência que empresta a conversão de outra.
                </p>
                {form.aliases.map((a, i) => (
                  <div key={i} className="flex items-end gap-2">
                    <div className="flex-1 min-w-0">
                      <label className={lbl}>Alias</label>
                      <input
                        value={a.alias}
                        onChange={e => setAlias(i, { alias: e.target.value })}
                        className={inp}
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <label className={lbl}>Usa a conversão de</label>
                      <input
                        value={a.para}
                        onChange={e => setAlias(i, { para: e.target.value })}
                        list="refs-do-material"
                        className={inp}
                      />
                    </div>
                    <button
                      onClick={() => delAlias(i)}
                      className="px-3 py-2 bg-zinc-800 hover:bg-red-900 border border-zinc-700 text-zinc-400 hover:text-red-200 rounded-lg text-xs transition-colors"
                      title="Remover alias"
                    >
                      ✕
                    </button>
                  </div>
                ))}
                <datalist id="refs-do-material">
                  {form.refs
                    .map(r => r.referencia.trim())
                    .filter(Boolean)
                    .map(ref => (
                      <option key={ref} value={ref} />
                    ))}
                </datalist>
              </div>

              {status && (
                <div
                  className={`rounded-lg p-2.5 text-sm ${
                    status.startsWith('✅')
                      ? 'bg-green-950 border border-green-800 text-green-300'
                      : status.startsWith('⚠️')
                        ? 'bg-yellow-950 border border-yellow-800 text-yellow-300'
                        : 'bg-red-950 border border-red-800 text-red-300'
                  }`}
                >
                  {status}
                </div>
              )}

              <div className="flex gap-2">
                <button
                  onClick={() => void salvar()}
                  disabled={salvando}
                  className="flex-1 bg-green-600 hover:bg-green-500 disabled:opacity-40 text-white font-semibold py-2.5 rounded-lg transition-colors"
                >
                  {salvando ? 'Salvando...' : selCodigo ? 'Salvar alterações' : 'Adicionar'}
                </button>
                {selCodigo && (
                  <button
                    onClick={() => void remover()}
                    disabled={salvando}
                    className="px-4 bg-zinc-800 hover:bg-red-900 border border-zinc-700 disabled:opacity-40 text-zinc-300 hover:text-red-200 rounded-lg text-sm transition-colors"
                  >
                    Remover
                  </button>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
