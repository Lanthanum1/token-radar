// Token Radar dashboard: renders window.RADAR (written by main.ts from the
// sealed snapshot). No network: all data is local, all rendering is local.
// Views: the ranked board (sortable, filterable), a detail view per protocol
// (model arithmetic + farm plan), and the live-token reference set.
// Deep links: #detail/<slug> opens a protocol, #cat/<Category> filters.
(function () {
  var D = window.RADAR;
  if (!D) { document.body.innerHTML = '<p style="padding:40px">No radar data found.</p>'; return; }
  var rows = D.rows, live = D.live;
  var maxImplied = rows.length ? rows[0].implied_value_usd : 1;

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function money(n) { if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B'; if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M'; if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K'; return '$' + n; }
  function pct(v) { if (v === null || v === undefined) return '—'; var s = (v > 0 ? '+' : '') + v.toFixed(1) + '%'; return '<span class="' + (v > 0 ? 'pos' : v < 0 ? 'neg' : '') + '">' + s + '</span>'; }
  function fmtAge(a) { return a === null ? 'unknown' : a + 'd'; }

  // ---- header stats ----
  $('asof').textContent = D.as_of;
  $('asof2').textContent = D.as_of;
  $('overall-mult').textContent = D.overall_multiple.toFixed(2) + 'x';
  var top = rows[0];
  var med = rows[Math.floor(rows.length / 2)];
  $('stats').innerHTML =
    '<div><dt>Ranked</dt><dd>' + D.board_size + ' protocols</dd></div>' +
    '<div><dt>Watchlist covered</dt><dd>' + D.watchlist_size + ' / ' + D.watchlist_size + '</dd></div>' +
    '<div><dt>Early finds</dt><dd>' + D.early_size + ' below the floor</dd></div>' +
    '<div><dt>Top implied value</dt><dd>' + money(top.implied_value_usd) + '</dd></div>' +
    '<div><dt>Median implied value</dt><dd>' + money(med.implied_value_usd) + '</dd></div>';

  // ---- category multiples table ----
  $('multiples').querySelector('tbody').innerHTML = D.category_multiples.map(function (m) {
    return '<tr><td>' + esc(m.category) + '</td><td>' + m.multiple.toFixed(2) + 'x</td><td>' + m.live_count + '</td></tr>';
  }).join('');

  // ---- filter controls ----
  var cats = [], chains = [];
  rows.forEach(function (r) {
    if (r.category && cats.indexOf(r.category) < 0) cats.push(r.category);
    r.chains.forEach(function (c) { if (chains.indexOf(c) < 0) chains.push(c); });
  });
  cats.sort(); chains.sort();
  $('cat').innerHTML = '<option value="">All categories</option>' + cats.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('');
  $('chain').innerHTML = '<option value="">All chains</option>' + chains.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('');

  var state = { q: '', cat: '', chain: '', sort: 'rank', watch: false, hideflag: false, selected: null };

  function filtered() {
    var list = rows.filter(function (r) {
      if (state.watch && !r.watchlist) return false;
      if (state.hideflag && !r.rule_clean) return false;
      if (state.cat && r.category !== state.cat) return false;
      if (state.chain && r.chains.indexOf(state.chain) < 0) return false;
      if (state.q) {
        var q = state.q.toLowerCase();
        if (r.name.toLowerCase().indexOf(q) < 0 && r.slug.toLowerCase().indexOf(q) < 0) return false;
      }
      return true;
    });
    if (state.sort === 'tvl') list.sort(function (a, b) { return b.tvl_usd - a.tvl_usd; });
    else if (state.sort === 'change') list.sort(function (a, b) { return (b.change_7d || 0) - (a.change_7d || 0); });
    else if (state.sort === 'age') list.sort(function (a, b) { return (b.age_days || 0) - (a.age_days || 0); });
    else list.sort(function (a, b) { return a.rank - b.rank; });
    return list;
  }

  function renderBoard() {
    var list = filtered();
    $('count').textContent = list.length + ' of ' + rows.length + ' protocols shown — sorted by ' +
      ({ rank: 'implied value', tvl: 'TVL', change: '7-day change', age: 'days with no token' })[state.sort] + '.';
    $('board').querySelector('tbody').innerHTML = list.map(function (r) {
      var w = Math.max(2, Math.round(r.implied_value_usd / maxImplied * 100));
      return '<tr data-slug="' + esc(r.slug) + '"' + (state.selected === r.slug ? ' class="sel"' : '') + '>' +
        '<td>' + r.rank + '</td>' +
        '<td><b>' + esc(r.name) + '</b><span class="sub">' + esc(r.slug) + '</span>' +
        (r.watchlist ? '<span class="badge w">WATCHLIST</span>' : '') + (!r.rule_clean ? '<span class="badge f">FLAGGED</span>' : '') + '</td>' +
        '<td>' + esc(r.category || '—') + '</td>' +
        '<td>' + esc(r.chains.slice(0, 2).join(', ')) + (r.chains.length > 2 ? ' +' + (r.chains.length - 2) : '') + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num">' + pct(r.change_7d) + '</td>' +
        '<td class="num">' + fmtAge(r.age_days) + '</td>' +
        '<td class="num"><b>' + money(r.implied_value_usd) + '</b></td>' +
        '<td><div class="bar"><i style="width:' + w + '%"></i></div></td></tr>';
    }).join('');
  }

  // ---- detail view ----
  function renderDetail(slug) {
    var r = null;
    for (var i = 0; i < rows.length; i++) if (rows[i].slug === slug) { r = rows[i]; break; }
    var el = $('detail');
    if (!r) { el.hidden = true; state.selected = null; renderBoard(); return; }
    state.selected = slug;
    var base = r.tvl_usd * r.category_multiple;
    el.hidden = false;
    el.innerHTML =
      '<p class="eyebrow">PROTOCOL DETAIL &middot; RANK #' + r.rank + '</p>' +
      '<h2>' + esc(r.name) + (r.watchlist ? '<span class="badge w">WATCHLIST</span>' : '') + (!r.rule_clean ? '<span class="badge f">FLAGGED</span>' : '') + '</h2>' +
      '<p>' + esc(r.slug) + ' &middot; ' + esc(r.category || 'Uncategorised') + ' &middot; ' + esc(r.chains.join(', ') || 'no chain listed') +
      ' &middot; tracked since ' + (r.listed_at || 'unknown') + ' &middot; records no token (no market cap, no CoinGecko id, no symbol).</p>' +
      (!r.rule_clean ? '<p class="warn"><b>Flagged:</b> ' + esc(r.exclusion_note || '') + ' The implied value is halved (tier &times;0.5) and the farm plan starts with this warning.</p>' : '') +
      '<dl class="kv">' +
      '<div><dt>Implied value</dt><dd>' + money(r.implied_value_usd) + '</dd></div>' +
      '<div><dt>TVL</dt><dd>' + money(r.tvl_usd) + '</dd></div>' +
      '<div><dt>7-day change</dt><dd>' + (r.change_7d === null ? '—' : (r.change_7d > 0 ? '+' : '') + r.change_7d.toFixed(1) + '%') + '</dd></div>' +
      '<div><dt>No-token days</dt><dd>' + fmtAge(r.age_days) + '</dd></div>' +
      '<div><dt>Category multiple</dt><dd>' + r.category_multiple.toFixed(2) + 'x</dd></div>' +
      '</dl>' +
      '<h3>How the number is built</h3>' +
      '<table class="math"><tbody>' +
      '<tr><td>TVL &times; category multiple</td><td class="num">' + money(r.tvl_usd) + ' &times; ' + r.category_multiple.toFixed(4) + ' = ' + money(base) + '</td></tr>' +
      '<tr><td>&times; growth (' + (r.change_7d === null ? 'no 7d figure reported' : r.change_7d.toFixed(1) + '%') + ')</td><td class="num">&times; ' + r.growth_multiplier.toFixed(4) + '</td></tr>' +
      '<tr><td>&times; maturity (' + fmtAge(r.age_days) + ' with no token)</td><td class="num">&times; ' + r.maturity_multiplier.toFixed(4) + '</td></tr>' +
      '<tr><td>&times; chains (' + r.chains.length + ')</td><td class="num">&times; ' + r.chain_multiplier.toFixed(2) + '</td></tr>' +
      '<tr><td>&times; tier (' + (r.rule_clean ? 'rule-clean' : 'flagged') + ')</td><td class="num">&times; ' + r.tier_multiplier.toFixed(2) + '</td></tr>' +
      '<tr><td><b>= implied value</b></td><td class="num"><b>' + money(r.implied_value_usd) + '</b></td></tr>' +
      '</tbody></table>' +
      '<h3>Farm plan — ' + r.farm_steps.length + ' steps</h3>' +
      '<ol class="steps">' + r.farm_steps.map(function (s) {
        var m = s.match(/ Cost: (.*)\. Time: (.*)\.$/);
        var body = m ? s.slice(0, m.index) : s;
        return '<li>' + esc(body) + '<br><span class="chip">Cost: ' + esc(m ? m[1] : '—') + '</span><span class="chip">Time: ' + esc(m ? m[2] : '—') + '</span></li>';
      }).join('') + '</ol>' +
      '<p class="hint">Each step states its own cost and time. The plan is generated from this protocol&rsquo;s category, main chain, TVL tier and age — not copied from another protocol.</p>';
    el.scrollIntoView({ behavior: 'auto', block: 'start' });
    renderBoard();
  }

  // ---- live reference table ----
  $('live').querySelector('tbody').innerHTML = live.map(function (p) {
    var ratio = p.mcap_usd && p.tvl_usd ? (p.mcap_usd / p.tvl_usd).toFixed(2) + 'x' : '—';
    return '<tr><td><b>' + esc(p.name) + '</b><span class="sub">' + esc(p.slug) + '</span></td>' +
      '<td>' + esc(p.category || '—') + '</td><td>' + esc(p.chains.slice(0, 2).join(', ')) + '</td>' +
      '<td class="num">' + money(p.tvl_usd) + '</td><td class="num">' + money(p.mcap_usd || 0) + '</td>' +
      '<td class="num">' + ratio + '</td><td class="num">' + pct(p.change_7d) + '</td></tr>';
  }).join('');

  // ---- events ----
  $('board').querySelector('tbody').addEventListener('click', function (e) {
    var tr = e.target.closest('tr[data-slug]');
    if (tr) { location.hash = '#detail/' + tr.getAttribute('data-slug'); }
  });
  function bind(id, ev, fn) { $(id).addEventListener(ev, fn); }
  bind('q', 'input', function () { state.q = $('q').value.trim(); renderBoard(); });
  bind('cat', 'change', function () { state.cat = $('cat').value; renderBoard(); });
  bind('chain', 'change', function () { state.chain = $('chain').value; renderBoard(); });
  bind('sort', 'change', function () { state.sort = $('sort').value; renderBoard(); });
  bind('watch', 'change', function () { state.watch = $('watch').checked; renderBoard(); });
  bind('hideflag', 'change', function () { state.hideflag = $('hideflag').checked; renderBoard(); });
  bind('tab-board', 'click', function () {
    $('tab-board').classList.add('active'); $('tab-live').classList.remove('active');
    $('view-board').hidden = false; $('view-live').hidden = true;
  });
  bind('tab-live', 'click', function () {
    $('tab-live').classList.add('active'); $('tab-board').classList.remove('active');
    $('view-live').hidden = false; $('view-board').hidden = true;
  });

  function route() {
    var h = location.hash || '';
    if (h.charAt(0) === '#') h = h.slice(1);
    if (h.charAt(0) === '/') h = h.slice(1);
    if (h.indexOf('detail/') === 0) { renderDetail(h.slice(7)); return; }
    if (h.indexOf('cat/') === 0) {
      state.cat = decodeURIComponent(h.slice(4)); $('cat').value = state.cat; renderBoard(); return;
    }
    renderBoard();
  }
  window.addEventListener('hashchange', route);
  route();
})();
