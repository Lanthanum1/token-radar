// Token Radar — valuation model and board builder (token-radar-01).
//
// Everything on the board is derived from the sealed snapshot's own figures.
// A protocol is pre-token when its record carries no token: mcap_usd, gecko_id
// and symbol are all null. Live-token protocols are never ranked; they are
// kept apart as the market's own reference set, and they are also the source
// of the category multiples below, so no protocol name is ever special-cased.
//
// Implied value (one formula, every row):
//   catMult   = median mcap/TVL of LIVE protocols in the same category
//               (n >= 3, clamped to [0.08, 0.65]; otherwise the all-live
//               median, same clamp) — computed from this snapshot at run time
//   growthMult= 1 + clamp(change_7d, -50, +100) * 0.006
//   maturity  = 0.75 + min(age_days, 1095) / 1095 * 0.45   (age unknown: 365)
//   chainMult = 1 + min(chains - 1, 5) * 0.03
//   tierMult  = 1.0 for rule-clean rows, 0.5 for rows the watchlist rule
//               excludes (wrapped / staked / bridged / versioned products)
//   implied   = round(tvl_usd * catMult * growthMult * maturity * chainMult
//                     * tierMult), at least $1
//
// Board shape: the 40 watchlist slugs first (the floor), then every other
// rule-clean pre-token protocol below the floor, then — because rule-clean
// pre-token rows only reach 178 — the largest remaining pre-token protocols
// that the watchlist rule excludes, each flagged and discounted, so the board
// reaches 240 rows without ever ranking a protocol that records a token.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  chain_step: number;
  chain_cap: number;
  multiple_floor: number;
  multiple_cap: number;
  excluded_tier: number;
  min_live_for_category: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.006,
  growth_floor: -50,
  growth_cap: 100,
  maturity_floor: 0.75,
  maturity_range: 0.45,
  maturity_days: 1095,
  unknown_age_days: 365,
  chain_step: 0.03,
  chain_cap: 5,
  multiple_floor: 0.08,
  multiple_cap: 0.65,
  excluded_tier: 0.5,
  min_live_for_category: 3,
};

export const MODEL_VERSION = 'radar-2';
export const BOARD_ROWS = 240;
export const LIVE_ROWS = 24;

export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  watchlist: boolean;
  rule_clean: boolean;
  exclusion_note: string | null;
  age_days: number | null;
  implied_value_usd: number;
  model: {
    category_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    chain_multiplier: number;
    tier_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  watchlist: boolean;
  rule_clean: boolean;
  exclusion_note: string | null;
  category_multiple: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  chain_multiplier: number;
  tier_multiplier: number;
  farm_steps: string[];
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  excluded_size: number;
  live_size: number;
  category_multiples: { category: string; multiple: number; live_count: number }[];
  overall_multiple: number;
  rows: RadarRow[];
  live: LiveRow[];
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Why the watchlist rule leaves a pre-token protocol out, or null when it is rule-clean. */
export function exclusionReason(p: SnapshotProtocol): string | null {
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return `category ${p.category} is a wrapped, staked, bridged or exchange product, not a standalone launch`;
  if (VERSIONED.test(p.name)) return 'name ends in a version marker, so it is a pool of another protocol';
  if (WRAPPED_WORD.test(p.name)) return 'name carries wrapped, staked or staking, so it is a product of a token that already trades';
  if (EXCHANGE_PREFIX.test(p.name)) return 'name begins with an exchange name, so it is an exchange product';
  return null;
}

export function isRuleClean(p: SnapshotProtocol): boolean {
  return isPreToken(p) && exclusionReason(p) === null;
}

/** Category multiples from the live set: median mcap/TVL per category. */
export function categoryMultiples(snapshot: Snapshot, model: ModelConstants): { byCategory: Map<string, number>; overall: number; table: { category: string; multiple: number; live_count: number }[] } {
  const live = snapshot.protocols.filter((p) => !isPreToken(p) && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  const overall = clamp(median(live.map((p) => p.mcap_usd! / p.tvl_usd)), model.multiple_floor, model.multiple_cap);
  const groups = new Map<string, number[]>();
  for (const p of live) {
    const c = p.category ?? 'Uncategorised';
    const arr = groups.get(c) ?? [];
    arr.push(p.mcap_usd! / p.tvl_usd);
    groups.set(c, arr);
  }
  const byCategory = new Map<string, number>();
  const table: { category: string; multiple: number; live_count: number }[] = [];
  for (const [c, vals] of [...groups.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const m = vals.length >= model.min_live_for_category ? clamp(median(vals), model.multiple_floor, model.multiple_cap) : overall;
    byCategory.set(c, m);
    table.push({ category: c, multiple: round4(m), live_count: vals.length });
  }
  return { byCategory, overall, table };
}

export function impliedValue(
  p: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
  catMult: number,
  tierMult: number,
): { implied: number; growthPct: number; growthMult: number; maturityMult: number; chainMult: number; age: number | null } {
  const age = ageDays(asOf, p.listed_at);
  const growthPct = clamp(finite(p.change_7d, 0), model.growth_floor, model.growth_cap);
  const growthMult = 1 + (growthPct / 100) * (model.growth_weight * 100);
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const chainMult = 1 + Math.min(Math.max(p.chains.length - 1, 0), model.chain_cap) * model.chain_step;
  const implied = Math.max(1, Math.round(p.tvl_usd * catMult * growthMult * maturityMult * chainMult * tierMult));
  return { implied, growthPct, growthMult, maturityMult, chainMult, age };
}

function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

function money(n: number): string {
  return `$${n.toLocaleString('en-US')}`;
}

function fmtUsd(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  return money(Math.round(n));
}

function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 250;
  if (p.tvl_usd >= 100_000_000) return 150;
  if (p.tvl_usd >= 50_000_000) return 100;
  return 50;
}

function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

function gasFor(p: SnapshotProtocol): { tx: string; weekly: string } {
  const main = chainOf(p);
  if (main === 'Ethereum') return { tx: 'about $6 of gas', weekly: 'about $6 of gas a week' };
  if (main === 'Bitcoin') return { tx: 'about $2 of network fees', weekly: 'about $2 of fees a week' };
  return { tx: 'about $1 of gas', weekly: 'about $1 of gas a week' };
}

export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The category's core action, written with the protocol's own name, chain and capital. */
function coreAction(p: SnapshotProtocol, capital: number, chain: string): { action: string; second: string } {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  const cap = money(capital);
  if (c.includes('dex')) return {
    action: `Provide ${cap} of liquidity to ${name}'s deepest pool on ${chain} — pick the pair with the most TVL, set a narrow range if it is concentrated liquidity, and keep the position open`,
    second: `Swap ${money(25)} through ${name} on ${chain} once a week, routing a real trade you would make anyway, so the wallet shows swap volume as well as liquidity`,
  };
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return {
    action: `Supply ${cap} of USDC to ${name} on ${chain} as a lender and leave it earning; do not borrow against it in the first week`,
    second: `After a week, borrow ${money(20)} of a stablecoin against the deposit and repay it within 48 hours, so the wallet shows both sides of the market`,
  };
  if (c.includes('perp') || c.includes('derivative') || c.includes('basis')) return {
    action: `Deposit ${cap} of USDC as margin on ${name} on ${chain} and open one small hedged position worth no more than ${money(50)} notional`,
    second: `Close and reopen a small position once a week, keeping total notional under ${money(50)} and never leaving a leveraged position open overnight unhedged`,
  };
  if (c.includes('restak') || c.includes('staking')) return {
    action: `Stake ${cap} of the chain's staking asset through ${name} on ${chain} and keep the receipt token in the same wallet`,
    second: `Restake or delegate the receipt once more in week two, so the wallet shows a second staking action rather than a single deposit`,
  };
  if (c.includes('yield') || c.includes('curator') || c.includes('allocator') || c.includes('risk')) return {
    action: `Deposit ${cap} into a ${name} vault on ${chain} — pick the vault with the largest TVL — and keep the vault shares in the farming wallet`,
    second: `Move ${money(25)} between two of ${name}'s vaults in week two, so the wallet shows allocation activity and not just one deposit`,
  };
  if (c.includes('rwa')) return {
    action: `Mint ${cap} of ${name}'s yield-bearing asset on ${chain} after passing any eligibility check it publishes, and hold it in the farming wallet`,
    second: `Claim or reinvest the asset's first yield distribution instead of selling it, so the wallet shows a claim transaction`,
  };
  if (c.includes('stable')) return {
    action: `Mint or deposit ${cap} of the stable asset through ${name} on ${chain} and hold it rather than swapping it away the same day`,
    second: `Use ${money(25)} of the stable asset in one real payment or deposit on ${chain} in week two, so the wallet shows the asset circulating`,
  };
  if (c.includes('bridge') || c.includes('canonical')) return {
    action: `Bridge ${cap} of USDC into ${chain} through ${name} and use the bridged funds inside an app on the destination chain the same week`,
    second: `Bridge ${money(25)} back or onward through ${name} in week two, so the wallet shows repeat bridge volume in both directions`,
  };
  if (c.includes('payment')) return {
    action: `Fund ${cap} into ${name} on ${chain} and make one real payment or card load from it in the first week`,
    second: `Make a second payment of at least ${money(10)} through ${name} in week two, so the wallet shows repeat payment activity`,
  };
  if (c.includes('insurance')) return {
    action: `Buy ${cap} of cover from ${name} on ${chain} for a position you actually hold, and keep the policy for its full term`,
    second: `File no claim unless a covered event happens; instead, renew or extend the cover once, so the wallet shows a second underwriting action`,
  };
  if (c.includes('chain')) return {
    action: `Bridge ${cap} of USDC to ${name}'s chain and deploy it in the chain's largest native app, keeping the funds on-chain`,
    second: `Make one transaction a week on ${name}'s chain — a swap, a stake or a vote — so the wallet shows sustained on-chain activity`,
  };
  return {
    action: `Deposit ${cap} of USDC into ${name} on ${chain} through its main app and keep the position open`,
    second: `Repeat one qualifying action inside ${name} each week — a deposit, a swap or a vote — so the wallet shows activity across several weeks`,
  };
}

/**
 * Seven farm steps, each with a cost and a time, built from the protocol's
 * own record (category, main chain, TVL tier, age). Excluded-rule rows get a
 * warning step first: the launch, if any, may belong to the underlying token.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null, ruleClean: boolean, exclusionNote: string | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = gasFor(p);
  const core = coreAction(p, capital, chain);
  const tvl = fmtUsd(p.tvl_usd);
  const steps: FarmStep[] = [];
  if (!ruleClean) {
    steps.push({
      text: `Read the warning first: ${p.name} is flagged because ${exclusionNote ?? 'the watchlist rule excludes it'}. Any token may belong to the underlying asset, so farm with a smaller stake and treat points here as a bonus, not the main bet`,
      cost: 'nothing to read, and it saves the whole stake if you skip it',
      time: '5 minutes',
    });
  }
  steps.push(
    {
      text: `Use a fresh wallet that holds only the ${money(capital)} you plan to farm with on ${chain}, and keep its seed phrase offline on paper, never in a screenshot or a chat`,
      cost: `${gas.tx} for the first transaction`,
      time: '5 minutes',
    },
    {
      text: `${core.action}. ${p.name} holds ${tvl} of TVL, so a ${money(capital)} position is small enough to exit but large enough to register`,
      cost: `${money(capital)} of capital and ${gas.tx}`,
      time: '15 minutes to set up',
    },
    {
      text: core.second,
      cost: gas.weekly,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot; ${p.name} has been tracked for ${age === null ? 'an unknown time' : `${age} days`}, so a short stay is the easiest way to be filtered out`,
      cost: `the ${money(capital)} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Once a week, open ${p.name}'s own points or rewards page from its app and check the wallet is credited; never connect the wallet to a link from a chat, a search ad or a direct message`,
      cost: 'no fee to check',
      time: '10 minutes a week',
    },
    {
      text: `When you are done, withdraw in two parts a day apart, keep ${money(10)} of gas on ${chain} for the exit, and record the wallet, the dates and every transaction hash in a farm log`,
      cost: `${gas.tx} per withdrawal`,
      time: '10 minutes',
    },
  );
  return steps.slice(0, 7);
}

export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({ slug: p.slug, name: p.name, category: p.category, chains: p.chains, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd, change_7d: p.change_7d }));
}

export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const watchSet = new Set(snapshot.watchlist);
  const { byCategory, overall } = categoryMultiples(snapshot, model);
  const chosen = new Map<string, { p: SnapshotProtocol; clean: boolean; note: string | null }>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, { p, clean: true, note: null });
  }
  const cleanEarly = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRuleClean(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1));
  for (const p of cleanEarly) chosen.set(p.slug, { p, clean: true, note: null });
  const need = BOARD_ROWS - chosen.size;
  if (need > 0) {
    const excluded = snapshot.protocols
      .filter((p) => !chosen.has(p.slug) && isPreToken(p) && p.tvl_usd < snapshot.floor_usd)
      .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1))
      .slice(0, need);
    for (const p of excluded) chosen.set(p.slug, { p, clean: false, note: exclusionReason(p) });
  }
  const scored = [...chosen.values()].map(({ p, clean, note }) => {
    const catMult = byCategory.get(p.category ?? 'Uncategorised') ?? overall;
    const tier = clean ? 1 : model.excluded_tier;
    const v = impliedValue(p, snapshot.as_of, model, catMult, tier);
    return { p, clean, note, catMult, tier, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : 1));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    watchlist: watchSet.has(s.p.slug),
    rule_clean: s.clean,
    exclusion_note: s.note,
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      category_multiple: round4(s.catMult),
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      chain_multiplier: round4(s.chainMult),
      tier_multiplier: s.tier,
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age, s.clean, s.note).map(stepText),
  }));
}

export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const { overall, table } = categoryMultiples(snapshot, model);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((r) => !snapshot.watchlist.includes(r.slug) && r.rule_clean).length,
    excluded_size: board.filter((r) => !r.rule_clean).length,
    live_size: live.length,
    category_multiples: table,
    overall_multiple: round4(overall),
    rows: board.map((r) => ({
      rank: r.rank,
      slug: r.slug,
      name: r.name,
      category: r.category,
      chains: r.chains,
      tvl_usd: r.tvl_usd,
      change_7d: r.change_7d,
      listed_at: r.listed_at,
      age_days: r.age_days,
      implied_value_usd: r.implied_value_usd,
      watchlist: r.watchlist,
      rule_clean: r.rule_clean,
      exclusion_note: r.exclusion_note,
      category_multiple: r.model.category_multiple,
      growth_multiplier: r.model.growth_multiplier,
      maturity_multiplier: r.model.maturity_multiplier,
      chain_multiplier: r.model.chain_multiplier,
      tier_multiplier: r.model.tier_multiplier,
      farm_steps: r.farm_steps,
    })),
    live,
  };
  return { board, radar };
}

export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board holds ${board.length} rows, outside 100..4000`;
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  const sorted = [...board].sort((a, b) => a.rank - b.rank);
  for (let i = 1; i < sorted.length; i++) if (sorted[i]!.implied_value_usd > sorted[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) return 'all rows share the same implied value';
  for (const r of board) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) if (s.trim().length < 20 || s.trim().length > 600) return `${r.slug} has a farm step of ${s.trim().length} characters`;
  }
  return null;
}

export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
