// ─── One diagnostic charge per quote ──────────────────────────────────────────
//
// $290 TO DIAGNOSE ONE UNIT. HD QuickWrench put a 1-hour "Diagnostic Fee" LABOR line on
// the quote and sent no diagnostic setting, so the quote form also ticked the shop's
// $145 diagnostic FEE from Settings: $145 + $145. The guided diagnostic did the same
// with its "Diagnostic fee - Code 25 alternator check" line.
//
// THE FEE WINS. The diagnostic fee field is the shop's own stated price (HD Settings,
// migration 156), it is what the invoice form and the work order -> invoice converter
// already carry as a fee, and it is taxed and reported as a fee rather than mixed into
// labor hours. So the hand-offs now send the fee decision (include_diagnostic +
// diagnostic_fee) instead of a labor line, and a labor line that is itself a diagnostic
// charge can sit beside a ticked fee only with a second, visible, deliberate tick.
//
// Pure, so the smoke suite holds the rule the form runs.

/** A labor line whose description says it IS the diagnostic charge. Not "Diagnostic & Repair". */
export function isDiagnosticChargeLine(line: { type?: string | null; description?: string | null }): boolean {
  if (line.type !== 'labor') return false
  const d = String(line.description ?? '').trim()
  return /\bdiagnostic\s*(fee|charge)\b/i.test(d) || /^diagnostics?$/i.test(d)
}

/**
 * Why this quote may not be saved as it stands, or null: a ticked diagnostic fee AND a
 * diagnostic labor line, without the tech's tick saying both are meant.
 */
export function doubleDiagnosticProblem(p: {
  includeFee: boolean
  fee: number
  lines: Array<{ type?: string | null; description?: string | null }>
  bothConfirmed: boolean
}): string | null {
  if (!p.includeFee || !(p.fee > 0) || p.bothConfirmed) return null
  const n = p.lines.filter(isDiagnosticChargeLine).length
  if (n === 0) return null
  return `This quote charges for the diagnosis twice: the Diagnostic Fee box AND ${n === 1 ? 'a labor line' : `${n} labor lines`} named as a diagnostic charge. Untick the fee, remove the line, or tick "Bill both" if you mean it.`
}
