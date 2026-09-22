# Nut AI code adaptation — license notice

Parts of Ascend's nutrition engine in this directory are adapted from
**Nut AI** (https://github.com/Blueturboguy07/nut-ai), Copyright (C) 2026
Mann Bellani.

The Nut AI source code is licensed under the **GNU Affero General Public
License v3.0 or later (AGPL-3.0-or-later)**. The Ascend engine modules in
this directory (`clamp.js`, `gramEngine.js`, `totals.js`, `confidence.js`,
`resolver.js`, `repair.js`) are ports of Nut AI's packages `@nutai/clamp`,
`@nutai/gram-engine`, `@nutai/totals`, `@nutai/confidence`,
`@nutai/resolver` and `@nutai/repair`, and therefore carry the same license.

## What was adapted

| Nut AI package | Ascend file | Notes |
|---|---|---|
| `@nutai/core-schema` | `schema.js` | VisionPayload / Item / IngredientRow / LoggedMeal domain model, translated from Zod to plain-JS validation |
| `@nutai/clamp` | `clamp.js` | Deterministic sanity clamp, verbatim logic |
| `@nutai/gram-engine` | `gramEngine.js` | 6-tier reconciliation ladder, bands, density, volume, yields/oil absorption, personal priors |
| `@nutai/totals` | `totals.js` | Per-100g snapshot arithmetic, Atwater reconciliation, dual display-rounding regimes |
| `@nutai/confidence` | `confidence.js` | Measured per-pathway uncertainty bands, meal-band quadrature |
| `@nutai/resolver` | `resolver.js` | Match ladder, 6-signal candidate scoring, auto-accept rule (SQLite FTS5 replaced with MongoDB text search) |
| `@nutai/repair` | `repair.js` | Expected-value question gating and the ranked question bank |

Expo/React Native specific code (apps/mobile, expo-sqlite db adapter) was
NOT ported: Ascend is a React/Vite + Express + MongoDB web application.

## Your obligations when redistributing Ascend

Because this code is AGPL-3.0, the combined Ascend work that exposes these
modules over a network must be distributed under AGPL-3.0-or-later, with
source available to network users. Keep this file intact.

The bundled nutrition **data** is separate from this code license — see
`THIRD-PARTY-DATA.md`.
