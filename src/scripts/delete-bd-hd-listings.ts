/**
 * One-time teardown: deletes member profiles from the Brilliant Directories HD
 * site ONLY.
 *
 *   npm run delete-bd-hd -- --dry-run   # list what would be deleted
 *   npm run delete-bd-hd                # delete
 *
 * Scope is deliberately narrow and hardcoded:
 *   • HD directory only — national-wrench-index-hd.directoryup.com
 *   • authenticates with BD_HD_DIRECTORY_AGENT_KEY and nothing else
 *   • never touches Supabase, Vercel, or the LD directory
 *
 * DESTRUCTIVE AND IRREVERSIBLE on the BD side. Recovery is possible only
 * because Supabase still holds every truck stop's google_place_id, coordinates
 * and website — but see the note printed at the end: hd_directory_prospects
 * rows still say bd_listing_created=true, so a re-import will skip them until
 * those flags are reset.
 *
 * BD's read API returns at most 100 members per call with no paging, so the
 * loop re-fetches after each batch until the directory reports none left.
 */

import { loadEnvConfig } from '@next/env'

loadEnvConfig(process.cwd())

// Hardcoded, not env-driven: this script must never be pointable at the LD
// directory by changing a variable.
const BD_BASE = 'https://national-wrench-index-hd.directoryup.com/api/v2'

const DELETE_DELAY_MS = 300
const MAX_ROUNDS      = 50   // backstop against a delete that silently no-ops

interface Member {
  user_id: string
  email:   string
  company: string
}

function apiKey(): string {
  const key = process.env.BD_HD_DIRECTORY_AGENT_KEY
  if (!key) {
    console.error('Missing BD_HD_DIRECTORY_AGENT_KEY')
    process.exit(1)
  }
  return key
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

async function listMembers(key: string): Promise<Member[]> {
  const res = await fetch(`${BD_BASE}/user/get?bdapi_model=user&limit=100`, {
    headers:  { 'X-Api-Key': key, accept: 'application/json' },
    redirect: 'manual',
    signal:   AbortSignal.timeout(20_000),
  })
  const raw = await res.text().catch(() => '')

  // An empty directory is reported as 400 "user not found" with total:0, not as
  // an empty list. Treating that as an error made a fully successful teardown
  // end with "Teardown aborted" and skip its own summary.
  if (!res.ok) {
    if (/"total"\s*:\s*0/.test(raw) || /user not found/i.test(raw)) return []
    throw new Error(`user/get ${res.status}: ${raw.slice(0, 200)}`)
  }

  try {
    const j = JSON.parse(raw) as { message?: Array<Record<string, unknown>> }
    return (j.message ?? []).map(r => ({
      user_id: String(r.user_id ?? ''),
      email:   String(r.email ?? ''),
      company: String(r.company ?? ''),
    })).filter(m => m.user_id !== '')
  } catch {
    throw new Error(`user/get returned unparseable body: ${raw.slice(0, 200)}`)
  }
}

/**
 * BD's verb conventions differ per endpoint (create is POST, update is PUT), so
 * the id is sent both as a query parameter and as a form body — whichever the
 * endpoint reads, it gets.
 */
async function deleteMember(key: string, userId: string): Promise<{ ok: boolean; detail: string }> {
  const res = await fetch(`${BD_BASE}/user/delete?bdapi_model=user&user_id=${encodeURIComponent(userId)}`, {
    method:  'DELETE',
    headers: {
      'X-Api-Key':    key,
      'Content-Type': 'application/x-www-form-urlencoded',
      accept:         'application/json',
    },
    body:     new URLSearchParams({ bdapi_model: 'user', user_id: userId }).toString(),
    redirect: 'manual',
    signal:   AbortSignal.timeout(20_000),
  })
  const raw = await res.text().catch(() => '')
  const ok  = res.status >= 200 && res.status < 300 && !/"status"\s*:\s*"error"/.test(raw)
  return { ok, detail: `${res.status} ${raw.slice(0, 160).replace(/\s+/g, ' ')}` }
}

async function main() {
  const dryRun = process.argv.slice(2).includes('--dry-run')
  const key    = apiKey()

  console.log('─'.repeat(72))
  console.log(`BD HD member teardown${dryRun ? '  [DRY RUN — nothing will be deleted]' : ''}`)
  console.log(`target: ${BD_BASE}`)
  console.log('─'.repeat(72))

  const first = await listMembers(key)
  if (first.length === 0) {
    console.log('No members returned — nothing to do.')
    return
  }

  console.log(`${first.length} member(s) visible in this page:`)
  for (const m of first.slice(0, 10)) {
    console.log(`  ${m.user_id.padStart(4)}  ${m.company || '(no company)'}  ${m.email}`)
  }
  if (first.length > 10) console.log(`  … and ${first.length - 10} more`)

  if (dryRun) {
    console.log('\nDry run — re-run without --dry-run to delete. BD pages 100 at a time,')
    console.log('so the real run repeats until the directory reports none left.')
    return
  }

  let deleted = 0
  let failed  = 0
  let verified = false

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const members = round === 1 ? first : await listMembers(key)
    if (members.length === 0) {
      console.log(`\nRound ${round}: no members left.`)
      break
    }
    console.log(`\nRound ${round}: ${members.length} member(s)`)

    for (const m of members) {
      const { ok, detail } = await deleteMember(key, m.user_id)
      if (ok) {
        deleted++
        console.log(`  ✓ deleted ${m.user_id} — ${m.company || m.email}`)
      } else {
        failed++
        console.error(`  ✗ ${m.user_id} — ${m.company || m.email} — ${detail}`)
      }

      // Prove the first delete actually removed something before grinding
      // through hundreds. A wrong verb or parameter name would otherwise return
      // 200 and change nothing, and the round loop would spin to MAX_ROUNDS.
      if (!verified) {
        await sleep(DELETE_DELAY_MS)
        const after = await listMembers(key)
        if (after.some(x => x.user_id === m.user_id)) {
          console.error(
            `\nABORT: user ${m.user_id} is still present after DELETE returned "${detail}".\n` +
            `The delete endpoint is not doing what this script assumes — stopping before\n` +
            `it loops over every member with no effect.`,
          )
          process.exit(1)
        }
        verified = true
        console.log(`  · verified: ${m.user_id} is gone — proceeding`)
      }

      await sleep(DELETE_DELAY_MS)
    }

    if (round === MAX_ROUNDS) {
      console.warn(`\nReached the ${MAX_ROUNDS}-round backstop with members still listed.`)
    }
  }

  console.log('')
  console.log('─'.repeat(72))
  console.log('SUMMARY')
  console.log(`  Total deleted: ${deleted}`)
  console.log(`  Failed:        ${failed}`)
  console.log('─'.repeat(72))
  console.log('Supabase was not touched. hd_directory_prospects rows still record')
  console.log('bd_listing_created=true, so the import script will skip these locations')
  console.log('until those flags are cleared.')
}

main().catch(err => {
  console.error('Teardown aborted:', err instanceof Error ? err.message : String(err))
  process.exit(1)
})
