import { createStore } from './store.js';

// ---------- Constants ----------
const PLANS = {
  together_home: { label: 'Cooking at home together', short: 'Home together', icon: '🍳', together: true, ph: 'What are we making?' },
  together_out:  { label: 'Eating out together',      short: 'Out together',  icon: '🍽️', together: true, ph: 'Where?' },
  own_home:      { label: 'On my own, at home',        short: 'Own · home',    icon: '🥪', ph: 'What are you having?' },
  own_out:       { label: 'On my own, out / at work',  short: 'Own · out',     icon: '🏃', ph: 'Where / with whom?' },
  skip:          { label: 'Skipping / away',           short: 'Skipping',      icon: '✈️', ph: 'Optional note' },
};
const SLOTS = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner' };
const SLOT_ORDER = ['breakfast', 'lunch', 'dinner'];
const PEOPLE = ['p1', 'p2'];
const DEFAULT_SLOTS = ['lunch', 'dinner'];

// ---------- State ----------
const state = {
  store: null,
  hid: null,
  me: null,
  household: undefined, // undefined = loading, null = not found
  weekStart: mondayOf(new Date()),
  week: {},
  unsubHh: null,
  unsubWeek: null,
  justCreated: false,
  didScroll: false,
};
const $app = document.getElementById('app');
const $editor = document.getElementById('editor');
const $settings = document.getElementById('settings');

// ---------- Helpers ----------
const pad = (n) => String(n).padStart(2, '0');
function iso(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function mondayOf(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function parseIso(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
const fmtDay = (d) => d.toLocaleDateString(undefined, { weekday: 'short' });
const fmtDate = (d) => d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const other = (p) => (p === 'p1' ? 'p2' : 'p1');
const nameOf = (p) => state.household?.names?.[p] || (p === 'p1' ? 'Person 1' : 'Person 2');
const slotsOn = () => SLOT_ORDER.filter((s) => (state.household?.slots || DEFAULT_SLOTS).includes(s));

function randomId(len = 22) {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => abc[b % abc.length]).join('');
}
function lsGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function lsSet(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* ignore */ } }

// Household + identity live in the URL hash so a home-screen shortcut keeps them
// (iOS home-screen apps don't share localStorage with Safari).
function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  return { h: p.get('h'), me: p.get('me') };
}
function writeHash() {
  const p = new URLSearchParams();
  if (state.hid) p.set('h', state.hid);
  if (state.me) p.set('me', state.me);
  history.replaceState(null, '', p.toString() ? `#${p}` : location.pathname + location.search);
  lsSet('mp:hid', state.hid);
  lsSet('mp:me', state.me);
}
function inviteLink() {
  return `${location.origin}${location.pathname}#h=${state.hid}`;
}

let toastTimer;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

async function shareInvite() {
  const url = inviteLink();
  if (navigator.share) {
    try { await navigator.share({ title: 'Our Meals', text: 'Join our meal plan', url }); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  try { await navigator.clipboard.writeText(url); toast('Invite link copied'); }
  catch { prompt('Copy this link:', url); }
}

// ---------- Status logic ----------
function entriesFor(date, slot) {
  return state.week?.days?.[date]?.[slot] || {};
}
function slotStatus(e) {
  const a = e.p1, b = e.p2;
  if (!a && !b) return { cls: 'empty', text: 'Not planned' };
  if (!a || !b) return { cls: 'pending', text: `Waiting on ${nameOf(!a ? 'p1' : 'p2')}` };
  if (a.plan === b.plan && PLANS[a.plan]?.together) {
    return { cls: a.plan === 'together_home' ? 'home' : 'out', text: PLANS[a.plan].short };
  }
  if (PLANS[a.plan]?.together || PLANS[b.plan]?.together) return { cls: 'conflict', text: "Plans don't match" };
  return { cls: 'separate', text: 'Separate' };
}

// ---------- Rendering ----------
function render() {
  if (!state.hid) return renderWelcome();
  if (state.household === undefined) { $app.innerHTML = '<p class="loading">Loading…</p>'; return; }
  if (state.household === null) return renderNotFound();
  if (state.justCreated) return renderInvite();
  if (!state.me) return renderWhoAreYou();
  renderWeek();
}

function renderWelcome() {
  $app.innerHTML = `
    <div class="welcome">
      <h1>🍽️ Our Meals</h1>
      <p>Plan the week together: who's cooking, who's out, who's on their own.</p>
      ${demoBanner()}
      <form class="card" id="create">
        <h2>Start a shared plan</h2>
        <label class="field" for="n1">Your name</label>
        <input type="text" id="n1" required autocomplete="given-name" maxlength="20">
        <label class="field" for="n2">Your partner's name</label>
        <input type="text" id="n2" required maxlength="20">
        <div class="row"><button class="btn primary" type="submit">Create</button></div>
      </form>
      <form class="card" id="join">
        <h2>Got an invite link?</h2>
        <p class="hint" style="margin:0 0 10px">Just open it on this phone, or paste it here.</p>
        <input type="text" id="link" placeholder="Paste invite link" required>
        <div class="row"><button class="btn" type="submit">Join</button></div>
      </form>
    </div>`;
  $app.querySelector('#create').onsubmit = async (e) => {
    e.preventDefault();
    const n1 = $app.querySelector('#n1').value.trim();
    const n2 = $app.querySelector('#n2').value.trim();
    const hid = randomId();
    try {
      await state.store.saveHousehold(hid, { names: { p1: n1, p2: n2 }, slots: DEFAULT_SLOTS, createdAt: Date.now() });
    } catch (err) { console.error(err); toast("Couldn't create — check your connection"); return; }
    state.me = 'p1';
    state.justCreated = true;
    openHousehold(hid);
  };
  $app.querySelector('#join').onsubmit = (e) => {
    e.preventDefault();
    const raw = $app.querySelector('#link').value.trim();
    const m = raw.match(/[#&?]h=([A-Za-z0-9]{20,})/) || raw.match(/^([A-Za-z0-9]{20,})$/);
    if (!m) { toast("That doesn't look like an invite link"); return; }
    state.me = null;
    openHousehold(m[1]);
  };
}

function renderInvite() {
  $app.innerHTML = `
    <div class="welcome">
      <h1>You're set up 🎉</h1>
      <p>Now send ${esc(nameOf('p2'))} the invite link so you both see the same plan.</p>
      <div class="card">
        <div class="linkbox">${esc(inviteLink())}</div>
        <div class="row"><button class="btn primary" id="share">Share invite link</button></div>
        <p class="hint">Tip: after opening, use your browser's <b>Add to Home Screen</b> so it works like an app.</p>
      </div>
      <div class="row"><button class="btn" id="go">Go to this week →</button></div>
    </div>`;
  $app.querySelector('#share').onclick = shareInvite;
  $app.querySelector('#go').onclick = () => { state.justCreated = false; render(); };
}

function renderNotFound() {
  $app.innerHTML = `
    <div class="welcome">
      <h1>Plan not found</h1>
      <p>${state.store.mode === 'local'
        ? "This app is in demo mode, so plans only exist on the phone that created them. Enable sync (see README) to share between phones."
        : 'The invite link may be incomplete. Ask your partner to share it again.'}</p>
      <div class="row"><button class="btn" id="reset">Start over</button></div>
    </div>`;
  $app.querySelector('#reset').onclick = leaveHousehold;
}

function renderWhoAreYou() {
  $app.innerHTML = `
    <div class="welcome">
      <h1>Who are you?</h1>
      <p>So we know whose plans to fill in on this phone.</p>
      ${PEOPLE.map((p) => `<div class="row"><button class="btn primary" data-p="${p}">I'm ${esc(nameOf(p))}</button></div>`).join('')}
    </div>`;
  $app.querySelectorAll('[data-p]').forEach((b) => {
    b.onclick = () => { state.me = b.dataset.p; writeHash(); render(); };
  });
}

function demoBanner() {
  return state.store?.mode === 'local'
    ? `<div class="banner"><b>Demo mode:</b> data stays on this device only. Follow README → “Enable sync” to share between your phones.</div>`
    : '';
}

function renderWeek() {
  const start = state.weekStart;
  const end = addDays(start, 6);
  const todayIso = iso(new Date());
  const isThisWeek = iso(start) === iso(mondayOf(new Date()));
  const slots = slotsOn();

  const counts = { home: 0, out: 0, separate: 0, conflict: 0, todo: 0 };
  let days = '';
  for (let i = 0; i < 7; i++) {
    const d = addDays(start, i);
    const di = iso(d);
    let slotHtml = '';
    for (const s of slots) {
      const e = entriesFor(di, s);
      const st = slotStatus(e);
      if (st.cls === 'empty' || st.cls === 'pending') counts.todo++;
      else counts[st.cls]++;
      slotHtml += `
        <button class="slot" data-date="${di}" data-slot="${s}">
          <div class="slot-top"><span class="slot-name">${SLOTS[s]}</span><span class="pill ${st.cls}">${esc(st.text)}</span></div>
          ${renderSlotLines(e, st)}
        </button>`;
    }
    const cls = di === todayIso ? 'today' : di < todayIso ? 'past' : '';
    days += `
      <section class="day ${cls}" ${di === todayIso ? 'id="today"' : ''}>
        <header><span class="dow">${fmtDay(d)}</span><span class="date">${fmtDate(d)}</span>${di === todayIso ? '<span class="badge">Today</span>' : ''}</header>
        ${slotHtml}
      </section>`;
  }

  const summary = [
    counts.home && `<span class="pill home">🍳 ${counts.home} home together</span>`,
    counts.out && `<span class="pill out">🍽️ ${counts.out} out together</span>`,
    counts.separate && `<span class="pill separate">↔ ${counts.separate} separate</span>`,
    counts.conflict && `<span class="pill conflict">⚠ ${counts.conflict} to sort out</span>`,
    counts.todo && `<span class="pill empty">${counts.todo} not planned</span>`,
  ].filter(Boolean).join('');

  $app.innerHTML = `
    <div class="topbar">
      <button class="icon-btn" id="prev" aria-label="Previous week">‹</button>
      <h1>${isThisWeek ? 'This week' : 'Week of ' + fmtDate(start)}<small>${fmtDate(start)} – ${fmtDate(end)}</small></h1>
      ${isThisWeek ? '' : '<button class="icon-btn today-btn" id="now">Today</button>'}
      <button class="icon-btn" id="next" aria-label="Next week">›</button>
      <button class="icon-btn" id="gear" aria-label="Settings">⚙︎</button>
    </div>
    ${demoBanner()}
    <div class="summary">${summary}</div>
    ${days}`;

  $app.querySelector('#prev').onclick = () => changeWeek(-7);
  $app.querySelector('#next').onclick = () => changeWeek(7);
  $app.querySelector('#now')?.addEventListener('click', () => { state.weekStart = mondayOf(new Date()); state.didScroll = false; watchWeek(); });
  $app.querySelector('#gear').onclick = openSettings;
  $app.querySelectorAll('.slot').forEach((b) => { b.onclick = () => openEditor(b.dataset.date, b.dataset.slot); });

  if (isThisWeek && !state.didScroll) {
    state.didScroll = true;
    const t = document.getElementById('today');
    if (t && t.getBoundingClientRect().top > innerHeight * 0.5) t.scrollIntoView({ block: 'start' });
  }
}

function renderSlotLines(e, st) {
  // When both agree on a together-plan, collapse to one line.
  if (st.cls === 'home' || st.cls === 'out') {
    const notes = [...new Set([e.p1?.note, e.p2?.note].filter(Boolean))].join(' · ');
    return `<div class="who"><span class="nm">Both</span><span class="txt">${PLANS[e.p1.plan].icon} ${esc(notes || PLANS[e.p1.plan].label)}</span></div>`;
  }
  if (st.cls === 'empty') return '';
  return PEOPLE.map((p) => {
    const x = e[p];
    const body = x
      ? `${PLANS[x.plan]?.icon || ''} ${esc(x.note || PLANS[x.plan]?.label || '')}`
      : '<span class="none">—</span>';
    return `<div class="who"><span class="nm">${esc(nameOf(p))}</span><span class="txt">${body}</span></div>`;
  }).join('');
}

// ---------- Editor ----------
function openEditor(date, slot) {
  const e = entriesFor(date, slot);
  const d = parseIso(date);
  let target = state.me; // 'p1' | 'p2' | 'both'
  let targetTouched = false;
  let planTouched = false;
  let plan = e[state.me]?.plan || null;
  let note = e[state.me]?.note || '';

  const draw = () => {
    const ph = plan ? PLANS[plan].ph : 'Optional note';
    $editor.innerHTML = `
      <form class="sheet-body" method="dialog">
        <h2>${SLOTS[slot]}</h2>
        <p class="sub">${d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
        <div class="seg" role="group" aria-label="Who is this for">
          ${[state.me, other(state.me), 'both'].map((t) => `
            <button type="button" data-t="${t}" aria-pressed="${target === t}">${t === 'both' ? 'Both of us' : t === state.me ? 'Me' : esc(nameOf(t))}</button>`).join('')}
        </div>
        <label class="field">Plan</label>
        <div class="plans">
          ${Object.entries(PLANS).map(([k, v]) => `
            <button type="button" class="plan" data-plan="${k}" aria-pressed="${plan === k}"><span class="ic">${v.icon}</span>${esc(v.label)}</button>`).join('')}
        </div>
        <label class="field" for="note">Details</label>
        <input type="text" id="note" maxlength="80" placeholder="${esc(ph)}" value="${esc(note)}">
        ${PLANS[plan]?.together && target !== 'both' ? `<p class="hint">Tip: choose “Both of us” so ${esc(nameOf(other(state.me)))} doesn't have to enter it too.</p>` : ''}
        <div class="row">
          <button type="button" class="btn danger" id="clear">Clear</button>
          <button type="button" class="btn" id="cancel">Cancel</button>
          <button type="button" class="btn primary" id="save" ${plan ? '' : 'disabled'}>Save</button>
        </div>
      </form>`;

    $editor.querySelectorAll('[data-t]').forEach((b) => b.onclick = () => {
      note = $editor.querySelector('#note').value;
      target = b.dataset.t; targetTouched = true;
      // Only prefill from what's saved if the user hasn't started choosing yet.
      if (!planTouched && target !== 'both') { plan = e[target]?.plan || null; note = e[target]?.note || ''; }
      draw();
    });
    $editor.querySelectorAll('[data-plan]').forEach((b) => b.onclick = () => {
      note = $editor.querySelector('#note').value;
      plan = b.dataset.plan;
      planTouched = true;
      // Together-plans default to applying to both people, unless the user picked a target explicitly.
      if (!targetTouched) target = PLANS[plan].together ? 'both' : state.me;
      draw();
    });
    $editor.querySelector('#cancel').onclick = () => $editor.close();
    $editor.querySelector('#clear').onclick = () => save(null);
    $editor.querySelector('#save').onclick = () => save({ plan, note: $editor.querySelector('#note').value.trim() });
  };

  const save = async (val) => {
    const targets = target === 'both' ? PEOPLE : [target];
    const value = val && { ...val, by: state.me, at: Date.now() };
    $editor.close();
    try {
      await state.store.setEntries(state.hid, iso(state.weekStart), targets.map((person) => ({ date, slot, person, value: value || null })));
    } catch (err) { console.error(err); toast("Couldn't save — will retry when online"); }
  };

  draw();
  $editor.showModal();
  $editor.scrollTop = 0;
}

// ---------- Settings ----------
function openSettings() {
  const hh = state.household;
  const slots = hh.slots || DEFAULT_SLOTS;
  $settings.innerHTML = `
    <form class="sheet-body" method="dialog">
      <h2>Settings</h2>
      <p class="sub">You're ${esc(nameOf(state.me))} on this phone.</p>
      <label class="field" for="sn1">Names</label>
      <input type="text" id="sn1" maxlength="20" value="${esc(nameOf('p1'))}">
      <div style="height:8px"></div>
      <input type="text" id="sn2" maxlength="20" value="${esc(nameOf('p2'))}">
      <label class="field">Meals to plan</label>
      ${SLOT_ORDER.map((s) => `
        <label class="switch"><span>${SLOTS[s]}</span><input type="checkbox" data-slot="${s}" ${slots.includes(s) ? 'checked' : ''}></label>`).join('')}
      <div class="row"><button type="button" class="btn primary" id="ssave">Save</button></div>
      <div class="row"><button type="button" class="btn" id="sshare">Share invite link</button></div>
      <div class="row">
        <button type="button" class="btn" id="sswitch">I'm ${esc(nameOf(other(state.me)))}</button>
        <button type="button" class="btn danger" id="sleave">Leave on this phone</button>
      </div>
      <p class="hint">${state.store.mode === 'cloud' ? '✓ Synced between your phones.' : 'Demo mode: not synced. See README → Enable sync.'}</p>
    </form>`;
  $settings.querySelector('#ssave').onclick = async () => {
    const names = { p1: $settings.querySelector('#sn1').value.trim() || nameOf('p1'), p2: $settings.querySelector('#sn2').value.trim() || nameOf('p2') };
    const chosen = [...$settings.querySelectorAll('[data-slot]')].filter((c) => c.checked).map((c) => c.dataset.slot);
    $settings.close();
    try { await state.store.saveHousehold(state.hid, { names, slots: chosen.length ? chosen : ['dinner'] }); toast('Saved'); }
    catch (err) { console.error(err); toast("Couldn't save settings"); }
  };
  $settings.querySelector('#sshare').onclick = shareInvite;
  $settings.querySelector('#sswitch').onclick = () => { state.me = other(state.me); writeHash(); $settings.close(); render(); };
  $settings.querySelector('#sleave').onclick = () => {
    if (confirm('Remove this plan from this phone? (Nothing is deleted; you can rejoin with the invite link.)')) {
      $settings.close(); leaveHousehold();
    }
  };
  $settings.showModal();
}

// Close sheets when tapping the backdrop.
for (const dlg of [$editor, $settings]) {
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
}

// ---------- Data wiring ----------
function openHousehold(hid) {
  state.unsubHh?.();
  state.hid = hid;
  state.household = undefined;
  writeHash();
  render();
  state.unsubHh = state.store.watchHousehold(hid, (data) => {
    state.household = data;
    if (state.me && !PEOPLE.includes(state.me)) state.me = null;
    render();
  });
  watchWeek();
}

function watchWeek() {
  state.unsubWeek?.();
  state.week = {};
  const weekId = iso(state.weekStart);
  state.unsubWeek = state.store.watchWeek(state.hid, weekId, (data) => {
    if (iso(state.weekStart) !== weekId) return;
    state.week = data;
    if (!$editor.open) render(); // don't redraw under an open editor
  });
  render();
}

function changeWeek(delta) {
  state.weekStart = addDays(state.weekStart, delta);
  watchWeek();
  window.scrollTo(0, 0);
}

function leaveHousehold() {
  state.unsubHh?.(); state.unsubWeek?.();
  state.hid = null; state.me = null; state.household = undefined; state.week = {};
  writeHash();
  render();
}

$editor.addEventListener('close', () => render());

window.addEventListener('hashchange', () => {
  const { h, me } = readHash();
  if (h && h !== state.hid) { state.me = PEOPLE.includes(me) ? me : null; openHousehold(h); }
});

// Refresh the "today" highlight when the app is reopened on a new day.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.household) render();
});

// ---------- Boot ----------
(async function boot() {
  try {
    state.store = await createStore((err) => { console.error(err); toast('Sync problem — check your connection'); });
  } catch (err) {
    console.error(err);
    $app.innerHTML = `<div class="welcome"><h1>Can't connect</h1><p>Check your internet connection, then reload. If this keeps happening, check config.js and that Anonymous sign-in is enabled in Firebase.</p></div>`;
    return;
  }
  const fromHash = readHash();
  const hid = fromHash.h || lsGet('mp:hid');
  const me = fromHash.h ? fromHash.me : (fromHash.me || lsGet('mp:me'));
  state.me = PEOPLE.includes(me) ? me : null;
  // If this phone already chose an identity for this same household, keep it.
  if (!state.me && fromHash.h && fromHash.h === lsGet('mp:hid') && PEOPLE.includes(lsGet('mp:me'))) state.me = lsGet('mp:me');
  if (hid) openHousehold(hid); else render();
})();
