/**
 * English-only prompts for VLM (Ollama vision). No I/O.
 */

export const ANCHOR_GATE_JSON_INSTRUCTION = `You are a strict image reviewer for a character reference library.
You will receive ONE photo. Decide if it is suitable as the ANCHOR (first) reference image for the same real person later.

Output ONLY valid JSON (no markdown) with exactly these keys:
{
  "accepted": boolean,
  "messageZh": string,
  "faceVisible": boolean,
  "qualityOk": boolean,
  "qualityScore": number,
  "issuesEn": string[]
}

Rules:
- "messageZh": Traditional Chinese, one short sentence telling the user what to do next if rejected; neutral tone.
- "qualityScore": 0.0 to 1.0 (sharpness, lighting, resolution usefulness).
- "issuesEn": short English phrases (empty if none), e.g. "no_face", "multiple_faces", "too_blurry", "heavy_filter", "extreme_profile_only", "very_dark".
- Set "accepted" true only if a single main human face is clearly visible and quality is adequate for identity reference.

User content is the image (no separate text).`

export const IDENTITY_GATE_JSON_INSTRUCTION = `You compare TWO face photos: IMAGE 1 is the ANCHOR reference; IMAGE 2 is a NEW candidate to add to the same character library.
Decide if IMAGE 2 shows the SAME real person as IMAGE 1 (allow clothing, pose, age makeup, lighting changes). Reject if it is likely a different person or identity mismatch.

Output ONLY valid JSON (no markdown) with exactly these keys:
{
  "accepted": boolean,
  "messageZh": string,
  "samePersonLikely": boolean,
  "gapTooLarge": boolean,
  "reasonsEn": string[]
}

Rules:
- "messageZh": Traditional Chinese, one short sentence; if rejected, say what to try (e.g. use a clearer front photo of the same person).
- "gapTooLarge" true if same person is unlikely OR the visual gap is too large to safely merge (e.g. different person, or anchor/candidate inconsistent identity).
- "accepted" true only if samePersonLikely is true AND gapTooLarge is false.
- "reasonsEn": short English phrases (may be empty if accepted).

Image order: first image = anchor, second image = candidate.`

export const PROFILE_REFRESH_JSON_INSTRUCTION = `You are given up to SIX reference photos of the SAME person (anchor first, then additional angles).
Produce a consolidated machine-readable profile for future image generation pipelines, plus a short human summary in Traditional Chinese.

Output ONLY valid JSON (no markdown) with exactly these keys:
{
  "profileEn": object,
  "summaryZh": string
}

Rules:
- "profileEn": nested plain JSON object (no markdown). Use English keys and English string values where possible, e.g. approximateAgeRange, genderPresentation, hair, skinTone, faceShape, eyes, nose, mouth, facialHair, distinguishingMarks, typicalClothing, notes.
- "summaryZh": 1-2 short sentences in Traditional Chinese for the user (no jargon).
- If fewer than six images, use what is present. If images conflict, prefer the clearest front-facing views.`
