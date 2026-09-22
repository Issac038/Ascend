# Nutrition corpus — data sources and licenses

Ascend's nutrition corpus is built **exclusively from USDA FoodData Central
sources, which are released as CC0 1.0 (public domain)**. No Open Food Facts
(ODbL share-alike) data is included, which keeps this corpus free of
share-alike obligations. No restricted datasets (India IFCT, China CFCT,
Netherlands NEVO, Italy CREA) are used.

| Source | Release | License | Rows used |
|---|---|---|---|
| USDA FDC — Survey (FNDDS) 2021-2023 | 2024-10-31 | CC0 1.0 | foods, portions, nutrients (~5.4k foods, ~22k portions) |
| USDA FDC — SR Legacy | 2018-04 | CC0 1.0 | foods, portions, nutrients (~7.8k foods) |
| USDA FDC — Foundation Foods | 2026-04-30 | CC0 1.0 | foods, portions, nutrients |

USDA citation (requested courtesy attribution, not legally required):
U.S. Department of Agriculture, Agricultural Research Service. FoodData
Central, https://fdc.nal.usda.gov/ — Foundation Foods (April 2026), SR
Legacy (April 2018), and FNDDS Survey Foods (October 2024) releases.

Density, cooking-yield, oil-absorption, container-volume and reference-object
tables ported from Nut AI are hand-authored constants licensed with the Nut AI
code (AGPL-3.0) — see `LICENSE-NUTAI.md`. The USDA Table of Cooking Yields for
Meat and Poultry (Showell et al., 2012) figures embedded there are US
government works (public domain).

Indian foods: India's IFCT dataset is explicitly restricted and is NOT
bundled. Generic Indian dishes present in USDA sources (e.g. "rice, biryani"
entries in FNDDS composite categories) are searchable through the normal
resolver like any other food.
