// npx tsx scripts/inspect-parts-sources.ts
//
// READ-ONLY. Prints the shape of every reefer parts source in data/parts-sources/:
// sheets, headers, row counts and the first rows. Touches no database.
import fs from 'fs'
import path from 'path'
import * as XLSX from 'xlsx'
import JSZip from 'jszip'

const DIR = path.join(process.cwd(), 'data/parts-sources')
const FILES = [
  'Reefer-Parts-Simple.xlsx', 'Reefer-Parts-Master.xlsx', 'can-ca-tk-carrier-parts-oem-only.csv',
  'can-ca-tk-left-out-rows.csv', 'tk-filters-crossref.xlsx', 'tk-filters-by-model.docx',
  'seed-parts.csv', 'seed-fitment.csv', 'seed-crosses.csv', 'seed-engines.csv', 'seed-supersessions.csv',
]

async function main() {
  for (const f of FILES) {
    const p = path.join(DIR, f)
    console.log(`\n${'='.repeat(90)}\n${f}  (${fs.statSync(p).size} bytes)`)
    try {
      if (f.endsWith('.docx')) {
        const zip = await JSZip.loadAsync(fs.readFileSync(p))
        const xml = await zip.file('word/document.xml')!.async('string')
        const paras = xml.split(/<\/w:p>/).map(s => s.replace(/<w:tab\/>/g, '\t').replace(/<[^>]+>/g, '').trim()).filter(Boolean)
        const tables = (xml.match(/<w:tbl>/g) ?? []).length
        console.log(`  docx: ${paras.length} paragraphs, ${tables} tables`)
        for (const s of paras.slice(0, 60)) console.log('  | ' + s.slice(0, 160))
        continue
      }
      const wb = XLSX.read(fs.readFileSync(p), { type: 'buffer', raw: f.endsWith('.csv'), codepage: 65001 })
      for (const sn of wb.SheetNames) {
        const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sn], { header: 1, defval: '', raw: false })
        console.log(`  -- sheet "${sn}": ${rows.length} rows (incl. header)`)
        for (const r of rows.slice(0, 5)) console.log('     ' + JSON.stringify(r).slice(0, 400))
      }
    } catch (e) {
      console.log(`  WILL NOT PARSE: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
}
main()
