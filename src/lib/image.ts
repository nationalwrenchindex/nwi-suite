// ─── Client-side image downscaling ───────────────────────────────────────────
// BROWSER ONLY — uses canvas and URL.createObjectURL.
//
// A phone camera photo is 3-6 MB, and a tech documenting a job takes several per
// work order over a cellular connection in a yard. Downscaling before upload is
// the difference between a photo that lands and one that times out.
//
// NOTE: near-identical copies already live in components/booking/BookingClient
// and app/hd/work-orders/[id]/WorkOrderDetail. This is the shared version for new
// callers; those two are left alone rather than refactored as a side effect of an
// unrelated feature.

export async function compressImage(
  file:    File,
  maxPx:   number = 1600,
  quality: number = 0.75,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)

    img.onload = () => {
      // Revoked in both paths: a work order with a dozen photos would otherwise
      // hold every original in memory for the life of the page.
      URL.revokeObjectURL(url)

      let { width, height } = img
      if (width > maxPx || height > maxPx) {
        const ratio = Math.min(maxPx / width, maxPx / height)
        width  = Math.round(width  * ratio)
        height = Math.round(height * ratio)
      }

      const canvas = document.createElement('canvas')
      canvas.width  = width
      canvas.height = height

      const ctx = canvas.getContext('2d')
      if (!ctx) { reject(new Error('Canvas not available')); return }
      ctx.drawImage(img, 0, 0, width, height)

      canvas.toBlob(
        blob => blob ? resolve(blob) : reject(new Error('Could not process that image')),
        'image/jpeg',
        quality,
      )
    }

    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Could not read that image'))
    }
    img.src = url
  })
}
