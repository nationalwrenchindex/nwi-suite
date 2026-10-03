// Split a line of SQL into the part the parser keeps and the part it discards.
//
// Shared deliberately: scripts/check-sql-ascii.cjs uses it to decide whether a
// non-ASCII character can reach DATA, and the comment-ASCII converter uses it to
// prove a rewrite touched nothing but comments. If the two disagreed about where a
// comment starts, the converter could silently edit live SQL and the checker would
// not notice -- so there is exactly one definition.

/**
 * @param line      one line of SQL
 * @param inString  true if a ' string literal was still open at end of previous line
 * @returns { live, inString }  live = the line with -- comments removed
 */
function liveSqlOnly(line, inString) {
  let out = ''
  let i = 0
  while (i < line.length) {
    const ch = line[i]
    if (inString) {
      out += ch
      if (ch === "'") {
        // '' is an escaped quote inside a string, not the end of it.
        if (line[i + 1] === "'") { out += line[i + 1]; i += 2; continue }
        inString = false
      }
      i++
      continue
    }
    if (ch === "'") { inString = true; out += ch; i++; continue }
    if (ch === '-' && line[i + 1] === '-') break   // rest of the line is a comment
    out += ch
    i++
  }
  return { live: out, inString }
}

module.exports = { liveSqlOnly }
