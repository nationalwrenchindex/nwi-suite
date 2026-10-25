// In-page measurement for scripts/audit-contrast.ts. Plain JS: it is evaluated inside
// the browser, so it must not depend on anything a bundler would inject.
(() => {
          const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return [0, 0, 0, 0]; const v = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return [v[0], v[1], v[2], v[3] ?? 1] }
          const over = (top, bot) => { const a = top[3]; return [top[0] * a + bot[0] * (1 - a), top[1] * a + bot[1] * (1 - a), top[2] * a + bot[2] * (1 - a), 1] }
          const bgOf = (el) => {
            const stack = []
            for (let e = el; e; e = e.parentElement) { const b = parse(getComputedStyle(e).backgroundColor); if (b[3] > 0) { stack.push(b); if (b[3] >= 1) break } }
            let c = [255, 255, 255, 1]
            for (let i = stack.length - 1; i >= 0; i--) c = over(stack[i], c)
            return c
          }
          const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]) }
          const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) }
          const sel = (e) => { const parts = []; for (let x = e; x && parts.length < 4; x = x.parentElement) { let s = x.tagName.toLowerCase(); const t = x.getAttribute('data-testid'); if (t) s += `[data-testid=${t}]`; else if (x.id) s += '#' + x.id; else if (x.getAttribute('name')) s += `[name=${x.getAttribute('name')}]`; parts.unshift(s) } return parts.join(' > ') }
          const out = []
          const seen = new Set()
          const consider = (el, text) => {
            if (seen.has(el)) return; seen.add(el)
            const cs = getComputedStyle(el)
            if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) return
            const r = el.getBoundingClientRect(); if (r.width === 0 || r.height === 0) return
            let fg = parse(cs.color)
            const bg = bgOf(el)
            if (fg[3] < 1) fg = over(fg, bg)
            const size = parseFloat(cs.fontSize), bold = Number(cs.fontWeight) >= 700
            const large = size >= 24 || (bold && size >= 18.66)
            const need = large ? 3 : 4.5
            const rr = ratio(fg, bg)
            if (rr < need) out.push({ text: text.trim().slice(0, 60), ratio: Math.round(rr * 100) / 100, need, fg: cs.color, bg: `rgb(${bg.slice(0, 3).map(Math.round).join(',')})`, sel: sel(el) })
          }
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
          for (let n = walker.nextNode(); n; n = walker.nextNode()) {
            const t = n.textContent ?? ''; if (!t.trim() || !n.parentElement) continue
            const tag = n.parentElement.tagName; if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'OPTION') continue
            consider(n.parentElement, t)
          }
          document.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]), select, textarea').forEach(el => {
            const v = el.value || el.placeholder || ''
            if (v) consider(el, `[${el.tagName.toLowerCase()}] ${v}`)
          })
          return out
})()