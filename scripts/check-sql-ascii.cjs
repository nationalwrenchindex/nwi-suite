// Every .sql file must be pure 7-bit ASCII where it MATTERS.
//
// STANDING RULE, and here is why it is a rule rather than a preference:
// non-ASCII text does not survive the trip to the Supabase SQL editor. Windows
// clip.exe reads stdin in the console code page, not UTF-8, so an em-dash arrives
// as three cp437 characters. That happened to migration 144's seeded "why" text,
// which a TECHNICIAN reads, and the SQL ran without error because mangled text is
// still perfectly valid text. Nothing could have caught it but a byte check.
//
// TWO SEVERITIES, because they are not the same problem:
//
//   ERROR  non-ASCII in LIVE SQL -- a string literal, an identifier, anything the
//          parser keeps. This can corrupt DATA, silently.
//   WARN   non-ASCII inside a -- comment. Postgres discards it, so the worst case
//          is an ugly comment. Reported, not failed, so legacy migrations do not
//          block the check that matters.
//
//   node scripts/check-sql-ascii.cjs <files...>
//   node scripts/check-sql-ascii.cjs            (defaults to every .sql in repo)

const fs = require('fs')
const path = require('path')

// One shared definition of where a comment starts; see scripts/live-sql.cjs.
const { liveSqlOnly } = require('./live-sql.cjs')

function allSqlFiles() {
  const root = path.join(__dirname, '..')
  const out = []
  const walk = d => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === '.next' || e.name === '.git') continue
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name.endsWith('.sql')) out.push(p)
    }
  }
  walk(root)
  return out.sort()
}

/**
 * ENFORCED on anything still to be run; REPORTED on applied history.
 *
 * The rule starts at migration 142, which is where this run begins, plus every
 * hand-run script in scripts/. Older migrations are already in the database and
 * their live data was checked directly: hd_parts_reference has 15 fields with
 * legitimate non-ASCII and ZERO mangled, and foreman_settings has none at all. So
 * they were applied through a UTF-8-safe path, not through clip.exe, and rewriting
 * 100-odd applied files would be churn that fixes nothing.
 *
 * A checker that is permanently red gets ignored, which would defeat the point.
 */
function isEnforced(rel) {
  if (rel.startsWith('scripts/')) return true
  const m = /migrations\/(\d+)_/.exec(rel)
  return m ? Number(m[1]) >= 142 : true
}

const files = process.argv.slice(2).length ? process.argv.slice(2) : allSqlFiles()

let errorFiles = 0
let warnFiles = 0
const errors = []
const legacyLive = []
const warns = []

for (const f of files) {
  const text = fs.readFileSync(f, 'utf8')
  const lines = text.split('\n')
  let inString = false
  const liveHits = []
  let commentHits = 0

  for (let n = 0; n < lines.length; n++) {
    const { live, inString: next } = liveSqlOnly(lines[n], inString)
    inString = next

    for (const ch of live) {
      if (ch.codePointAt(0) > 0x7f) {
        liveHits.push({
          line: n + 1,
          cp: 'U+' + ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0'),
          ch,
          text: lines[n].trim().slice(0, 72),
        })
      }
    }
    // Anything non-ASCII on the line but not in the live part is in a comment.
    const lineNonAscii = [...lines[n]].filter(c => c.codePointAt(0) > 0x7f).length
    const liveNonAscii = [...live].filter(c => c.codePointAt(0) > 0x7f).length
    commentHits += lineNonAscii - liveNonAscii
  }

  const rel = path.relative(path.join(__dirname, '..'), f).replace(/\\/g, '/')
  if (liveHits.length) {
    if (isEnforced(rel)) { errorFiles++; errors.push({ rel, hits: liveHits }) }
    else { legacyLive.push({ rel, n: liveHits.length }) }
  } else if (commentHits) {
    warnFiles++
    warns.push({ rel, commentHits })
  }
}

console.log('='.repeat(78))
console.log(`SQL ASCII CHECK - ${files.length} file(s)`)
console.log('='.repeat(78))

if (errors.length) {
  console.log('\nERROR - non-ASCII in LIVE SQL. This can corrupt data silently.\n')
  for (const e of errors) {
    console.log(`  ${e.rel}`)
    for (const h of e.hits.slice(0, 6)) {
      console.log(`    line ${h.line}  ${h.cp}  ${h.text}`)
    }
    if (e.hits.length > 6) console.log(`    ...and ${e.hits.length - 6} more`)
  }
} else {
  console.log('\n  PASS  no non-ASCII in live SQL in any enforced file. Nothing can corrupt data.')
}

if (legacyLive.length) {
  console.log(`\nINFO - ${legacyLive.length} ALREADY-APPLIED migration(s) have non-ASCII in live SQL.`)
  console.log('  Not enforced, and not a problem: the live data was checked directly and is')
  console.log('  CLEAN. hd_parts_reference holds 15 fields with legitimate non-ASCII (real')
  console.log('  em-dashes and a degree sign, stored correctly) and ZERO mangled;')
  console.log('  foreman_settings has none at all. These were applied from an editor, not')
  console.log('  through clip.exe.')
  console.log('')
  console.log('  DO NOT "clean these up". Converting them is NOT cosmetic:')
  console.log('    055  the em-dashes sit inside RLS POLICY NAMES, and the migration')
  console.log('         guards itself by name - renaming them makes a re-run create a')
  console.log('         SECOND set of policies.')
  console.log('    033  inside the after_hours_message DEFAULT, which Foreman reads')
  console.log('         aloud to a caller. Changing it changes what new shops answer')
  console.log('         the phone with.')
  console.log('    107  inside INSERT values - belt descriptions and an 82 degree C')
  console.log('    112  thermostat that a technician reads off the parts reference.')
  console.log('  The rest is COMMENT ON COLUMN text. All of it is already correct in the')
  console.log('  database, so the only exposure is a FRESH environment applied via')
  console.log('  clip.exe. If that day comes, paste with Set-Clipboard (UTF-8).\n')
  for (const l of legacyLive.slice(0, 10)) console.log(`    ${l.rel}  (${l.n})`)
  if (legacyLive.length > 10) console.log(`    ...and ${legacyLive.length - 10} more`)
}

if (warns.length) {
  console.log(`\nWARN - non-ASCII inside -- comments only, in ${warns.length} file(s).`)
  console.log('  Postgres discards these, so the worst case is an ugly comment.')
  console.log('  Listed for completeness; they do not fail the check.\n')
  const legacy = warns.filter(w => /migrations\/(0|1[0-3])/.test(w.rel))
  const recent = warns.filter(w => !/migrations\/(0|1[0-3])/.test(w.rel))
  for (const w of recent) console.log(`    ${w.rel}  (${w.commentHits})`)
  if (legacy.length) console.log(`    ...plus ${legacy.length} older migration(s), already applied`)
}

console.log(`\n${errorFiles} file(s) with live-SQL non-ASCII, ${warnFiles} with comment-only.`)
process.exitCode = errorFiles ? 1 : 0
