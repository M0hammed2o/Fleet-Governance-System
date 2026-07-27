# Facial Verification — Commercial Licensing Verification (Phase 9B)

Required before any recognition/liveness model was added (Phase 9B, per explicit user instruction: "A
software library's licence does not automatically cover its trained model. If unclear, do NOT ship."). Every
claim below was verified against a primary source during this session (npm registry queries, the actual
`LICENSE` file shipped inside the installed package, and Google's own published PDF model cards — not
secondary summaries) and is date-stamped 2026-07-27.

## Verdict

Two on-device libraries, used for two strictly separated purposes, both commercially clear:

| Purpose | Package | Model | License | Status |
|---|---|---|---|---|
| Face detection, 3D landmarks, liveness geometry (never identity) | `@mediapipe/tasks-vision` | BlazeFace (short range) + FaceMesh V2 | Apache-2.0 | Clear — shipping |
| Face recognition descriptor (the one-to-one match embedding) | `@vladmandic/face-api` | `face_recognition_model` (dlib ResNet-34) | MIT (wrapper) + Public domain/CC0 (model weights) | Clear — shipping |

One specific model within the second package is **excluded and never loaded**: face-api.js's own 68-point
facial-landmark/alignment model. See "Explicitly excluded" below — its training-data license does not
permit commercial use.

## 1. `@mediapipe/tasks-vision` — face detection, landmarks, liveness

- **Exact package version:** `0.10.35` (confirmed via `npm view @mediapipe/tasks-vision version` against
  the live npm registry, 2026-07-27).
- **Package license:** `Apache-2.0` (confirmed via `npm view @mediapipe/tasks-vision license`).
- **Publisher:** Google (`google-ai-edge/mediapipe`).

### Model 1: BlazeFace (Short Range) — face detection
- **Model version/date:** dated 2021-06-09 (per its own model card).
- **License:** "LICENSED UNDER: Apache License, Version 2.0" — quoted directly from Google's own published
  model card.
- **Source URL (model card):** `https://storage.googleapis.com/mediapipe-assets/MediaPipe%20BlazeFace%20Model%20Card%20(Short%20Range).pdf`
- **Authors:** Valentin Bazarevsky, Yury Kartynnik, Artsiom Ablavatski (Google).
- **Known limitation, quoted from the model card's own "Out-of-scope applications":** "Any form of
  surveillance or identity recognition is explicitly out of scope and not enabled by this technology." —
  this is exactly why this model is used **only** for detection/geometry in this codebase, never for
  identity matching (that is a separate, unrelated model — see section 2).

### Model 2: FaceMesh V2 — 478 3D landmarks + blendshapes (liveness geometry)
- **Model version/date:** 2022-09-15 (per its own release notes — "retains the same size and architecture
  as the previous version (08/28/2022), but is more accurate... and predicts 10 additional iris
  landmarks").
- **License:** "LICENSED UNDER: Apache License, Version 2.0" — quoted directly from Google's own published
  model card.
- **Source URL (model card):** `https://storage.googleapis.com/mediapipe-assets/Model%20Card%20MediaPipe%20Face%20Mesh%20V2.pdf`
- **Authors:** Geng Yan, Ivan Grishchenko (Google).
- **Runtime model asset URL (fetched by the browser directly from Google's CDN at runtime, never
  bundled/redistributed by this codebase):** `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task`
- **Known limitation, quoted directly from the model card's own "Out-of-scope applications":** "Predicted
  face landmarks do not provide facial recognition or identification and do not store any unique face
  representation." This is an explicit statement from the model's own publisher that it must not be relied
  on for identity — confirms the architectural separation used in this codebase (section 3) is not just a
  design preference but a requirement of this model's own stated scope.
- Additional documented limitation: "not intended for human life-critical decisions" — consistent with
  SECURITY_AND_POPIA.md's existing "the system must never state or imply... a conclusion" principle applied
  to telematics; the same discipline applies here — a liveness/match result informs a human security
  officer's decision, it is not itself the final decision (see 9G).

## 2. `@vladmandic/face-api` — face recognition descriptor (the one-to-one match)

- **Exact package version:** `1.7.15` (confirmed via `npm view @vladmandic/face-api version` against the
  live npm registry, 2026-07-27).
- **Package license:** `MIT` — confirmed two ways: (a) `npm view @vladmandic/face-api license` returns
  `MIT`; (b) the `LICENSE` file actually shipped inside the installed package
  (`node_modules/@vladmandic/face-api/LICENSE`) was read directly and quotes the standard MIT text,
  copyright "Vladimir Mandic."

### Model used: `face_recognition_model` (ResNet-34-like, 128-dimension face descriptor)
- **Exact files and checksums** (computed via `sha256sum` against the actual files shipped inside the
  installed `node_modules/@vladmandic/face-api/model/` directory, 2026-07-27):
  - `face_recognition_model.bin` — SHA-256:
    `b413e420d6840b2775fba32008db6f3cddb07d485967fb42cfcf379c16a8c589`
  - `face_recognition_model-weights_manifest.json` — SHA-256:
    `cbaffa501b0b9275a12b63357a6843e7e30c054e1c9151e1a5f879b26e32986b`
- **Provenance chain (each link verified via a direct source fetch, not a secondary summary):**
  1. `@vladmandic/face-api`'s own README ("Credits" section) states this model is carried forward
     unchanged from the original `face-api.js` project's models
     (`https://github.com/justadudewhohacks/face-api.js-models`).
  2. The original `face-api.js` project's own README states: "a ResNet-34 like architecture... equivalent
     to the FaceRecognizerNet used in face-recognition.js and the net used in the dlib face recognition
     example... The weights have been trained by davisking" (Davis King, dlib's author).
  3. Davis King's own `dlib-models` repository (the canonical, primary source for this exact model —
     `dlib_face_recognition_resnet_model_v1`) states, quoted directly: **"As far as I am concerned, anyone
     can do whatever they want with these model files as I've released them into the public domain."**
     Source: `https://github.com/davisking/dlib-models`.
- **License of the model weights:** public domain / CC0-equivalent, per the model author's own explicit,
  direct statement above — commercial use, modification, and redistribution are all permitted with no
  restriction.
- **Known limitation:** `@vladmandic/face-api`'s own GitHub repository is **archived** (read-only, as of
  around February 2025) — the author has stated it is "completely superseded" by his newer `Human` library
  and will receive no further updates. The MIT license and the CC0-equivalent model weights remain fully
  valid and usable regardless of archival status, but no future security patches or TensorFlow.js
  compatibility updates will come from this exact package. This is disclosed as an operational risk for a
  production pilot (TODO.md), not a licensing blocker — the license itself does not expire or change based
  on repository activity. `Human` (the recommended successor) was evaluated and explicitly **not** chosen
  for the recognition model specifically because its bundled face-embedding model (MobileFaceNet) is
  documented as carrying licensing "inherited from the original model sources" on a per-model basis, which
  could not be verified as clearly commercially permitted within this session — see "Explicitly excluded"
  below for why that same caution applies there too.

## Explicitly excluded — do not load these models

- **face-api.js's own 68-point facial-landmark/alignment model** (`face_landmark_68`, and by extension the
  face-api.js face-detection models `ssd_mobilenetv1`/`tiny_face_detector`, which are not evaluated at all
  since they are unused — MediaPipe's BlazeFace, section 1, is used for detection instead). The classic
  dlib model this is derived from, `shape_predictor_68_face_landmarks.dat`, was trained on the iBUG 300-W
  dataset. Quoted directly from Davis King's own `dlib-models` repository: **"The license for this dataset
  excludes commercial use and Stefanos Zafeiriou, one of the creators of the dataset, asked me to include a
  note here saying that the trained model therefore can't be used in a commercial product."** This model
  is never imported, loaded, referenced, or shipped anywhere in this codebase. face-api.js's own
  `detectFaceLandmarks()`/alignment step is skipped entirely; the face descriptor (section 2) is instead
  computed directly from the face crop MediaPipe's BlazeFace already located, at a documented accuracy
  trade-off (face-api.js's own documentation notes skipping alignment "results in less stable accuracy" —
  disclosed in ARCHITECTURE.md/TODO.md as a known trade-off, not a silent gap).
- **`@vladmandic/human`'s MobileFaceNet embedding model** — considered as the actively-maintained
  alternative to `@vladmandic/face-api`, but its own documentation states bundled models carry licenses
  "inherited from the original model sources" evaluated per-model, and the specific MobileFaceNet weights'
  original training-data license could not be confirmed as commercially clear within this session. Per the
  user's explicit instruction ("if unclear, do not ship"), this is documented as a **blocker**, not used —
  revisit only if a future session can trace MobileFaceNet's exact training-data license to an
  unambiguous, commercially-permitted primary source the way section 2 traces the dlib model above.

## No paid/cloud account created

No AWS, Azure, GCP biometric API, or any other paid cloud facial-recognition/liveness vendor account was
created or configured anywhere in this work. `CloudLivenessProvider` (Phase 9F) is an interface plus a dev
mock only — see INTEGRATIONS.md.

## Redistribution note

Both models are bundled/redistributed differently: MediaPipe's `.task` model file is fetched by the
browser directly from Google's own CDN at runtime (`storage.googleapis.com`) and is never copied into or
redistributed by this repository. `@vladmandic/face-api`'s model files are installed as part of the npm
package into `node_modules/` (standard npm dependency resolution, not a manual copy into this repository's
own tracked source) — its CC0-equivalent license explicitly permits this regardless.
