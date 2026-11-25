# token-radar

[![token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Lanthanum1/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Lanthanum1/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01)

Token Radar ranks the 240 pre-token protocols in a sealed DefiLlama snapshot by what a token launch would be worth, and gives each one a concrete farm plan with costs and times.

## Model

Implied value = TVL × category multiple × growth × maturity × chains × tier. The category multiple is the median market-cap / TVL of the live-token protocols in the same category, computed from the snapshot at run time — no protocol name is ever special-cased. Protocols whose token already trades are never ranked; they are shown separately as a reference, because their market ratios are what the multiples come from. Rows the watchlist rule excludes (wrapped, staked, bridged or versioned products) are flagged and halved, never hidden.

## Run

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to>/snapshot.json
```

Node 22 or later, standard library only. The program writes `out/board.json`, `out/data.js`, `out/dashboard/`, `out/screenshots/` and `out/dossier.json`. Two runs on the same snapshot write identical bytes. Open `out/dashboard/index.html` in a browser (it needs `data.js` beside it) — or `dashboard/index.html` after a run, with the generated `data.js` next to it.

## Layout

- `main.ts` — entrypoint: reads the snapshot, writes the board, data, dashboard, screenshots and dossier.
- `lib/model.ts` — the valuation model, board builder and farm-plan generator.
- `vendor/makefun-board.ts` — make.fun's dossier library, as shipped in the kit.
- `dashboard/` — the static page (no network): sortable/filterable board, per-protocol detail view, live-token reference.
- `screenshots/` — the board, a protocol detail and a filtered view, rendered from this dashboard.

---

Built for the [token-radar-01 bounty](https://make.fun/bounty/token-radar-01) on make.fun. If you enter too, use referral code `3w2f5hhg`.
