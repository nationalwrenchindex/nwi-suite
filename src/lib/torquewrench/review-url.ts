export function buildGoogleReviewUrl(googlePlaceId: string): string {
  return `https://search.google.com/local/writereview?placeid=${googlePlaceId}`
}
