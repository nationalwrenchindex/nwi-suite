'use client'

// The new-quote screen. The form itself is shared with /hd/quotes/[id]/edit - one
// form for both, so a saved draft or sent quote edits in exactly the screen that made it.
import QuoteForm from '../QuoteForm'

export default function NewQuotePage() {
  return <QuoteForm />
}
