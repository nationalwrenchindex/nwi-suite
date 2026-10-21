// Copy a .sql file to the Windows clipboard for pasting into the Supabase SQL editor,
// and PROVE what landed there.
//
//   node scripts/copy-sql.cjs supabase/migrations/163_hd_units_unit_type_no_default.sql
//
// Why this exists: on Oct 21 migration 163 was copied with PowerShell
// `Get-Content -Raw file | clip`. The file was clean ASCII, but PowerShell's pipe to a
// native program encodes as UTF-8 WITH a byte-order mark, so the clipboard started with
// U+FEFF and the editor failed with a syntax error on line 1. check-sql-ascii.cjs
// passed, correctly - it checks the file, and the file was never the problem.
//
// So: check the file, hand clip.exe the file's raw bytes (no shell encoding in between),
// then read the clipboard back and fail unless it is exactly the file.

const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const file = process.argv[2]
if (!file) {
  console.error('usage: node scripts/copy-sql.cjs <file.sql>')
  process.exit(2)
}

try {
  execFileSync(process.execPath, [path.join(__dirname, 'check-sql-ascii.cjs'), file], { stdio: 'inherit' })
} catch {
  console.error('\nNOT COPIED - the file failed the check above. Fix it first.')
  process.exit(1)
}

const bytes = fs.readFileSync(file)
execFileSync('clip.exe', [], { input: bytes })

const back = execFileSync(
  'powershell.exe',
  ['-NoProfile', '-Command', '[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); [Console]::Out.Write((Get-Clipboard -Raw))'],
  { encoding: 'utf8' },
)
const expected = bytes.toString('utf8')

if (back.charCodeAt(0) === 0xfeff) {
  console.error('\nFAIL  the clipboard starts with a byte-order mark. Do not paste it.')
  process.exit(1)
}
// The Windows text clipboard hands LF back as CRLF; the SQL editor treats them alike.
// Every other character must match exactly.
const lf = s => s.replace(/\r\n/g, '\n')
if (lf(back) !== lf(expected)) {
  console.error(`\nFAIL  the clipboard does not match the file (${back.length} vs ${expected.length} chars). Do not paste it.`)
  process.exit(1)
}
console.log(`\nCOPIED  ${path.basename(file)} - ${expected.length} chars, read back and identical to the file, no BOM.`)
