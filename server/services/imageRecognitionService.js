// ------------------------------------------------------------
// Image recognition provider abstraction for the photo meal scanner.
//
// DESIGN: the UI calls POST /api/nutrition/analyze-photo. This service is
// the ONLY place that knows how a photo becomes food estimates. Today no
// provider is configured (FatSecret image recognition is Premier-exclusive
// per the official docs), so `analyzePhoto` reports NOT_CONFIGURED and the
// UI shows an honest unavailable state.
//
// To plug a provider in later (FatSecret Premier, or any vision API):
//   1. Implement `analyzePhoto(imageBuffer, mimeType)` below, returning
//      { items: [{ name, grams?, servingDescription?, estimated, foodId? }] }
//      where foodId is a FatSecret food_id when the provider returns one
//      (enabling exact nutrients); without one the route resolves nutrients
//      by searching FatSecret for the item name.
//   2. Set NUTRITION_PHOTO_ENABLED=true — capabilities() then reports photo
//      as available and the UI unlocks the scanner.
//
// Privacy contract: image bytes stay in-memory for the duration of one
// request and are NEVER persisted (no MongoDB blobs, no disk writes).
// ------------------------------------------------------------

function photoEnabled() {
    return process.env.NUTRITION_PHOTO_ENABLED === "true";
}

// Returns { items: [...] } or throws with err.code:
//   NOT_CONFIGURED — no provider is wired up yet
//   BAD_INPUT      — image failed validation (handled in the route)
//   PROVIDER_ERROR — the upstream provider failed
async function analyzePhoto(imageBuffer, mimeType) {
    if (!photoEnabled()) {
        const err = new Error(
            "Photo analysis isn't available with the current nutrition provider configuration."
        );
        err.code = "NOT_CONFIGURED";
        throw err;
    }
    // Provider implementation goes here. Intentionally NOT fabricated:
    // without a real vision provider there is no honest way to return
    // detected foods, so we throw instead of inventing results.
    const err = new Error("No image recognition provider is configured");
    err.code = "NOT_CONFIGURED";
    throw err;
}

module.exports = { analyzePhoto, photoEnabled };
