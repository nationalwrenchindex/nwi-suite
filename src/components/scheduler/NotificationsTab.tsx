'use client'

import { useState, useEffect } from 'react'
import type {
  NotificationTemplate,
  NotificationTemplateType,
  NotificationChannel,
  CreateNotificationPayload,
} from '@/types/jobs'
import { TEMPLATE_TYPE_CONFIG, TEMPLATE_MERGE_TAGS } from '@/lib/scheduler'

// ─── Constants ────────────────────────────────────────────────────────────────

const CHANNEL_LABELS: Record<NotificationChannel, string> = {
  sms:   'SMS',
  email: 'Email',
  both:  'SMS + Email',
}

const TEMPLATE_TYPES = Object.keys(TEMPLATE_TYPE_CONFIG) as NotificationTemplateType[]
const CHANNELS: NotificationChannel[] = ['sms', 'email', 'both']

const DEFAULT_TEMPLATES: CreateNotificationPayload[] = [
  {
    template_type:   'appointment_confirmation',
    name:            'Booking Confirmation',
    channel:         'sms',
    message_content: "Hi {{first_name}}! Your {{service_type}} is confirmed for {{job_date}} at {{job_time}}. We'll come to you — no need to drive anywhere! — {{business_name}}",
  },
  {
    template_type:   'appointment_reminder',
    name:            'Day-Before Reminder',
    channel:         'sms',
    message_content: 'Hi {{first_name}}, reminder: your {{service_type}} is tomorrow at {{job_time}}. Reply CONFIRM or call to reschedule. — {{business_name}}',
  },
  {
    template_type:   'on_my_way',
    name:            'On My Way',
    channel:         'sms',
    message_content: 'Hi {{first_name}}, {{tech_name}} is on the way for your {{service_type}}! See you soon. — {{business_name}}',
  },
  {
    template_type:   'job_completed',
    name:            'Job Complete',
    channel:         'sms',
    message_content: 'Your {{service_type}} is complete! Great having you as a customer, {{first_name}}. — {{business_name}} 🔧',
  },
]

// ─── Notification log entry type ──────────────────────────────────────────────

interface NotifLog {
  id:           string
  trigger_type: string
  channel:      string
  recipient:    string
  message:      string
  status:       'sent' | 'failed'
  error:        string | null
  created_at:   string
}

// ─── Template card with inline edit ──────────────────────────────────────────

function TemplateCard({
  template,
  onToggle,
  onSave,
  onDelete,
}: {
  template: NotificationTemplate
  onToggle: (id: string, active: boolean) => void
  onSave:   (id: string, updates: Partial<NotificationTemplate>) => Promise<void>
  onDelete: (id: string) => Promise<void>
}) {
  const cfg = TEMPLATE_TYPE_CONFIG[template.template_type]

  const [editing,  setEditing]  = useState(false)
  const [saving,   setSaving]   = useState(false)
  const [deleting, setDeleting] = useState(false)

  const [name,    setName]    = useState(template.name)
  const [content, setContent] = useState(template.message_content)
  const [subject, setSubject] = useState(template.subject ?? '')
  const [channel, setChannel] = useState<NotificationChannel>(template.channel)

  function insertTag(tag: string) {
    setContent((p) => p + tag)
  }

  async function handleSave() {
    setSaving(true)
    await onSave(template.id, {
      name,
      message_content: content,
      subject: subject || null,
      channel,
    })
    setSaving(false)
    setEditing(false)
  }

  async function handleDelete() {
    if (!confirm(`Delete template "${template.name}"? This cannot be undone.`)) return
    setDeleting(true)
    await onDelete(template.id)
  }

  function cancelEdit() {
    setName(template.name)
    setContent(template.message_content)
    setSubject(template.subject ?? '')
    setChannel(template.channel)
    setEditing(false)
  }

  return (
    <div className={`rounded-xl border bg-dark-card transition-opacity ${template.is_active ? 'border-dark-border' : 'border-dark-border/50 opacity-60'}`}>
      {/* Header row */}
      <div className="flex items-start justify-between gap-3 p-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[10px] font-semibold border ${cfg.badge}`}>
              {cfg.label}
            </span>
            <span className="text-white/30 text-xs">{CHANNEL_LABELS[template.channel]}</span>
          </div>
          <p className="font-semibold text-white text-sm">{template.name}</p>
          {template.subject && !editing && (
            <p className="text-white/40 text-xs mt-0.5">Subject: {template.subject}</p>
          )}
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Edit button */}
          {!editing && (
            <button
              onClick={() => setEditing(true)}
              className="text-white/30 hover:text-white transition-colors p-1"
              title="Edit template"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
            </button>
          )}
          {/* Delete button */}
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="text-white/20 hover:text-danger transition-colors p-1"
            title="Delete template"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/>
              <path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
            </svg>
          </button>
          {/* Active toggle */}
          <button
            onClick={() => onToggle(template.id, !template.is_active)}
            className={`relative inline-flex w-10 h-5 rounded-full transition-colors focus:outline-none ${template.is_active ? 'bg-orange' : 'bg-dark-border'}`}
          >
            <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${template.is_active ? 'translate-x-5' : 'translate-x-0'}`} />
          </button>
        </div>
      </div>

      {/* Body — view or edit */}
      {editing ? (
        <div className="px-4 pb-4 border-t border-dark-border pt-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="nwi-label">Template Name</label>
              <input className="nwi-input" value={name} onChange={e => setName(e.target.value)} />
            </div>
            <div>
              <label className="nwi-label">Channel</label>
              <select className="nwi-input" value={channel}
                onChange={e => setChannel(e.target.value as NotificationChannel)}>
                {CHANNELS.map(c => <option key={c} value={c}>{CHANNEL_LABELS[c]}</option>)}
              </select>
            </div>
          </div>

          {(channel === 'email' || channel === 'both') && (
            <div>
              <label className="nwi-label">Email Subject</label>
              <input className="nwi-input" placeholder="Your appointment is tomorrow!"
                value={subject} onChange={e => setSubject(e.target.value)} />
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="nwi-label mb-0">Message</label>
              <span className="text-white/30 text-xs">{content.length} chars</span>
            </div>
            <textarea rows={4} className="nwi-input resize-none" value={content}
              onChange={e => setContent(e.target.value)} />
            <div className="flex flex-wrap gap-1.5 mt-2">
              {TEMPLATE_MERGE_TAGS.map(tag => (
                <button key={tag} type="button" onClick={() => insertTag(tag)}
                  className="text-[10px] rounded-full border border-dark-border text-white/50 hover:text-white hover:border-white/30 px-2 py-0.5 transition-colors">
                  {tag}
                </button>
              ))}
            </div>
          </div>

          <div className="flex gap-2 pt-1">
            <button onClick={handleSave} disabled={saving}
              className="px-4 py-2 bg-orange hover:bg-orange-hover disabled:opacity-50 text-white font-condensed font-bold text-sm rounded-lg transition-colors">
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
            <button onClick={cancelEdit}
              className="px-4 py-2 border border-dark-border hover:border-white/20 text-white/50 hover:text-white text-sm rounded-lg transition-colors">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="px-4 pb-4">
          <div className="bg-dark rounded-lg p-3 border border-dark-border">
            <p className="text-white/60 text-xs leading-relaxed">{template.message_content}</p>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Create template form ─────────────────────────────────────────────────────

function CreateTemplateForm({ onCreated }: { onCreated: (t: NotificationTemplate) => void }) {
  const [open,    setOpen]    = useState(false)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)
  const [type,    setType]    = useState<NotificationTemplateType>('appointment_reminder')
  const [name,    setName]    = useState('')
  const [channel, setChannel] = useState<NotificationChannel>('sms')
  const [subject, setSubject] = useState('')
  const [content, setContent] = useState('')

  function insertTag(tag: string) { setContent(p => p + tag) }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || !content.trim()) { setError('Name and message content are required.'); return }
    setLoading(true); setError(null)
    const payload: CreateNotificationPayload = {
      template_type: type, name: name.trim(), channel,
      subject: subject.trim() || null, message_content: content.trim(),
    }
    try {
      const res = await fetch('/api/notifications', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      })
      if (!res.ok) { const d = await res.json(); throw new Error(d.error ?? 'Failed') }
      const { template } = await res.json()
      onCreated(template)
      setName(''); setContent(''); setSubject(''); setOpen(false)
    } catch (e) { setError(e instanceof Error ? e.message : 'Unknown error') }
    finally { setLoading(false) }
  }

  return (
    <div className="nwi-card">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between text-left">
        <span className="font-condensed font-bold text-base text-white tracking-wide">+ CREATE NEW TEMPLATE</span>
        <svg className={`w-4 h-4 text-white/40 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7"/>
        </svg>
      </button>

      {open && (
        <form onSubmit={handleSubmit} className="mt-4 space-y-4 border-t border-dark-border pt-4">
          {error && <div className="alert-error">{error}</div>}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="nwi-label">Template type</label>
              <select value={type} onChange={e => setType(e.target.value as NotificationTemplateType)} className="nwi-input">
                {TEMPLATE_TYPES.map(t => <option key={t} value={t}>{TEMPLATE_TYPE_CONFIG[t].label}</option>)}
              </select>
            </div>
            <div>
              <label className="nwi-label">Channel</label>
              <select value={channel} onChange={e => setChannel(e.target.value as NotificationChannel)} className="nwi-input">
                {CHANNELS.map(c => <option key={c} value={c}>{CHANNEL_LABELS[c]}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="nwi-label">Template name</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)}
              placeholder="e.g. Day-Before SMS Reminder" className="nwi-input" />
          </div>
          {(channel === 'email' || channel === 'both') && (
            <div>
              <label className="nwi-label">Email subject</label>
              <input type="text" value={subject} onChange={e => setSubject(e.target.value)}
                placeholder="Your appointment is tomorrow!" className="nwi-input" />
            </div>
          )}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="nwi-label mb-0">Message content</label>
              <span className="text-white/30 text-xs">{content.length} chars</span>
            </div>
            <textarea rows={4} value={content} onChange={e => setContent(e.target.value)}
              placeholder="Hi {{first_name}}, your {{service_type}} is scheduled for…"
              className="nwi-input resize-none" />
            <div className="flex flex-wrap gap-1.5 mt-2">
              {TEMPLATE_MERGE_TAGS.map(tag => (
                <button key={tag} type="button" onClick={() => insertTag(tag)}
                  className="text-[10px] rounded-full border border-dark-border text-white/50 hover:text-white hover:border-white/30 px-2 py-0.5 transition-colors">
                  {tag}
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-3">
            <button type="button" onClick={() => setOpen(false)}
              className="flex-1 border border-dark-border rounded-lg py-2.5 text-white/50 hover:text-white text-sm transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={loading} className="flex-1 btn-primary text-sm py-2.5">
              {loading ? 'Saving…' : 'SAVE TEMPLATE'}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}

// ─── Notification log panel ───────────────────────────────────────────────────

function LogPanel() {
  const [logs,    setLogs]    = useState<NotifLog[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/notifications/logs')
      .then(r => r.json())
      .then(d => setLogs(d.logs ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="text-white/30 text-sm text-center py-6">Loading log…</div>

  if (logs.length === 0) {
    return (
      <div className="text-center py-10">
        <p className="text-white/20 text-sm">No notifications sent yet. They'll appear here after the first send.</p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {logs.map(log => (
        <div key={log.id} className={`rounded-xl border px-4 py-3 flex items-start gap-3 ${
          log.status === 'sent' ? 'border-success/20 bg-success/5' : 'border-danger/20 bg-danger/5'
        }`}>
          <span className={`text-xs font-bold mt-0.5 ${log.status === 'sent' ? 'text-success' : 'text-danger'}`}>
            {log.status === 'sent' ? '✓' : '✗'}
          </span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-0.5">
              <span className="text-white text-xs font-medium">{log.trigger_type.replace(/_/g, ' ')}</span>
              <span className="text-white/30 text-xs">via {log.channel}</span>
              <span className="text-white/20 text-xs">→ {log.recipient}</span>
            </div>
            <p className="text-white/50 text-xs truncate">{log.message}</p>
            {log.error && <p className="text-danger text-xs mt-0.5">{log.error}</p>}
          </div>
          <span className="text-white/20 text-[10px] whitespace-nowrap shrink-0">
            {new Date(log.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
          </span>
        </div>
      ))}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function NotificationsTab() {
  const [templates,  setTemplates] = useState<NotificationTemplate[]>([])
  const [loading,    setLoading]   = useState(true)
  const [seeding,    setSeeding]   = useState(false)
  const [activeView, setActiveView] = useState<'templates' | 'log'>('templates')

  useEffect(() => {
    fetch('/api/notifications')
      .then(r => r.json())
      .then(d => setTemplates(d.templates ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  async function handleToggle(id: string, active: boolean) {
    const res = await fetch('/api/notifications', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, is_active: active }),
    })
    if (res.ok) {
      const { template } = await res.json()
      setTemplates(prev => prev.map(t => t.id === id ? template : t))
    }
  }

  async function handleSave(id: string, updates: Partial<NotificationTemplate>) {
    const res = await fetch(`/api/notifications/${id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    })
    if (res.ok) {
      const { template } = await res.json()
      setTemplates(prev => prev.map(t => t.id === id ? template : t))
    }
  }

  async function handleDelete(id: string) {
    const res = await fetch(`/api/notifications/${id}`, { method: 'DELETE' })
    if (res.ok) setTemplates(prev => prev.filter(t => t.id !== id))
  }

  async function seedDefaults() {
    setSeeding(true)
    const created: NotificationTemplate[] = []
    for (const tpl of DEFAULT_TEMPLATES) {
      const res = await fetch('/api/notifications', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(tpl),
      })
      if (res.ok) { const { template } = await res.json(); created.push(template) }
    }
    setTemplates(prev => [...created, ...prev])
    setSeeding(false)
  }

  const activeCount = templates.filter(t => t.is_active).length

  return (
    <div className="max-w-2xl space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-white/40 text-xs uppercase tracking-widest mb-0.5">Manage</p>
          <p className="font-condensed font-bold text-white text-lg tracking-wide">NOTIFICATION TEMPLATES</p>
        </div>
        {templates.length > 0 && (
          <div className="nwi-card px-4 py-2 text-center">
            <p className="font-condensed font-bold text-xl text-orange">{activeCount}</p>
            <p className="text-white/40 text-xs">Active</p>
          </div>
        )}
      </div>

      {/* Info banner */}
      <div className="bg-blue/10 border border-blue/30 rounded-xl p-4 text-sm text-white/70 leading-relaxed">
        <p className="font-medium text-white mb-1">Four auto-triggers</p>
        <ul className="space-y-0.5 text-xs text-white/60">
          <li>📅 <strong className="text-white/80">Booking Confirmation</strong> — sent automatically when a job is created</li>
          <li>🔔 <strong className="text-white/80">Day-Before Reminder</strong> — sent at 8 AM the day before via cron</li>
          <li>📍 <strong className="text-white/80">On My Way</strong> — sent manually from the job card in My Jobs</li>
          <li>✅ <strong className="text-white/80">Job Completed</strong> — sent automatically when status → Completed</li>
        </ul>
      </div>

      {/* Sub-nav */}
      <div className="flex gap-1 border-b border-dark-border">
        {(['templates', 'log'] as const).map(v => (
          <button key={v} onClick={() => setActiveView(v)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors capitalize ${
              activeView === v ? 'border-orange text-orange' : 'border-transparent text-white/40 hover:text-white'
            }`}>
            {v === 'templates' ? 'Templates' : 'Sent Log'}
          </button>
        ))}
      </div>

      {activeView === 'log' && <LogPanel />}

      {activeView === 'templates' && (
        <>
          <CreateTemplateForm onCreated={t => setTemplates(prev => [t, ...prev])} />

          {loading ? (
            <div className="text-center py-10 text-white/30 text-sm">Loading templates…</div>
          ) : templates.length === 0 ? (
            <div className="nwi-card text-center py-12">
              <p className="text-3xl mb-3">🔔</p>
              <p className="font-condensed font-bold text-xl text-white mb-2">NO TEMPLATES YET</p>
              <p className="text-white/40 text-sm mb-5">Load the four recommended starter templates to get started immediately.</p>
              <button onClick={seedDefaults} disabled={seeding}
                className="bg-blue hover:bg-blue-hover text-white font-condensed font-semibold rounded-lg px-5 py-2.5 text-sm transition-colors disabled:opacity-50">
                {seeding ? 'Loading…' : 'LOAD STARTER TEMPLATES'}
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-white/30 text-xs">{templates.length} template{templates.length !== 1 ? 's' : ''} · {activeCount} active</p>
              {templates.map(t => (
                <TemplateCard key={t.id} template={t}
                  onToggle={handleToggle} onSave={handleSave} onDelete={handleDelete} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
