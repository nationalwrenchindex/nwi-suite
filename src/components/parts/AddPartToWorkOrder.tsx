'use client'

// SCREEN 4: add a part from inside a work order.
//
// The one that matters most, because it is the one a technician uses with a customer
// waiting. It opens ALREADY FILTERED to the unit on the job - make, model and serial
// come off the work order, the inputs are locked, and the first list is on screen
// without anybody typing a model.
//
// WHY THIS LIVES ON THE HD WORK ORDER AND NOT THE LD ONE
//
// The catalog is reefer parts: Thermo King and Carrier Transicold units. An LD work
// order's "unit" is the customer's VEHICLE - a truck, with a make like Freightliner
// and a model like M2 - and filtering a reefer catalog by a truck make returns nothing,
// every time. hd_work_orders is where unit_manufacturer, unit_model and unit_serial
// live, so that is where a unit-filtered parts picker can actually work. Putting it on
// the LD form would have looked finished and returned an empty list forever.
//
// WHAT IT DOES WITH MONEY: nothing. It hands back the part number, the description and
// the COST, and the line item path already in place applies the work order's recorded
// markup and computes the price. No arithmetic here touches a billing record.

import { useState } from 'react'
import PartsFinder, { type PickedPart } from './PartsFinder'

interface Props {
  unit: {
    manufacturer: string | null
    model: string | null
    serial: string | null
  }
  /** The work order's RECORDED markup, not today's settings value. */
  markupPercent: number | null
  /** Receives the chosen part. The caller turns it into a line item the usual way. */
  onAdd: (part: PickedPart) => void
}

export default function AddPartToWorkOrder({ unit, markupPercent, onAdd }: Props) {
  const [open, setOpen] = useState(false)
  const [added, setAdded] = useState<string[]>([])

  const hasUnit = !!unit.model?.trim()

  if (!open) {
    return (
      <div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="px-4 py-2 rounded-lg border border-dark-border text-white/70 hover:text-white hover:border-white/30 text-sm font-medium transition-colors"
        >
          Find a part for this unit
        </button>
        {!hasUnit && (
          <p className="text-white/35 text-xs mt-2">
            No unit model is recorded on this work order, so the list cannot be filtered
            to it. Record the unit first, or search the whole catalog.
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="border border-dark-border rounded-xl p-4 bg-dark/40">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-condensed font-bold text-white text-sm tracking-wider uppercase">
          Parts for this unit
        </h3>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-white/40 hover:text-white text-sm"
        >
          Close
        </button>
      </div>

      {added.length > 0 && (
        <p className="text-success text-xs mb-3">
          Added: {added.join(', ')}. They are in the line items below - unsaved until you
          save the work order.
        </p>
      )}

      <PartsFinder
        mode="unit"
        // Locked to the job. A technician mid-job should not be able to accidentally
        // search a different unit and add a part that does not fit the one in front of
        // them.
        lockedUnit={hasUnit ? unit : { manufacturer: unit.manufacturer, model: '', serial: null }}
        markupPercent={markupPercent}
        onPick={part => {
          onAdd(part)
          setAdded(a => (a.includes(part.part_number) ? a : [...a, part.part_number]))
        }}
      />
    </div>
  )
}
