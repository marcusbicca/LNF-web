import { useApp } from '../context/AppContext'
import { empresaDoCentro, explicarEmpresa } from '../utils/empresa'

// ─────────────────────────────────────────────────────────────────────────────
// QuemPediu — a atribuição de uma solicitação, igual nas três telas.
//
// As três filas (conversão, mapeamento, fornecedor) respondem a mesma pergunta
// para quem vai analisar: "de onde veio isto?". Três formatos diferentes fariam
// a mesma informação parecer três coisas, e obrigariam a reaprender a ler a cada
// aba. Um componente só é o que garante que não aconteça.
//
// ── por que a empresa é calculada aqui e não vem do banco ───────────────────
//
// Porque é regra aplicada ao centro, não dado guardado — ver utils/empresa.ts e
// a migração 0044. O que a solicitação registra é o CENTRO; a empresa sai dele,
// sempre com a informação de agora.
//
// ── e por que "—" é uma resposta ───────────────────────────────────────────
//
// Solicitação anterior à 0044 não tem centro, e não há de onde inventá-lo.
// Mostrar um travessão diz isso; mostrar a empresa padrão diria "fleury" para
// uma linha em que ninguém sabe, o que é pior que não mostrar nada.
// ─────────────────────────────────────────────────────────────────────────────

export function QuemPediu({
  usuario,
  centro,
  className = '',
}: {
  usuario: string | null | undefined
  centro: string | null | undefined
  className?: string
}) {
  const { centros } = useApp()

  const temCentro = (centro ?? '').trim() !== ''
  const emp = temCentro ? empresaDoCentro(centro, centros) : null

  return (
    <span className={`inline-flex items-center gap-1.5 font-mono text-xs ${className}`}>
      <span className="text-zinc-300" title="Usuário que gerou a solicitação">
        {usuario?.trim() || '—'}
      </span>

      <span className="text-zinc-700">·</span>
      <span className="text-zinc-400" title={temCentro ? `Centro ${centro}` : 'Solicitação sem centro registrado (anterior à migração 0044).'}>
        {temCentro ? centro : '—'}
      </span>

      <span className="text-zinc-700">·</span>
      {emp ? (
        <span
          className={emp.origem === 'coluna' ? 'text-zinc-400' : 'text-amber-500/80'}
          title={explicarEmpresa(emp, centro)}
        >
          {emp.codigo}
          {emp.origem !== 'coluna' && '?'}
        </span>
      ) : (
        <span className="text-zinc-600" title="Sem centro, não dá para dizer a empresa.">—</span>
      )}
    </span>
  )
}
