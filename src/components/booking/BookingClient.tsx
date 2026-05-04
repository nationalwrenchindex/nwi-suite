'use client'

import { useState, useEffect, useRef } from 'react'
import { buildCalendarGrid, monthLabel, toDateStr, formatTime, VEHICLE_CATEGORIES, VEHICLE_CATEGORY_LABELS, type VehicleCategory } from '@/lib/scheduler'

// ─── Types ────────────────────────────────────────────────────────────────────

type DayHours = { enabled: boolean; open: string; close: string }
type WorkingHours = Record<string, DayHours>

export interface PublicProfile {
  business_name:            string | null
  full_name:                string | null
  profession_type:          string | null
  service_area_description: string | null
  working_hours:            WorkingHours | null
}

// ─── Service duration estimates (minutes) ─────────────────────────────────────

const SERVICE_DURATIONS: Record<string, number> = {
  // Mechanic
  'Oil Change':                   45,
  'Brake Service':               120,
  'Tire Rotation':                30,
  'Tire Replacement':             90,
  'Battery Replacement':          30,
  'Engine Diagnostic':            60,
  'A/C Service':                  90,
  'Transmission Service':        120,
  'Suspension Repair':           180,
  'Electrical Repair':            90,
  'Coolant Flush':                60,
  'Power Steering Service':       60,
  'Fuel System Service':          60,
  'Pre-Purchase Inspection':      90,
  // Detailer
  'Basic Wash':                   30,
  'Full Detail':                 240,
  'Interior Detail':             120,
  'Exterior Detail':             120,
  'Paint Correction':            360,
  'Ceramic Coating (1 Year)':    240,
  'Ceramic Coating (3 Year)':    360,
  'Ceramic Coating (5 Year)':    480,
  'Headlight Restoration':        60,
  'Engine Bay Cleaning':          75,
  'Carpet & Upholstery Shampoo': 120,
  'Leather Treatment':            75,
  'Pet Hair & Odor Removal':      90,
  'Boat Detailing':              300,
  'RV Detailing':                480,
  'Other':                        60,
}

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

// Re-fetch slots after 5 minutes of inactivity (prevents stale same-day selections)
const SLOTS_STALE_MS = 5 * 60 * 1000

function durationLabel(min: number): string {
  if (min < 60) return `~${min} min`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m === 0 ? `~${h} hr` : `~${h} hr ${m} min`
}

// ─── Progress bar ─────────────────────────────────────────────────────────────

const STEP_LABELS_MECHANIC  = ['Service', 'Date & Time', 'Your Info', 'Confirm']
const STEP_LABELS_DETAILER  = ['Service', 'Vehicle Type', 'Date & Time', 'Your Info', 'Confirm']

function StepBar({ step, isDetailer }: { step: number; isDetailer?: boolean }) {
  const STEP_LABELS = isDetailer ? STEP_LABELS_DETAILER : STEP_LABELS_MECHANIC
  return (
    <div className="flex items-center justify-center gap-0 mb-8">
      {STEP_LABELS.map((label, i) => {
        const n = i + 1
        const done    = n < step
        const current = n === step
        return (
          <div key={n} className="flex items-center">
            <div className="flex flex-col items-center">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold transition-all
                ${done    ? 'bg-success text-white'
                : current ? 'bg-orange text-white ring-4 ring-orange/20'
                          : 'bg-dark-border text-white/30'}`}>
                {done
                  ? <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                  : n}
              </div>
              <span className={`mt-1 text-[10px] font-medium hidden sm:block ${current ? 'text-orange' : done ? 'text-success' : 'text-white/30'}`}>
                {label}
              </span>
            </div>
            {i < STEP_LABELS.length - 1 && (
              <div className={`w-10 sm:w-16 h-0.5 mb-4 sm:mb-0 transition-colors ${done ? 'bg-success' : 'bg-dark-border'}`} />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── Mini calendar ────────────────────────────────────────────────────────────

function MiniCalendar({
  selected,
  onSelect,
  workingHours,
}: {
  selected: string | null
  onSelect: (date: string) => void
  workingHours: WorkingHours | null
}) {
  const [year, setYear]     = useState(() => new Date().getFullYear())
  const [month, setMonth]   = useState(() => new Date().getMonth())
  const [todayDate, setTodayDate] = useState('')
  useEffect(() => setTodayDate(toDateStr(new Date())), [])
  const grid = buildCalendarGrid(year, month)
  const label = monthLabel(year, month)

  function isEnabled(day: number): boolean {
    const d = new Date(year, month, day)
    const now = new Date()
    if (d < new Date(now.getFullYear(), now.getMonth(), now.getDate())) return false
    if (!workingHours) return true
    const dayName = DAY_NAMES[d.getDay()]
    return workingHours[dayName]?.enabled ?? false
  }

  function prev() {
    if (month === 0) { setYear(y => y - 1); setMonth(11) }
    else setMonth(m => m - 1)
  }
  function next() {
    if (month === 11) { setYear(y => y + 1); setMonth(0) }
    else setMonth(m => m + 1)
  }

  return (
    <div className="nwi-card select-none">
      {/* Month nav */}
      <div className="flex items-center justify-between mb-4">
        <button onClick={prev} className="p-2 text-white/40 hover:text-white transition-colors">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <span className="font-condensed font-bold text-white text-sm tracking-wide">{label.toUpperCase()}</span>
        <button onClick={next} className="p-2 text-white/40 hover:text-white transition-colors">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      {/* Day headers */}
      <div className="grid grid-cols-7 mb-2">
        {['Su','Mo','Tu','We','Th','Fr','Sa'].map(d => (
          <div key={d} className="text-center text-white/30 text-[10px] font-semibold py-1">{d}</div>
        ))}
      </div>

      {/* Day grid */}
      <div className="grid grid-cols-7 gap-y-1">
        {grid.map((day, i) => {
          if (!day) return <div key={i} />
          const enabled = isEnabled(day)
          const dateStr = toDateStr(new Date(year, month, day))
          const isSel   = selected === dateStr
          const isToday = !!todayDate && todayDate === dateStr
          return (
            <button
              key={i}
              disabled={!enabled}
              onClick={() => onSelect(dateStr)}
              className={`mx-auto w-8 h-8 rounded-lg text-sm font-medium transition-all
                ${isSel
                  ? 'bg-orange text-white font-bold'
                  : isToday && enabled
                  ? 'border border-orange/50 text-orange hover:bg-orange/10'
                  : enabled
                  ? 'text-white hover:bg-dark-border'
                  : 'text-white/15 cursor-not-allowed'}`}
            >
              {day}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ─── Photo upload helpers ─────────────────────────────────────────────────────

interface PhotoEntry {
  id:        string
  localUrl:  string
  serverUrl: string | null
  uploading: boolean
  error:     string | null
}

async function compressImage(file: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const MAX = 1600
      let { width, height } = img
      if (width > MAX || height > MAX) {
        const ratio = Math.min(MAX / width, MAX / height)
        width  = Math.round(width  * ratio)
        height = Math.round(height * ratio)
      }
      const canvas = document.createElement('canvas')
      canvas.width  = width
      canvas.height = height
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0, width, height)
      canvas.toBlob(
        blob => blob ? resolve(blob) : reject(new Error('Compression failed')),
        'image/jpeg',
        0.75,
      )
    }
    img.onerror = reject
    img.src = URL.createObjectURL(file)
  })
}

async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload  = () => resolve((reader.result as string).split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

function PhotoUploader({
  techSlug,
  photos,
  onChange,
  maxPhotos = 5,
}: {
  techSlug:  string
  photos:    PhotoEntry[]
  onChange:  (photos: PhotoEntry[]) => void
  maxPhotos?: number
}) {
  const inputRef  = useRef<HTMLInputElement>(null)
  const remaining = maxPhotos - photos.length

  async function handleFiles(files: FileList) {
    const toAdd = Array.from(files).slice(0, remaining)
    if (toAdd.length === 0) return

    const newEntries: PhotoEntry[] = toAdd.map(f => ({
      id:        Math.random().toString(36).slice(2),
      localUrl:  URL.createObjectURL(f),
      serverUrl: null,
      uploading: true,
      error:     null,
    }))

    // Track the combined array locally so async updates don't use stale closure
    let localPhotos = [...photos, ...newEntries]
    onChange(localPhotos)

    for (let i = 0; i < toAdd.length; i++) {
      const file  = toAdd[i]
      const entry = newEntries[i]
      try {
        const compressed = await compressImage(file)
        const base64     = await blobToBase64(compressed)
        const res        = await fetch(`/api/book/${techSlug}/photos`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ image: base64 }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? 'Upload failed')
        localPhotos = localPhotos.map(p =>
          p.id === entry.id ? { ...p, serverUrl: data.url, uploading: false } : p
        )
        onChange(localPhotos)
      } catch (e) {
        localPhotos = localPhotos.map(p =>
          p.id === entry.id
            ? { ...p, uploading: false, error: e instanceof Error ? e.message : 'Upload failed' }
            : p
        )
        onChange(localPhotos)
      }
    }
  }

  function remove(id: string) {
    onChange(photos.filter(p => p.id !== id))
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {photos.map(p => (
          <div key={p.id} className="relative w-20 h-20 rounded-xl overflow-hidden border border-dark-border flex-shrink-0">
            <img
              src={p.serverUrl ?? p.localUrl}
              alt=""
              className="w-full h-full object-cover"
            />
            {p.uploading && (
              <div className="absolute inset-0 bg-dark/70 flex items-center justify-center">
                <svg className="animate-spin w-5 h-5 text-white" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                </svg>
              </div>
            )}
            {p.error && (
              <div className="absolute inset-0 bg-danger/80 flex items-center justify-center">
                <span className="text-white text-[9px] text-center px-1 leading-tight">{p.error}</span>
              </div>
            )}
            {!p.uploading && (
              <button
                type="button"
                onClick={() => remove(p.id)}
                className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 flex items-center justify-center text-white hover:bg-danger/80 transition-colors"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            )}
          </div>
        ))}

        {remaining > 0 && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="w-20 h-20 rounded-xl border border-dashed border-dark-border flex flex-col items-center justify-center gap-1 text-white/30 hover:text-white/60 hover:border-white/30 transition-colors flex-shrink-0"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/>
            </svg>
            <span className="text-[10px]">Add photo</span>
          </button>
        )}
      </div>

      <p className="text-white/25 text-xs">
        {photos.length}/{maxPhotos} photos · JPEG, PNG, or WebP · compressed automatically
      </p>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        className="hidden"
        onChange={e => { if (e.target.files?.length) { handleFiles(e.target.files); e.target.value = '' } }}
      />
    </div>
  )
}

// ─── Main booking wizard ──────────────────────────────────────────────────────

export default function BookingClient({
  techSlug,
  businessType = 'mechanic',
  profile,
  services,
  offerMpi = false,
  initialStep = 1,
}: {
  techSlug:      string
  businessType?: string
  profile:       PublicProfile
  services:      string[]
  offerMpi?:     boolean
  initialStep?:  number
}) {
  const isDetailer = businessType === 'detailer'
  const [step, setStep] = useState(initialStep)

  // Keep the URL ?step= in sync with the current step so deep-links stay accurate
  // and back/forward navigation reflects where the user is in the flow.
  useEffect(() => {
    const path = window.location.pathname
    const url  = step === 1 ? path : `${path}?step=${step}`
    window.history.replaceState(null, '', url)
  }, [step])

  // Step 1
  const [service,          setService]          = useState<string | null>(null)
  const [selectedServices, setSelectedServices] = useState<string[]>([])   // detailer multi-select
  const [notes,            setNotes]            = useState('')

  // Step 2 (detailer only) — Vehicle category
  const [vehicleCategory, setVehicleCategory] = useState<VehicleCategory | null>(null)

  // Step 2
  const [date,             setDate]             = useState<string | null>(null)
  const [time,             setTime]             = useState<string | null>(null)
  const [slots,            setSlots]            = useState<string[]>([])
  const [unavailableSlots, setUnavailableSlots] = useState<string[]>([])
  const [slotsLoading,     setSlotsLoading]     = useState(false)
  const [slotsLastFetched, setSlotsLastFetched] = useState(0)
  const [fetchKey,         setFetchKey]         = useState(0)

  // Step 3
  const [firstName, setFirstName] = useState('')
  const [lastName,  setLastName]  = useState('')
  const [phone,     setPhone]     = useState('')
  const [email,     setEmail]     = useState('')
  const [vYear,     setVYear]     = useState('')
  const [vMake,     setVMake]     = useState('')
  const [vModel,    setVModel]    = useState('')

  // Step 4 — booking submit
  const [submitting, setSubmitting] = useState(false)
  const [submitted,  setSubmitted]  = useState(false)
  const [jobId,      setJobId]      = useState<string | null>(null)
  const [error,      setError]      = useState<string | null>(null)

  // Photo uploads (detailer only)
  const [bookingPhotos, setBookingPhotos] = useState<PhotoEntry[]>([])

  // SMS consent (unchecked by default — 10DLC/TCR compliance)
  const [smsConsent, setSmsConsent] = useState(false)

  // MPI add-on (always off by default — customer must opt in)
  const [inspectionRequested, setInspectionRequested] = useState(false)
  const [showMpiModal,        setShowMpiModal]        = useState(false)

  // Duration of the intended booking — used by the server to run the same overlap
  // check as the POST endpoint, so every displayed slot is guaranteed bookable.
  const bookingDuration = isDetailer
    ? Math.max(60, selectedServices.reduce((sum, s) => sum + (SERVICE_DURATIONS[s] ?? 60), 0))
    : (service ? (SERVICE_DURATIONS[service] ?? 60) : 60)

  // Fetch slots when date, fetchKey, or booking duration changes
  useEffect(() => {
    if (!date) return
    setTime(null)
    setSlots([])
    setUnavailableSlots([])
    setSlotsLoading(true)
    fetch(`/api/book/${techSlug}?date=${date}&duration=${bookingDuration}`)
      .then(r => r.json())
      .then(d => {
        setSlots(d.slots ?? [])
        setUnavailableSlots(d.unavailable ?? [])
        setSlotsLastFetched(Date.now())
      })
      .catch(() => { setSlots([]); setUnavailableSlots([]) })
      .finally(() => setSlotsLoading(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, fetchKey, techSlug, bookingDuration])

  // Logical step numbers:
  // Mechanic:  1=service, 2=datetime, 3=info, 4=confirm
  // Detailer:  1=service, 2=vehicle cat, 3=datetime, 4=info, 5=confirm
  const dateTimeStep = isDetailer ? 3 : 2
  const infoStep     = isDetailer ? 4 : 3
  const confirmStep  = isDetailer ? 5 : 4

  function canAdvance() {
    if (step === 1) return isDetailer ? selectedServices.length > 0 : !!service
    if (isDetailer && step === 2) return !!vehicleCategory
    if (step === dateTimeStep) return !!date && !!time
    if (step === infoStep) return (
      firstName.trim() !== '' &&
      lastName.trim()  !== '' &&
      (!smsConsent || phone.trim() !== '')
    )
    return true
  }

  function goNext() {
    if (!canAdvance()) return

    // Guard: deep-link to info step without completing earlier steps
    if (step === infoStep && (!(isDetailer ? selectedServices.length > 0 : service) || !date || !time)) {
      setError('Please complete service selection and date/time before reviewing your booking.')
      setStep(1)
      return
    }

    setError(null)
    setStep(s => s + 1)
  }

  function goBack() {
    setError(null)
    setStep(s => s - 1)
  }

  async function handleSubmit() {
    setSubmitting(true)
    setError(null)
    try {
      const uploadedPhotoUrls = bookingPhotos.filter(p => p.serverUrl).map(p => p.serverUrl!)
      const totalDuration = isDetailer
        ? selectedServices.reduce((sum, s) => sum + (SERVICE_DURATIONS[s] ?? 60), 0)
        : (service ? (SERVICE_DURATIONS[service] ?? 60) : 60)
      const payload: Record<string, unknown> = {
        service_type:               isDetailer ? (selectedServices[0] ?? null) : service,
        services:                   isDetailer ? selectedServices : [],
        job_date:                   date,
        job_time:                   time,
        notes:                      notes || null,
        estimated_duration_minutes: totalDuration,
        inspection_requested:       inspectionRequested,
        sms_consent:                smsConsent,
        vehicle_category:           vehicleCategory || null,
        photos:                     uploadedPhotoUrls,
        customer: {
          first_name: firstName.trim(),
          last_name:  lastName.trim(),
          phone:      phone.trim() || null,
          email:      email.trim() || null,
        },
      }
      if (vMake.trim() && vModel.trim()) {
        payload.vehicle = {
          year:  vYear ? parseInt(vYear) : null,
          make:  vMake.trim(),
          model: vModel.trim(),
        }
      }

      const res = await fetch(`/api/book/${techSlug}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) {
        const msg = data.error ?? 'Booking failed'
        if (res.status === 409) {
          // Slot was taken — send customer back to the date/time picker
          setTime(null)
          setStep(dateTimeStep)
        }
        throw new Error(msg)
      }
      setJobId(data.job?.id ?? null)
      setSubmitted(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  // Calendar date selection — re-fetches if the same date is selected after slots went stale
  function handleDateSelect(d: string) {
    if (d === date) {
      if (Date.now() - slotsLastFetched >= SLOTS_STALE_MS) {
        setFetchKey(k => k + 1)
      }
      return
    }
    setDate(d)
    setTime(null)
  }

  const bizName = profile.business_name ?? profile.full_name ?? 'Your Technician'
  const totalDuration = isDetailer
    ? selectedServices.reduce((sum, s) => sum + (SERVICE_DURATIONS[s] ?? 60), 0)
    : (service ? SERVICE_DURATIONS[service] ?? 60 : 60)

  // ── Success screen ──
  if (submitted) {
    return (
      <div className="min-h-dvh bg-dark flex flex-col">
        <BookingHeader bizName={bizName} profile={profile} isDetailer={isDetailer} />
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="w-full max-w-md text-center">
            <div className="w-20 h-20 bg-success/20 border border-success/30 rounded-full flex items-center justify-center mx-auto mb-6">
              <svg className="w-10 h-10 text-success" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h2 className="font-condensed font-bold text-3xl text-white tracking-wide mb-2">BOOKING CONFIRMED!</h2>
            <p className="text-white/60 text-sm mb-6 leading-relaxed">
              Your{' '}
              <strong className="text-white">
                {isDetailer ? selectedServices.join(' + ') : service}
              </strong>{' '}
              appointment is scheduled for{' '}
              <strong className="text-white">{date && formatDateFull(date)}</strong> at{' '}
              <strong className="text-white">{time && formatTime(time)}</strong>.
              {(phone || email) && ' A confirmation message is on its way to you.'}
            </p>

            <div className="nwi-card text-left space-y-3 mb-8">
              <Detail
                label={isDetailer && selectedServices.length > 1 ? 'Services' : 'Service'}
                value={isDetailer ? selectedServices.join(', ') : (service ?? '')}
              />
              <Detail label="Date"        value={date  ? formatDateFull(date) : ''} />
              <Detail label="Time"        value={time  ? formatTime(time) : ''} />
              <Detail label="Est. Duration" value={durationLabel(totalDuration)} />
              <Detail label="Technician"  value={bizName} />
              {inspectionRequested && <Detail label="Add-On" value="25-Point Multi-Point Inspection" />}
              {jobId && <Detail label="Booking ID" value={jobId.slice(0, 8).toUpperCase()} />}
            </div>

            <p className="text-white/30 text-xs">
              Need to reschedule? Contact {bizName} directly.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-dvh bg-dark flex flex-col">
      <BookingHeader bizName={bizName} profile={profile} isDetailer={isDetailer} />

      <div className="flex-1 flex justify-center p-4 sm:p-8 pb-24">
        <div className="w-full max-w-xl">
          <StepBar step={step} isDetailer={isDetailer} />

          {error && (
            <div className="bg-danger/10 border border-danger/30 rounded-xl px-4 py-3 text-danger text-sm mb-5">
              {error}
            </div>
          )}

          {/* ── Step 1: Service ── */}
          {step === 1 && (
            <div>
              <h2 className="font-condensed font-bold text-2xl text-white tracking-wide mb-1">
                WHAT SERVICE DO YOU NEED?
              </h2>
              <p className="text-white/40 text-sm mb-6">
                {isDetailer ? 'Select all services for this visit.' : 'Select one to get started.'}
              </p>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-3">
                {services.map(svc => {
                  const dur = SERVICE_DURATIONS[svc] ?? 60
                  const sel = isDetailer ? selectedServices.includes(svc) : service === svc
                  return (
                    <button
                      key={svc}
                      onClick={() => {
                        if (isDetailer) {
                          setSelectedServices(prev =>
                            prev.includes(svc) ? prev.filter(s => s !== svc) : [...prev, svc]
                          )
                        } else {
                          setService(svc)
                        }
                      }}
                      className={`rounded-xl border px-3 py-3 text-left transition-all ${
                        sel
                          ? 'border-orange bg-orange/10 ring-1 ring-orange/40'
                          : 'border-dark-border bg-dark-card hover:border-white/20 hover:bg-dark-input'
                      }`}
                    >
                      <p className={`text-xs font-semibold leading-tight mb-1 ${sel ? 'text-orange' : 'text-white'}`}>
                        {svc}
                      </p>
                      <p className="text-white/30 text-[10px]">{durationLabel(dur)}</p>
                    </button>
                  )
                })}
              </div>

              {/* Running tally — detailer only */}
              {isDetailer && (
                <div className={`rounded-xl border px-4 py-3 mb-5 transition-colors ${
                  selectedServices.length > 0
                    ? 'border-orange/30 bg-orange/5'
                    : 'border-dark-border bg-dark-card/50'
                }`}>
                  {selectedServices.length === 0 ? (
                    <p className="text-white/30 text-sm">No services selected yet.</p>
                  ) : (
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-orange text-sm font-semibold">
                        {selectedServices.length} service{selectedServices.length > 1 ? 's' : ''} selected
                      </p>
                      <p className="text-white/50 text-xs">
                        {durationLabel(selectedServices.reduce((s, svc) => s + (SERVICE_DURATIONS[svc] ?? 60), 0))} total
                      </p>
                    </div>
                  )}
                </div>
              )}

              <div className="mb-6">
                <label className="nwi-label">Additional notes <span className="text-white/30">(optional)</span></label>
                <textarea
                  rows={3}
                  className="nwi-input resize-none"
                  placeholder="Describe the issue, vehicle symptoms, or anything the tech should know…"
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                />
              </div>
            </div>
          )}

          {/* ── Step 2 (detailer only): Vehicle Category ── */}
          {isDetailer && step === 2 && (
            <div>
              <h2 className="font-condensed font-bold text-2xl text-white tracking-wide mb-1">
                WHAT TYPE OF VEHICLE?
              </h2>
              <p className="text-white/40 text-sm mb-6">Select the vehicle type for this service.</p>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-5">
                {VEHICLE_CATEGORIES.map(cat => {
                  const sel = vehicleCategory === cat
                  return (
                    <button
                      key={cat}
                      onClick={() => setVehicleCategory(cat)}
                      className={`rounded-xl border px-3 py-4 text-left transition-all ${
                        sel
                          ? 'border-orange bg-orange/10 ring-1 ring-orange/40'
                          : 'border-dark-border bg-dark-card hover:border-white/20 hover:bg-dark-input'
                      }`}
                    >
                      <p className={`text-xs font-semibold leading-tight ${sel ? 'text-orange' : 'text-white'}`}>
                        {VEHICLE_CATEGORY_LABELS[cat]}
                      </p>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* ── Step 2 (mechanic) / Step 3 (detailer): Date & Time ── */}
          {step === dateTimeStep && (
            <div>
              <h2 className="font-condensed font-bold text-2xl text-white tracking-wide mb-1">
                PICK A DATE & TIME
              </h2>
              <p className="text-white/40 text-sm mb-6">
                Available dates based on {bizName}&apos;s schedule.
              </p>

              <MiniCalendar
                selected={date}
                onSelect={handleDateSelect}
                workingHours={profile.working_hours}
              />

              {date && (
                <div className="mt-5">
                  <p className="text-white/40 text-xs uppercase tracking-widest mb-3">
                    Available times — {formatDateFull(date)}
                  </p>

                  {(() => {
                    const unavailSet = new Set(unavailableSlots)
                    const allDisplaySlots = [...unavailableSlots, ...slots].sort((a, b) => {
                      const [ah, am] = a.split(':').map(Number)
                      const [bh, bm] = b.split(':').map(Number)
                      return (ah * 60 + am) - (bh * 60 + bm)
                    })
                    return slotsLoading ? (
                      <div className="flex gap-2 flex-wrap">
                        {[1,2,3,4,5,6].map(i => (
                          <div key={i} className="w-20 h-9 rounded-lg bg-dark-border/50 animate-pulse" />
                        ))}
                      </div>
                    ) : allDisplaySlots.length === 0 ? (
                      <p className="text-white/30 text-sm py-4">
                        No available slots on this date. Please pick another day.
                      </p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {allDisplaySlots.map(slot => {
                          const isUnavailable = unavailSet.has(slot)
                          const isSel = time === slot
                          return (
                            <button
                              key={slot}
                              disabled={isUnavailable}
                              onClick={() => setTime(slot)}
                              className={`px-4 py-2 rounded-lg border text-sm font-medium transition-all flex flex-col items-center min-w-[5rem] ${
                                isUnavailable
                                  ? 'border-[#4a4a4a] cursor-not-allowed opacity-60'
                                  : isSel
                                  ? 'border-orange bg-orange/10 text-orange ring-1 ring-orange/30'
                                  : 'border-dark-border text-white/70 hover:border-white/30 hover:text-white'
                              }`}
                            >
                              <span className={isUnavailable ? 'line-through text-[#4a4a4a]' : ''}>
                                {formatTime(slot)}
                              </span>
                              {isUnavailable && (
                                <span className="text-[9px] text-[#4a4a4a] leading-none mt-0.5 no-underline">
                                  Unavailable
                                </span>
                              )}
                            </button>
                          )
                        })}
                      </div>
                    )
                  })()}
                </div>
              )}
            </div>
          )}

          {/* ── Step 3 (mechanic) / Step 4 (detailer): Contact info ── */}
          {step === infoStep && (
            <div>
              <h2 className="font-condensed font-bold text-2xl text-white tracking-wide mb-1">
                YOUR CONTACT INFO
              </h2>
              <p className="text-white/40 text-sm mb-6">So {bizName} can confirm your appointment.</p>

              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="nwi-label">First name <span className="text-danger">*</span></label>
                    <input className="nwi-input" placeholder="John"
                      value={firstName} onChange={e => setFirstName(e.target.value)} />
                  </div>
                  <div>
                    <label className="nwi-label">Last name <span className="text-danger">*</span></label>
                    <input className="nwi-input" placeholder="Doe"
                      value={lastName} onChange={e => setLastName(e.target.value)} />
                  </div>
                </div>

                <div>
                  <label className="nwi-label">
                    Phone number{smsConsent ? <span className="text-danger"> *</span> : null}
                  </label>
                  <input className="nwi-input" type="tel" placeholder="(555) 867-5309"
                    value={phone} onChange={e => setPhone(e.target.value)} />
                  <p className="text-white/25 text-xs mt-1">Required if you want SMS notifications. Optional otherwise.</p>
                </div>

                {/* SMS consent — TCR/A2P 10DLC compliance */}
                <div className={`rounded-xl border px-4 py-4 transition-colors ${
                  smsConsent ? 'border-orange/40 bg-orange/5' : 'border-dark-border bg-dark-card'
                }`}>
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={smsConsent}
                      onChange={e => setSmsConsent(e.target.checked)}
                      className="mt-0.5 w-4 h-4 accent-orange flex-shrink-0"
                    />
                    <span className="text-white text-sm leading-snug">
                      I agree to receive SMS notifications about my appointment from <strong>{bizName}</strong>.
                    </span>
                  </label>
                  <p className="text-white/35 text-xs mt-3 pl-7 leading-relaxed">
                    Message frequency varies based on appointment activity. Message and data rates may apply.
                    Reply STOP to unsubscribe at any time. Reply HELP for help.{' '}
                    <a href="/privacy" target="_blank" rel="noopener noreferrer"
                      className="underline text-white/50 hover:text-white/75 transition-colors">
                      Privacy Policy
                    </a>
                    {' · '}
                    <a href="/terms" target="_blank" rel="noopener noreferrer"
                      className="underline text-white/50 hover:text-white/75 transition-colors">
                      Terms of Service
                    </a>
                  </p>
                </div>

                <div>
                  <label className="nwi-label">Email <span className="text-white/30">(optional)</span></label>
                  <input className="nwi-input" type="email" placeholder="john@example.com"
                    value={email} onChange={e => setEmail(e.target.value)} />
                </div>

                <div className="border-t border-dark-border pt-4">
                  <p className="font-condensed font-bold text-white/60 text-sm tracking-wide mb-3">
                    VEHICLE INFO <span className="font-normal normal-case text-white/30 text-xs ml-1">optional</span>
                  </p>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="nwi-label">Year</label>
                      <input className="nwi-input" placeholder="2019" maxLength={4}
                        value={vYear} onChange={e => setVYear(e.target.value)} />
                    </div>
                    <div>
                      <label className="nwi-label">Make</label>
                      <input className="nwi-input" placeholder="Toyota"
                        value={vMake} onChange={e => setVMake(e.target.value)} />
                    </div>
                    <div>
                      <label className="nwi-label">Model</label>
                      <input className="nwi-input" placeholder="Camry"
                        value={vModel} onChange={e => setVModel(e.target.value)} />
                    </div>
                  </div>
                </div>

                {/* Photo upload — detailer bookings only */}
                {isDetailer && (
                  <div className="border-t border-dark-border pt-4">
                    <p className="font-condensed font-bold text-white/60 text-sm tracking-wide mb-1">
                      VEHICLE PHOTOS <span className="font-normal normal-case text-white/30 text-xs ml-1">optional</span>
                    </p>
                    <p className="text-white/35 text-xs mb-3 leading-relaxed">
                      Photos help your detailer give an accurate quote (e.g. show condition, problem areas, vehicle size).
                    </p>
                    <PhotoUploader
                      techSlug={techSlug}
                      photos={bookingPhotos}
                      onChange={setBookingPhotos}
                      maxPhotos={5}
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Step 4 (mechanic) / Step 5 (detailer): Review ── */}
          {step === confirmStep && (
            <div>
              <h2 className="font-condensed font-bold text-2xl text-white tracking-wide mb-1">
                REVIEW YOUR BOOKING
              </h2>
              <p className="text-white/40 text-sm mb-6">Everything look right?</p>

              <div className="nwi-card space-y-3 mb-6">
                <div className="pb-3 border-b border-dark-border">
                  <p className="text-white/30 text-[10px] uppercase tracking-widest mb-1">
                    {isDetailer && selectedServices.length > 1 ? 'Services' : 'Service'}
                  </p>
                  {isDetailer && selectedServices.length > 1 ? (
                    <div className="space-y-1.5 mt-1">
                      {selectedServices.map((svc, i) => (
                        <div key={i} className="flex items-center justify-between gap-2">
                          <p className="text-white text-sm">{svc}</p>
                          <p className="text-white/40 text-[11px]">{durationLabel(SERVICE_DURATIONS[svc] ?? 60)}</p>
                        </div>
                      ))}
                      <div className="flex items-center justify-between gap-2 border-t border-dark-border pt-1.5 mt-1">
                        <p className="text-white/50 text-xs">Total</p>
                        <p className="text-white/60 text-xs">{durationLabel(totalDuration)}</p>
                      </div>
                    </div>
                  ) : (
                    <>
                      <p className="text-white font-semibold">{isDetailer ? selectedServices[0] : service}</p>
                      <p className="text-white/40 text-xs mt-0.5">{durationLabel(totalDuration)}</p>
                    </>
                  )}
                </div>
                {vehicleCategory && (
                  <div className="pb-3 border-b border-dark-border">
                    <p className="text-white/30 text-[10px] uppercase tracking-widest mb-1">Vehicle Type</p>
                    <p className="text-white text-sm">{VEHICLE_CATEGORY_LABELS[vehicleCategory]}</p>
                  </div>
                )}
                <div className="pb-3 border-b border-dark-border grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-white/30 text-[10px] uppercase tracking-widest mb-1">Date</p>
                    <p className="text-white text-sm">{date && formatDateFull(date)}</p>
                  </div>
                  <div>
                    <p className="text-white/30 text-[10px] uppercase tracking-widest mb-1">Time</p>
                    <p className="text-white text-sm">{time && formatTime(time)}</p>
                  </div>
                </div>
                <div className="pb-3 border-b border-dark-border">
                  <p className="text-white/30 text-[10px] uppercase tracking-widest mb-1">Customer</p>
                  <p className="text-white text-sm">{firstName} {lastName}</p>
                  <p className="text-white/50 text-xs">{phone}{email ? ` · ${email}` : ''}</p>
                </div>
                {(vMake || vModel) && (
                  <div className="pb-3 border-b border-dark-border">
                    <p className="text-white/30 text-[10px] uppercase tracking-widest mb-1">Vehicle</p>
                    <p className="text-white text-sm">{[vYear, vMake, vModel].filter(Boolean).join(' ')}</p>
                  </div>
                )}
                {notes && (
                  <div>
                    <p className="text-white/30 text-[10px] uppercase tracking-widest mb-1">Notes</p>
                    <p className="text-white/60 text-xs leading-relaxed">{notes}</p>
                  </div>
                )}
              </div>

              {/* MPI add-on checkbox — only show if mechanic has enabled it */}
              {offerMpi && (
                <div className={`rounded-xl border px-4 py-4 mb-4 transition-colors ${
                  inspectionRequested
                    ? 'border-orange/40 bg-orange/5'
                    : 'border-dark-border bg-dark-card'
                }`}>
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={inspectionRequested}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setShowMpiModal(true)
                        } else {
                          setInspectionRequested(false)
                        }
                      }}
                      className="mt-0.5 w-4 h-4 accent-orange flex-shrink-0"
                    />
                    <div>
                      <p className="text-white text-sm font-medium">Add 25-Point Multi-Point Inspection</p>
                      <p className="text-white/40 text-xs mt-0.5">
                        A thorough inspection of 25 points — fluids, brakes, tires, lights, and more.
                        {inspectionRequested && (
                          <span className="text-orange font-medium"> +0.5 labor hours added.</span>
                        )}
                      </p>
                    </div>
                  </label>
                </div>
              )}

              <div className="bg-blue/10 border border-blue/20 rounded-xl px-4 py-3 text-xs text-white/50 mb-6">
                By booking you agree to be contacted by {bizName} about this appointment.
              </div>

              {/* MPI confirmation modal */}
              {showMpiModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70">
                  <div className="bg-dark-card border border-dark-border rounded-2xl p-6 max-w-sm w-full">
                    <h3 className="font-condensed font-bold text-xl text-white tracking-wide mb-2">
                      Add 25-Point Inspection?
                    </h3>
                    <p className="text-white/60 text-sm leading-relaxed mb-6">
                      Adding the 25-point inspection will add{' '}
                      <span className="text-white font-semibold">0.5 labor hours</span> to your invoice.
                      Continue?
                    </p>
                    <div className="flex gap-3">
                      <button
                        onClick={() => {
                          setInspectionRequested(true)
                          setShowMpiModal(false)
                        }}
                        className="flex-1 py-3 bg-orange hover:bg-orange/90 text-white font-condensed font-bold text-sm rounded-xl transition-colors"
                      >
                        Yes, Add It
                      </button>
                      <button
                        onClick={() => {
                          setInspectionRequested(false)
                          setShowMpiModal(false)
                        }}
                        className="flex-1 py-3 border border-dark-border text-white/60 hover:text-white font-condensed font-bold text-sm rounded-xl transition-colors"
                      >
                        No Thanks
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Navigation ── */}
          <div className={`fixed bottom-0 left-0 right-0 bg-dark border-t border-dark-border p-4 flex gap-3 ${step === 1 ? 'justify-end' : 'justify-between'}`}>
            {step > 1 && (
              <button
                onClick={goBack}
                className="px-5 py-3 border border-dark-border rounded-xl text-white/60 hover:text-white text-sm font-medium transition-colors"
              >
                ← Back
              </button>
            )}

            {step < confirmStep ? (
              <button
                onClick={goNext}
                disabled={!canAdvance()}
                className="flex-1 sm:flex-none sm:px-8 py-3 bg-orange hover:bg-orange/90 disabled:opacity-40 disabled:cursor-not-allowed text-white font-condensed font-bold text-sm rounded-xl transition-colors tracking-wide"
              >
                {step === infoStep ? 'REVIEW BOOKING →' : 'CONTINUE →'}
              </button>
            ) : (
              <button
                onClick={handleSubmit}
                disabled={submitting}
                className="flex-1 sm:flex-none sm:px-8 py-3 bg-orange hover:bg-orange/90 disabled:opacity-40 text-white font-condensed font-bold text-sm rounded-xl transition-colors tracking-wide"
              >
                {submitting
                  ? <span className="flex items-center gap-2 justify-center"><Spinner />BOOKING…</span>
                  : 'CONFIRM BOOKING'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Header ───────────────────────────────────────────────────────────────────

function BookingHeader({ bizName, profile, isDetailer }: { bizName: string; profile: PublicProfile; isDetailer?: boolean }) {
  const professionLabels: Record<string, string> = {
    mobile_mechanic:  'Mobile Mechanic',
    auto_electrician: 'Auto Electrician',
    diagnostician:    'Diagnostician',
    tire_technician:  'Tire Technician',
    other:            'Auto Technician',
  }
  const profLabel = isDetailer
    ? 'Mobile Detailer'
    : (profile.profession_type ? professionLabels[profile.profession_type] ?? 'Auto Technician' : 'Auto Technician')

  return (
    <header className="border-b border-dark-border bg-dark-card px-4 sm:px-8 py-4">
      <div className="max-w-xl mx-auto flex items-center gap-4">
        <div className="w-10 h-10 bg-orange rounded-xl flex items-center justify-center flex-shrink-0">
          <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
            <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-condensed font-bold text-white text-lg leading-none truncate">{bizName}</p>
          <p className="text-white/40 text-xs mt-0.5">
            {profLabel}{profile.service_area_description ? ` · ${profile.service_area_description}` : ''}
          </p>
        </div>
        <div className="hidden sm:flex flex-col items-end">
          <p className="text-white/20 text-[9px] uppercase tracking-widest">Powered by</p>
          <p className="font-condensed font-bold text-white/40 text-xs tracking-wide">NATIONAL WRENCH INDEX SUITE</p>
        </div>
      </div>
    </header>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-white/40 text-xs">{label}</span>
      <span className="text-white text-sm text-right">{value}</span>
    </div>
  )
}

function Spinner() {
  return (
    <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}

function formatDateFull(dateStr: string): string {
  const [y, mo, d] = dateStr.split('-').map(Number)
  return new Date(y, mo - 1, d).toLocaleDateString('en-US', {
    weekday: 'long',
    month:   'long',
    day:     'numeric',
    year:    'numeric',
  })
}
