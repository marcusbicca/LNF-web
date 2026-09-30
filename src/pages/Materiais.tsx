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

const inputCls =
  'bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-sm text-zinc-100 ' +
  'focus:outline-none focus:border-zinc-500'

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
  const [form, setForm] = useState<FormMaterial>(formVazio)
  const [salvando, setSalvando] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  // Lista de fornecedores para o seletor (uma vez).
  useEffect(() => {
    if (!svc) return
    let vivo = true
    svc
      .nomesFornecedores()
      .then(ns => {
        if (vivo) setFornecedores(ns)
      })
      .catch(() => {
        if (vivo) setFornecedores([])
      })
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
    setForm(formVazio)
    setStatus(null)
    setFiltro('')
  }, [carregarItens])

  const filtrados = useMemo(() => {
    const f = filtro.trim().toLowerCase()
    const arr = f
      ? itens.filter(
          i =>
            i.codigo.toLowerCase().includes(f) ||
            String(i.item.descricao ?? '').toLowerCase().includes(f),
        )
      : itens
    return arr
  }, [itens, filtro])

  function selecionar(codigo: string, item: Row) {
    setSelCodigo(codigo)
    setForm(itemToForm(codigo, item))
    setStatus(null)
  }

  function novo() {
    setSelCodigo(null)
    setForm(formVazio)
    setStatus(null)
  }

  // ── edição das referências / conversões / aliases ──────────────────────────
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
      setStatus(`✅ "${codigo}" salvo`)
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
      setStatus(`✅ "${removido}" removido`)
    } catch (e) {
      setStatus(`❌ ${(e as Error).message}`)
    } finally {
      setSalvando(false)
    }
  }

  if (!svc) {
    return (
      <div className="p-4 text-sm text-zinc-400">
        Configure o transporte em <span className="text-zinc-200">Configurações</span> para editar
        materiais.
      </div>
    )
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs text-zinc-400 mb-1">Fornecedor</label>
          <select
            value={forn}
            onChange={e => setForn(e.target.value)}
            className={inputCls + ' min-w-[16rem]'}
          >
            <option value="">— selecione —</option>
            {fornecedores.map(n => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
        {forn && (
          <button
            onClick={() => void carregarItens()}
            className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 rounded text-sm"
          >
            Recarregar
          </button>
        )}
        {forn && (
          <button
            onClick={novo}
            className="px-3 py-1.5 bg-green-700 hover:bg-green-600 text-white rounded text-sm font-medium"
          >
            + Novo material
          </button>
        )}
      </div>

      {erro && <p className="text-sm text-red-400">❌ {erro}</p>}

      {forn && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Lista de códigos */}
          <div className="space-y-2">
            <input
              value={filtro}
              onChange={e => setFiltro(e.target.value)}
              placeholder="Filtrar por código ou descrição…"
              className={inputCls + ' w-full'}
            />
            <p className="text-xs text-zinc-500">
              {carregando ? 'Carregando…' : `${filtrados.length} de ${itens.length} material(is)`}
            </p>
            <div className="divide-y divide-zinc-800 max-h-[60vh] overflow-y-auto border border-zinc-800 rounded">
              {filtrados.map(({ codigo, item }) => (
                <button
                  key={codigo}
                  onClick={() => selecionar(codigo, item)}
                  className={
                    'w-full text-left px-3 py-2 text-sm hover:bg-zinc-800/60 ' +
                    (selCodigo === codigo ? 'bg-zinc-800' : '')
                  }
                >
                  <span className="text-zinc-100">{codigo}</span>
                  <span className="text-zinc-500"> — {String(item.descricao ?? '')}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Editor */}
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs text-zinc-400 mb-1">Código</label>
                <input
                  value={form.codigo}
                  onChange={e => setForm(f => ({ ...f, codigo: e.target.value }))}
                  className={inputCls + ' w-full'}
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-400 mb-1">UMB do MIGO</label>
                <input
                  value={form.umbMigo}
                  onChange={e => setForm(f => ({ ...f, umbMigo: e.target.value }))}
                  className={inputCls + ' w-full'}
                />
              </div>
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Descrição</label>
              <input
                value={form.descricao}
                onChange={e => setForm(f => ({ ...f, descricao: e.target.value }))}
                className={inputCls + ' w-full'}
              />
            </div>

            {/* Referências */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-zinc-300">Referências</span>
                <button
                  onClick={addRef}
                  className="px-2 py-0.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 rounded text-xs"
                >
                  + Referência
                </button>
              </div>
              {form.refs.map((r, ri) => {
                const preview = escreverConv(convsToJson(r.convs))
                return (
                  <div key={ri} className="border border-zinc-800 rounded p-2 space-y-2">
                    <div className="flex items-center gap-2">
                      <input
                        value={r.referencia}
                        onChange={e => setRef(ri, { referencia: e.target.value })}
                        placeholder="referência (código do fornecedor)"
                        className={inputCls + ' flex-1'}
                      />
                      <button
                        onClick={() => delRef(ri)}
                        className="px-2 py-1 text-xs text-red-400 hover:text-red-300"
                        title="Remover referência"
                      >
                        ✕
                      </button>
                    </div>

                    {r.convs.map((c, ci) => (
                      <div key={ci} className="flex flex-wrap items-center gap-2 pl-2">
                        <label className="flex items-center gap-1 text-xs text-zinc-400">
                          <input
                            type="checkbox"
                            checked={c.umbsIguais}
                            onChange={e => setConv(ri, ci, { umbsIguais: e.target.checked })}
                          />
                          universal
                        </label>
                        <input
                          value={c.de}
                          disabled={c.umbsIguais}
                          onChange={e => setConv(ri, ci, { de: e.target.value })}
                          placeholder="de (UMB)"
                          className={inputCls + ' w-24 disabled:opacity-40'}
                        />
                        <input
                          value={c.para}
                          disabled={c.umbsIguais}
                          onChange={e => setConv(ri, ci, { para: e.target.value })}
                          placeholder="para (UMB)"
                          className={inputCls + ' w-24 disabled:opacity-40'}
                        />
                        <input
                          type="number"
                          step="any"
                          value={c.fator}
                          onChange={e => setConv(ri, ci, { fator: parseNum(e.target.value) })}
                          placeholder="fator"
                          className={inputCls + ' w-24'}
                        />
                        <button
                          onClick={() => delConv(ri, ci)}
                          className="px-2 py-1 text-xs text-red-400 hover:text-red-300"
                          title="Remover conversão"
                        >
                          ✕
                        </button>
                      </div>
                    ))}

                    <div className="flex items-center justify-between pl-2">
                      <span className="text-xs text-zinc-500">{preview || 'sem conversão'}</span>
                      <button
                        onClick={() => addConv(ri)}
                        className="px-2 py-0.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 rounded text-xs"
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
                <span className="text-xs font-medium text-zinc-300">
                  Aliases <span className="text-zinc-500">(uma referência usa a conversão de outra)</span>
                </span>
                <button
                  onClick={addAlias}
                  className="px-2 py-0.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 rounded text-xs"
                >
                  + Alias
                </button>
              </div>
              {form.aliases.map((a, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    value={a.alias}
                    onChange={e => setAlias(i, { alias: e.target.value })}
                    placeholder="alias"
                    className={inputCls + ' flex-1'}
                  />
                  <span className="text-zinc-500 text-sm">→</span>
                  <input
                    value={a.para}
                    onChange={e => setAlias(i, { para: e.target.value })}
                    placeholder="referência de destino"
                    list="refs-do-material"
                    className={inputCls + ' flex-1'}
                  />
                  <button
                    onClick={() => delAlias(i)}
                    className="px-2 py-1 text-xs text-red-400 hover:text-red-300"
                    title="Remover alias"
                  >
                    ✕
                  </button>
                </div>
              ))}
              <datalist id="refs-do-material">
                {form.refs.map(r => r.referencia.trim()).filter(Boolean).map(ref => (
                  <option key={ref} value={ref} />
                ))}
              </datalist>
            </div>

            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={() => void salvar()}
                disabled={salvando}
                className="px-4 py-1.5 bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white rounded text-sm font-medium"
              >
                {salvando ? 'Salvando…' : 'Salvar'}
              </button>
              {selCodigo && (
                <button
                  onClick={() => void remover()}
                  disabled={salvando}
                  className="px-4 py-1.5 bg-red-800 hover:bg-red-700 disabled:opacity-50 text-white rounded text-sm"
                >
                  Remover
                </button>
              )}
              {status && <span className="text-sm text-zinc-300">{status}</span>}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
