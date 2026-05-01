'use client'

import { useState, useEffect, useCallback } from 'react'
import type { InventoryProduct, ServiceProduct, UsageLogEntry, GlobalProduct } from '@/types/inventory'
import { PRODUCT_CATEGORIES, PRODUCT_CATEGORY_LABELS } from '@/types/inventory'
import { DETAILER_SERVICES } from '@/lib/scheduler'
import BarcodeScanner, { isBarcodeDetectorSupported } from './BarcodeScanner'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(cents: number) {
  return `$${(cents / 100).toFixed(2)}`
}
function costPerUse(p: InventoryProduct) {
  return p.total_uses > 0 ? fmt(Math.round(p.cost_cents / p.total_uses)) : '—'
}

// ─── Product Form (add / edit) ────────────────────────────────────────────────

interface ProductFormState {
  name: string
  brand: string
  container_size: string
  cost_dollars: string
  total_uses: string
  category: string
}

const BLANK_FORM: ProductFormState = {
  name:           '',
  brand:          '',
  container_size: '',
  cost_dollars:   '',
  total_uses:     '',
  category:       '',
}

function prefillFromGlobal(g: GlobalProduct): ProductFormState {
  return {
    name:           g.name,
    brand:          g.brand ?? '',
    container_size: g.container_size ?? '',
    cost_dollars:   g.default_cost_cents ? String((g.default_cost_cents / 100).toFixed(2)) : '',
    total_uses:     g.default_uses_per_container ? String(g.default_uses_per_container) : '',
    category:       g.category ?? '',
  }
}

function prefillFromInventory(p: InventoryProduct): ProductFormState {
  return {
    name:           p.name,
    brand:          p.brand ?? '',
    container_size: p.container_size ?? '',
    cost_dollars:   String((p.cost_cents / 100).toFixed(2)),
    total_uses:     String(p.total_uses),
    category:       p.category ?? '',
  }
}

// ─── Product Detail Modal ─────────────────────────────────────────────────────

function ProductDetailModal({
  product,
  onClose,
  onUpdated,
  onDeleted,
}: {
  product: InventoryProduct
  onClose: () => void
  onUpdated: (p: InventoryProduct) => void
  onDeleted: (id: string) => void
}) {
  const [form,       setForm]       = useState<ProductFormState>(prefillFromInventory(product))
  const [usageLog,   setUsageLog]   = useState<UsageLogEntry[]>([])
  const [saving,     setSaving]     = useState(false)
  const [restocking, setRestocking] = useState(false)
  const [deleting,   setDeleting]   = useState(false)
  const [error,      setError]      = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/inventory/${product.id}`)
      .then(r => r.json())
      .then(d => setUsageLog(d.usage_log ?? []))
      .catch(() => {})
  }, [product.id])

  async function handleSave() {
    setSaving(true); setError(null)
    const res = await fetch(`/api/inventory/${product.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name:           form.name,
        brand:          form.brand || null,
        container_size: form.container_size || null,
        cost_cents:     Math.round(parseFloat(form.cost_dollars || '0') * 100),
        total_uses:     parseInt(form.total_uses || '1'),
        category:       form.category || null,
      }),
    })
    const json = await res.json()
    if (!res.ok) { setError(json.error); setSaving(false); return }
    onUpdated(json.product)
    setSaving(false)
  }

  async function handleRestock() {
    setRestocking(true)
    const res = await fetch(`/api/inventory/${product.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'restock' }),
    })
    const json = await res.json()
    if (res.ok) onUpdated(json.product)
    setRestocking(false)
  }

  async function handleDelete() {
    if (!confirm(`Delete "${product.name}"? This cannot be undone.`)) return
    setDeleting(true)
    await fetch(`/api/inventory/${product.id}`, { method: 'DELETE' })
    onDeleted(product.id)
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center bg-black/60 px-4 py-6">
      <div className="w-full max-w-lg bg-dark-card border border-dark-border rounded-2xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-dark-border flex-shrink-0">
          <p className="font-condensed font-bold text-lg text-white tracking-wide">{product.name}</p>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg border border-dark-border text-white/40 hover:text-white transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {error && <div className="alert-error">{error}</div>}

          {/* Current stock status */}
          <div className={`flex items-center justify-between rounded-xl px-4 py-3 ${
            product.uses_remaining <= product.low_stock_threshold
              ? 'bg-danger/10 border border-danger/30'
              : 'bg-success/10 border border-success/30'
          }`}>
            <div>
              <p className="text-white font-semibold text-sm">{product.uses_remaining} of {product.total_uses} uses remaining</p>
              <p className="text-white/40 text-xs">{costPerUse(product)} per use</p>
            </div>
            <button
              onClick={handleRestock}
              disabled={restocking}
              className="text-xs font-semibold bg-white/10 hover:bg-white/20 text-white rounded-lg px-3 py-1.5 transition-colors disabled:opacity-50"
            >
              {restocking ? '…' : 'Restock'}
            </button>
          </div>

          {/* Edit form */}
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="nwi-label">Name</label>
                <input className="nwi-input" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} />
              </div>
              <div>
                <label className="nwi-label">Brand</label>
                <input className="nwi-input" placeholder="e.g. Meguiar's" value={form.brand} onChange={e => setForm(p => ({ ...p, brand: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="nwi-label">Container Size</label>
                <input className="nwi-input" placeholder="e.g. 1 gal" value={form.container_size} onChange={e => setForm(p => ({ ...p, container_size: e.target.value }))} />
              </div>
              <div>
                <label className="nwi-label">Category</label>
                <select className="nwi-input" value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))}>
                  <option value="">— Select —</option>
                  {PRODUCT_CATEGORIES.map(c => <option key={c} value={c}>{PRODUCT_CATEGORY_LABELS[c]}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="nwi-label">Cost per Container ($)</label>
                <input type="number" min="0" step="0.01" className="nwi-input" placeholder="0.00" value={form.cost_dollars} onChange={e => setForm(p => ({ ...p, cost_dollars: e.target.value }))} />
              </div>
              <div>
                <label className="nwi-label">Uses per Container</label>
                <input type="number" min="1" step="1" className="nwi-input" placeholder="32" value={form.total_uses} onChange={e => setForm(p => ({ ...p, total_uses: e.target.value }))} />
              </div>
            </div>
          </div>

          {/* Usage history */}
          {usageLog.length > 0 && (
            <div>
              <p className="text-white/30 text-xs uppercase tracking-widest mb-2">Recent Usage</p>
              <div className="space-y-1 max-h-40 overflow-y-auto pr-1">
                {usageLog.map(u => (
                  <div key={u.id} className="flex items-center gap-2 text-xs">
                    <span className="text-white/30 whitespace-nowrap">
                      {new Date(u.logged_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </span>
                    <span className="text-white/60 min-w-0 truncate">{u.service_name ?? 'Manual'}</span>
                    <span className="ml-auto text-white/40 whitespace-nowrap">×{u.quantity_used}</span>
                    {u.cost_cents_attributed > 0 && (
                      <span className="text-danger text-[10px]">{fmt(u.cost_cents_attributed)}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex gap-3 px-5 py-4 border-t border-dark-border flex-shrink-0">
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="text-danger hover:text-white text-xs border border-danger/30 hover:border-danger/60 rounded-lg px-3 py-2 transition-colors disabled:opacity-50"
          >
            {deleting ? 'Deleting…' : 'Delete'}
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 bg-orange hover:bg-orange-hover text-white font-condensed font-bold text-sm rounded-lg py-2 transition-colors disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'SAVE CHANGES'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Add Product Modal ────────────────────────────────────────────────────────

function AddProductModal({
  onClose,
  onAdded,
}: {
  onClose: () => void
  onAdded: (p: InventoryProduct) => void
}) {
  const [path,          setPath]          = useState<'choose' | 'scan' | 'form'>('choose')
  const [form,          setForm]          = useState<ProductFormState>(BLANK_FORM)
  const [globalProduct, setGlobalProduct] = useState<GlobalProduct | null>(null)
  const [lookingUp,     setLookingUp]     = useState(false)
  const [scannedBarcode, setScannedBarcode] = useState<string | null>(null)
  const [submitting,    setSubmitting]    = useState(false)
  const [error,         setError]         = useState<string | null>(null)

  const supportsScanner = isBarcodeDetectorSupported()

  async function handleBarcode(barcode: string) {
    setScannedBarcode(barcode)
    setLookingUp(true)
    setPath('form')
    try {
      const res  = await fetch(`/api/inventory/global?barcode=${encodeURIComponent(barcode)}`)
      const json = await res.json()
      if (json.hit && json.product) {
        setGlobalProduct(json.product)
        setForm(prefillFromGlobal(json.product))
      }
    } catch { /* pre-fill with blank if lookup fails */ }
    setLookingUp(false)
  }

  async function handleSubmit() {
    if (!form.name.trim()) { setError('Product name is required.'); return }
    setSubmitting(true); setError(null)

    const costCents = form.cost_dollars ? Math.round(parseFloat(form.cost_dollars) * 100) : 0
    const totalUses = form.total_uses ? (parseInt(form.total_uses) || 1) : 1
    const name      = form.name.trim()

    // ── Step 1: resolve or create the global product record ───────────────────
    let globalId: string | null = null

    if (globalProduct) {
      // Barcode hit — already have the global record
      globalId = globalProduct.id
    } else if (scannedBarcode) {
      // Barcode miss — seed global DB with the barcode
      try {
        const gRes  = await fetch('/api/inventory/global', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            barcode:                    scannedBarcode,
            name,
            brand:                      form.brand || null,
            container_size:             form.container_size || null,
            default_cost_cents:         costCents || null,
            default_uses_per_container: totalUses,
            category:                   form.category || null,
          }),
        })
        const gJson = await gRes.json()
        globalId = gJson.product?.id ?? null
      } catch { /* non-fatal */ }
    } else {
      // Manual entry — look up by name+brand (case-insensitive), create if absent
      try {
        const params = new URLSearchParams({ name })
        if (form.brand) params.set('brand', form.brand)
        const lookupRes  = await fetch(`/api/inventory/global?${params}`)
        const lookupJson = await lookupRes.json()

        if (lookupJson.hit && lookupJson.product) {
          globalId = lookupJson.product.id
        } else {
          const gRes  = await fetch('/api/inventory/global', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({
              name,
              brand:                      form.brand || null,
              container_size:             form.container_size || null,
              default_cost_cents:         costCents || null,
              default_uses_per_container: totalUses,
              category:                   form.category || null,
            }),
          })
          const gJson = await gRes.json()
          globalId = gJson.product?.id ?? null
        }
      } catch { /* non-fatal */ }
    }

    // ── Step 2: insert into per-user inventory (only columns that exist) ──────
    const res = await fetch('/api/inventory', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        global_product_id: globalId,
        name,
        cost_cents: costCents,
        total_uses: totalUses,
      }),
    })
    const json = await res.json()
    if (!res.ok) { setError(json.error); setSubmitting(false); return }
    onAdded(json.product)
  }

  if (path === 'scan') {
    return (
      <BarcodeScanner
        onScanned={handleBarcode}
        onClose={() => setPath('choose')}
      />
    )
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center bg-black/60 px-4 py-6">
      <div className="w-full max-w-lg bg-dark-card border border-dark-border rounded-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-dark-border">
          <p className="font-condensed font-bold text-lg text-white tracking-wide">
            {path === 'choose' ? 'ADD PRODUCT' : 'PRODUCT DETAILS'}
          </p>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg border border-dark-border text-white/40 hover:text-white transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Choose scan vs manual */}
          {path === 'choose' && (
            <div className="space-y-3">
              {supportsScanner && (
                <button
                  onClick={() => setPath('scan')}
                  className="w-full flex items-center gap-4 rounded-xl border border-orange/30 bg-orange/5 hover:bg-orange/10 p-4 transition-colors text-left"
                >
                  <div className="w-10 h-10 bg-orange/20 rounded-lg flex items-center justify-center flex-shrink-0">
                    <svg className="w-5 h-5 text-orange" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
                      <rect x="3" y="11" width="18" height="11" rx="2" />
                      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-white font-semibold text-sm">Scan Barcode</p>
                    <p className="text-white/40 text-xs">Use your camera to scan the product barcode. Pre-fills from our shared database.</p>
                  </div>
                </button>
              )}
              <button
                onClick={() => setPath('form')}
                className="w-full flex items-center gap-4 rounded-xl border border-dark-border hover:border-white/20 bg-dark-card hover:bg-dark-lighter p-4 transition-colors text-left"
              >
                <div className="w-10 h-10 bg-white/5 rounded-lg flex items-center justify-center flex-shrink-0">
                  <svg className="w-5 h-5 text-white/50" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
                    <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                </div>
                <div>
                  <p className="text-white font-semibold text-sm">Add Manually</p>
                  <p className="text-white/40 text-xs">Enter product details by hand.</p>
                </div>
              </button>
            </div>
          )}

          {/* Product form */}
          {path === 'form' && (
            <div className="space-y-4">
              {error && <div className="alert-error">{error}</div>}

              {scannedBarcode && (
                <div className={`flex items-center gap-2 text-xs px-3 py-2 rounded-lg ${
                  globalProduct
                    ? 'bg-success/10 border border-success/30 text-success'
                    : 'bg-orange/10 border border-orange/30 text-orange'
                }`}>
                  {globalProduct ? (
                    <>✓ Found in shared database — details pre-filled</>
                  ) : lookingUp ? (
                    <>Searching shared database…</>
                  ) : (
                    <>New barcode — fill in details below to add it to the shared database</>
                  )}
                </div>
              )}

              {lookingUp ? (
                <div className="text-center py-4">
                  <div className="w-6 h-6 border-2 border-orange border-t-transparent rounded-full animate-spin mx-auto" />
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="col-span-2">
                      <label className="nwi-label">Product Name *</label>
                      <input className="nwi-input" placeholder="e.g. Gold Class Car Wash" value={form.name}
                        onChange={e => setForm(p => ({ ...p, name: e.target.value }))} />
                    </div>
                    <div>
                      <label className="nwi-label">Brand</label>
                      <input className="nwi-input" placeholder="e.g. Meguiar's" value={form.brand}
                        onChange={e => setForm(p => ({ ...p, brand: e.target.value }))} />
                    </div>
                    <div>
                      <label className="nwi-label">Container Size</label>
                      <input className="nwi-input" placeholder="e.g. 64 oz" value={form.container_size}
                        onChange={e => setForm(p => ({ ...p, container_size: e.target.value }))} />
                    </div>
                    <div>
                      <label className="nwi-label">Cost per Container ($)</label>
                      <input type="number" min="0" step="0.01" className="nwi-input" placeholder="0.00" value={form.cost_dollars}
                        onChange={e => setForm(p => ({ ...p, cost_dollars: e.target.value }))} />
                    </div>
                    <div>
                      <label className="nwi-label">Uses per Container</label>
                      <input type="number" min="1" step="1" className="nwi-input" placeholder="32" value={form.total_uses}
                        onChange={e => setForm(p => ({ ...p, total_uses: e.target.value }))} />
                    </div>
                    <div className="col-span-2">
                      <label className="nwi-label">Category</label>
                      <select className="nwi-input" value={form.category}
                        onChange={e => setForm(p => ({ ...p, category: e.target.value }))}>
                        <option value="">— Select —</option>
                        {PRODUCT_CATEGORIES.map(c => <option key={c} value={c}>{PRODUCT_CATEGORY_LABELS[c]}</option>)}
                      </select>
                    </div>
                  </div>

                  {form.cost_dollars && form.total_uses && (
                    <p className="text-white/40 text-xs">
                      Cost per use: <span className="text-orange font-medium">${(parseFloat(form.cost_dollars) / parseInt(form.total_uses)).toFixed(2)}</span>
                    </p>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {path === 'form' && !lookingUp && (
          <div className="flex gap-3 px-5 pb-5">
            <button onClick={() => setPath('choose')} className="px-4 py-2 border border-dark-border text-white/50 hover:text-white rounded-lg text-sm transition-colors">
              Back
            </button>
            <button onClick={handleSubmit} disabled={submitting}
              className="flex-1 bg-orange hover:bg-orange-hover text-white font-condensed font-bold text-sm rounded-lg py-2 transition-colors disabled:opacity-50">
              {submitting ? 'Adding…' : 'ADD TO INVENTORY'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Service Mapping Tab ──────────────────────────────────────────────────────

function ServiceMappingTab({ products }: { products: InventoryProduct[] }) {
  const [mappings, setMappings] = useState<ServiceProduct[]>([])
  const [loading,  setLoading]  = useState(true)
  const [addingFor, setAddingFor] = useState<string | null>(null) // service_name being added
  const [addForm,  setAddForm]   = useState({ product_inventory_id: '', quantity_used: '1' })
  const [adding,   setAdding]    = useState(false)
  const [error,    setError]     = useState<string | null>(null)

  const fetchMappings = useCallback(async () => {
    setLoading(true)
    const res  = await fetch('/api/inventory/service-products')
    const json = await res.json()
    setMappings(json.mappings ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { fetchMappings() }, [fetchMappings])

  async function addMapping(serviceName: string) {
    if (!addForm.product_inventory_id) { setError('Select a product.'); return }
    setAdding(true); setError(null)
    const res = await fetch('/api/inventory/service-products', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        service_name:         serviceName,
        product_inventory_id: addForm.product_inventory_id,
        quantity_used:        parseFloat(addForm.quantity_used) || 1,
      }),
    })
    const json = await res.json()
    if (!res.ok) { setError(json.error); setAdding(false); return }
    setMappings(prev => [...prev, json.mapping])
    setAddForm({ product_inventory_id: '', quantity_used: '1' })
    setAddingFor(null)
    setAdding(false)
  }

  async function removeMapping(id: string) {
    await fetch(`/api/inventory/service-products/${id}`, { method: 'DELETE' })
    setMappings(prev => prev.filter(m => m.id !== id))
  }

  const byService = DETAILER_SERVICES.reduce<Record<string, ServiceProduct[]>>((acc, svc) => {
    acc[svc] = mappings.filter(m => m.service_name === svc)
    return acc
  }, {})

  if (loading) return <div className="text-white/30 text-sm text-center py-12">Loading…</div>

  return (
    <div className="space-y-3">
      <p className="text-white/40 text-sm">
        Map products from your inventory to services. When a job is marked complete, uses are automatically deducted and added to COGS.
      </p>

      {error && <div className="alert-error">{error}</div>}

      {DETAILER_SERVICES.map(svc => {
        const svcMappings = byService[svc] ?? []
        const isAdding    = addingFor === svc

        return (
          <div key={svc} className="nwi-card p-0 overflow-hidden">
            <div className="px-4 py-3 flex items-center justify-between border-b border-dark-border">
              <p className="text-white font-semibold text-sm">{svc}</p>
              <button
                onClick={() => { setAddingFor(isAdding ? null : svc); setError(null); setAddForm({ product_inventory_id: '', quantity_used: '1' }) }}
                className="text-xs text-orange hover:text-orange-light transition-colors"
              >
                {isAdding ? '× Cancel' : '+ Add Product'}
              </button>
            </div>

            {isAdding && (
              <div className="px-4 py-3 bg-orange/5 border-b border-dark-border flex flex-wrap items-end gap-3">
                <div className="flex-1 min-w-[160px]">
                  <label className="nwi-label">Product</label>
                  <select className="nwi-input" value={addForm.product_inventory_id}
                    onChange={e => setAddForm(p => ({ ...p, product_inventory_id: e.target.value }))}>
                    <option value="">— Select product —</option>
                    {products.map(p => (
                      <option key={p.id} value={p.id}>{p.name}{p.brand ? ` (${p.brand})` : ''}</option>
                    ))}
                  </select>
                </div>
                <div className="w-28">
                  <label className="nwi-label">Qty / Job</label>
                  <input type="number" min="0.1" step="0.1" className="nwi-input" value={addForm.quantity_used}
                    onChange={e => setAddForm(p => ({ ...p, quantity_used: e.target.value }))} />
                </div>
                <button onClick={() => addMapping(svc)} disabled={adding}
                  className="px-4 py-2 bg-orange hover:bg-orange-hover text-white font-condensed font-bold text-sm rounded-lg transition-colors disabled:opacity-50">
                  {adding ? '…' : 'Add'}
                </button>
              </div>
            )}

            <div className="divide-y divide-dark-border/50">
              {svcMappings.length === 0 ? (
                <p className="px-4 py-3 text-white/25 text-xs italic">No products mapped.</p>
              ) : svcMappings.map(m => {
                const prod = m.product
                const cpuStr = prod ? fmt(Math.round(prod.cost_cents / prod.total_uses * m.quantity_used)) : '—'
                return (
                  <div key={m.id} className="px-4 py-2.5 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-xs font-medium">{prod?.name ?? m.product_inventory_id}</p>
                      {prod?.brand && <p className="text-white/30 text-[10px]">{prod.brand}</p>}
                    </div>
                    <span className="text-white/40 text-xs">×{m.quantity_used}</span>
                    <span className="text-orange text-xs font-medium">{cpuStr}</span>
                    <button onClick={() => removeMapping(m.id)} className="text-white/20 hover:text-danger transition-colors">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Product Card ─────────────────────────────────────────────────────────────

function ProductCard({ product, onClick }: { product: InventoryProduct; onClick: () => void }) {
  const isLow     = product.uses_remaining <= product.low_stock_threshold
  const pctLeft   = product.total_uses > 0 ? (product.uses_remaining / product.total_uses) * 100 : 0
  const barColor  = isLow ? 'bg-danger' : pctLeft > 50 ? 'bg-success' : 'bg-orange'

  return (
    <button
      onClick={onClick}
      className="nwi-card text-left hover:border-white/20 transition-colors flex flex-col gap-3 w-full"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-white font-semibold text-sm leading-tight truncate">{product.name}</p>
          {product.brand && <p className="text-white/40 text-xs">{product.brand}</p>}
        </div>
        {isLow && (
          <span className="flex-shrink-0 text-[10px] font-bold bg-danger/20 text-danger border border-danger/30 rounded-full px-2 py-0.5">
            LOW
          </span>
        )}
      </div>

      {/* Progress bar */}
      <div className="space-y-1">
        <div className="h-1.5 bg-dark-border rounded-full overflow-hidden">
          <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${Math.max(2, pctLeft)}%` }} />
        </div>
        <div className="flex items-center justify-between text-[10px]">
          <span className="text-white/40">{product.uses_remaining} of {product.total_uses} uses</span>
          <span className="text-orange font-medium">{costPerUse(product)}/use</span>
        </div>
      </div>

      {product.container_size && (
        <p className="text-white/25 text-[10px]">{product.container_size}</p>
      )}
    </button>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

type Tab = 'products' | 'mappings'

export default function InventoryClient() {
  const [tab,        setTab]        = useState<Tab>('products')
  const [products,   setProducts]   = useState<InventoryProduct[]>([])
  const [loading,    setLoading]    = useState(true)
  const [catFilter,  setCatFilter]  = useState('')
  const [showAdd,    setShowAdd]    = useState(false)
  const [selected,   setSelected]   = useState<InventoryProduct | null>(null)

  const fetchProducts = useCallback(async () => {
    setLoading(true)
    const res  = await fetch('/api/inventory')
    const json = await res.json()
    setProducts(json.products ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { fetchProducts() }, [fetchProducts])

  const filtered = catFilter
    ? products.filter(p => p.category === catFilter)
    : products

  const lowCount = products.filter(p => p.uses_remaining <= p.low_stock_threshold).length

  return (
    <div className="space-y-5">
      {/* Header row */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        {/* Tab pills */}
        <div className="flex rounded-lg border border-dark-border overflow-hidden">
          {([['products', 'Products'], ['mappings', 'Service Mapping']] as [Tab, string][]).map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)}
              className={`px-4 py-1.5 text-sm font-medium transition-colors ${
                tab === id ? 'bg-orange text-white' : 'bg-dark text-white/40 hover:text-white'
              }`}>
              {label}
              {id === 'products' && lowCount > 0 && (
                <span className="ml-1.5 text-[10px] bg-danger text-white rounded-full px-1.5 py-0.5">{lowCount}</span>
              )}
            </button>
          ))}
        </div>

        {tab === 'products' && (
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-1.5 px-4 py-2 bg-orange hover:bg-orange-hover text-white font-condensed font-bold text-sm tracking-wide rounded-lg transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Add Product
          </button>
        )}
      </div>

      {/* Products tab */}
      {tab === 'products' && (
        <>
          {/* Category filter */}
          {products.length > 0 && (
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={() => setCatFilter('')}
                className={`text-xs px-3 py-1 rounded-full border transition-colors ${
                  catFilter === '' ? 'bg-orange border-orange text-white' : 'border-dark-border text-white/40 hover:text-white'
                }`}>
                All
              </button>
              {PRODUCT_CATEGORIES.filter(c => products.some(p => p.category === c)).map(c => (
                <button key={c} onClick={() => setCatFilter(c)}
                  className={`text-xs px-3 py-1 rounded-full border transition-colors ${
                    catFilter === c ? 'bg-orange border-orange text-white' : 'border-dark-border text-white/40 hover:text-white'
                  }`}>
                  {PRODUCT_CATEGORY_LABELS[c]}
                </button>
              ))}
            </div>
          )}

          {loading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="nwi-card h-32 animate-pulse bg-dark-card/50" />
              ))}
            </div>
          ) : products.length === 0 ? (
            <div className="nwi-card text-center py-16">
              <div className="w-14 h-14 bg-orange/10 border border-orange/20 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <svg className="w-7 h-7 text-orange/50" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                  <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                </svg>
              </div>
              <p className="font-condensed font-bold text-xl text-white mb-2">NO PRODUCTS YET</p>
              <p className="text-white/40 text-sm mb-5">Add your first detailing product to start tracking usage and COGS.</p>
              <button
                onClick={() => setShowAdd(true)}
                className="px-6 py-2.5 bg-orange hover:bg-orange-hover text-white font-condensed font-bold text-sm rounded-lg transition-colors"
              >
                + Add First Product
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              {filtered.map(p => (
                <ProductCard key={p.id} product={p} onClick={() => setSelected(p)} />
              ))}
            </div>
          )}
        </>
      )}

      {/* Service mapping tab */}
      {tab === 'mappings' && (
        <ServiceMappingTab products={products} />
      )}

      {/* Modals */}
      {showAdd && (
        <AddProductModal
          onClose={() => setShowAdd(false)}
          onAdded={(p) => { setProducts(prev => [p, ...prev].sort((a, b) => a.name.localeCompare(b.name))); setShowAdd(false) }}
        />
      )}

      {selected && (
        <ProductDetailModal
          product={selected}
          onClose={() => setSelected(null)}
          onUpdated={(p) => { setProducts(prev => prev.map(x => x.id === p.id ? p : x)); setSelected(p) }}
          onDeleted={(id) => { setProducts(prev => prev.filter(x => x.id !== id)); setSelected(null) }}
        />
      )}
    </div>
  )
}
