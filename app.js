/* Husholdningsøkonomi – alt kjører i nettleseren. Data lagres lokalt (localStorage + IndexedDB for kvitteringer). */
'use strict';

const LAGRINGSNOKKEL = 'husholdningsokonomi-v1';
const STANDARD_KORT = [
  { id: 'amex', navn: 'Amex', startdag: 20, monster: 'amex|american' },
  { id: 'sas', navn: 'SAS Mastercard', startdag: 1, monster: 'sas|eurobonus|mastercard|entercard' },
  { id: 'trumf', navn: 'Trumf Kredittkort', startdag: 1, monster: 'trumf' },
  { id: 'annet', navn: 'Vipps / kontant / annet', startdag: 1, monster: '' },
];
const STANDARD_POSTER = ['Husholdning', 'Alkohol', 'Transport', 'Lek og fritid', 'Klær og sko', 'Interiør/eksteriør',
  'Restaurant/takeaway', 'Gaver', 'Bursdagsfeiring', 'Bil (verksted + dekkhotell)', 'Ferie (felles)', 'Abonnement',
  'Uforutsette utgifter'];
const UTELATT_GRUNNER = ['Utlegg for andre', 'Jobb', 'Refusjon', 'Innbetaling', 'Svindel', 'Annet'];
const NOKKELORD = [
  [/kiwi|rema ?1000|coop|meny|extra|joker|bunnpris|spar |oda\.|europris|normal /i, 'Husholdning'],
  [/vinmonopolet/i, 'Alkohol'],
  [/circle k|uno-?x|esso|shell|st1|bompenger|autopass|easypark|apcoa|onepark|ladeklubb|tesla supercharger/i, 'Transport'],
  [/netflix|spotify|viaplay|hbo|disney|max\.com|apple\.com\/bill|storytel|bookbeat/i, 'Abonnement'],
  [/foodora|wolt|just ?eat|peppes|dominos|burger king|mcdonald|egon/i, 'Restaurant/takeaway'],
  [/ikea|jysk|bohus|plantasjen|clas ohlson|biltema|jula|obs bygg|maxbo|byggmakker|xl-bygg|kid interi/i, 'Interiør/eksteriør'],
  [/h&m|hm\.com|lindex|kappahl|cubus|zalando|nille|name it|polarn/i, 'Klær og sko'],
  [/sas |flysas|norwegian|widerøe|wideroe|hotels\.com|booking\.com|airbnb/i, 'Ferie (felles)'],
];
const INNBETALING = /betaling mottatt|innbetaling|takk for betaling|payment received|payment - thank|innbet\./i;
const MND = ['Januar', 'Februar', 'Mars', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Desember'];

/* ---------- tilstand ---------- */
let S = lesTilstand();
let fane = 'oversikt';
const ui = { mnd: null, ar: null, faktMnd: null, filter: { kort: '', status: '', post: '', sok: '', mnd: '' }, kvitteringFor: null, sisteImport: null };

function tomTilstand() {
  return {
    app: 'husholdningsbudsjett', versjon: 1,
    innstillinger: { navn: 'Husholdningsøkonomi', sporAlltid: 'ruter|flytoget|\\bvy\\b|skyss|entur', kort: STANDARD_KORT },
    poster: STANDARD_POSTER.map(n => ({ navn: n, budsjett: 0 })),
    faste: [], personer: [], transaksjoner: [], historikk: [], ekstra: [], overfort: {},
  };
}
function normaliser(s) {
  const t = Object.assign(tomTilstand(), s || {});
  t.innstillinger = Object.assign({}, tomTilstand().innstillinger, t.innstillinger || {});
  if (!Array.isArray(t.innstillinger.kort) || !t.innstillinger.kort.length) t.innstillinger.kort = STANDARD_KORT;
  for (const k of ['poster', 'faste', 'personer', 'transaksjoner', 'historikk', 'ekstra']) if (!Array.isArray(t[k])) t[k] = [];
  t.transaksjoner.sort((a, b) => a.dato.localeCompare(b.dato));
  if (!t.overfort || typeof t.overfort !== 'object') t.overfort = {};
  return t;
}
function lesTilstand() {
  try { const r = localStorage.getItem(LAGRINGSNOKKEL); if (r) return normaliser(JSON.parse(r)); } catch (e) { console.error(e); }
  return tomTilstand();
}
function lagreLokalt() {
  try { localStorage.setItem(LAGRINGSNOKKEL, JSON.stringify(S)); }
  catch (e) { toast('Kunne ikke lagre i nettleseren: ' + e.message); }
}
function lagre() {
  const endret = stempel();
  lagreLokalt();
  if (endret) planleggSynk();
}

/* Tidsstempler per del og per transaksjon, så to telefoner kan slås sammen uten å miste noe */
const SEKSJONER = ['poster', 'faste', 'personer', 'historikk', 'ekstra', 'overfort', 'innstillinger'];
let bilde = null;
function stempel() {
  const naa = Date.now();
  if (!S.endret || typeof S.endret !== 'object') S.endret = {};
  if (!S.slettet || typeof S.slettet !== 'object') S.slettet = {};
  const ny = { sek: {}, t: new Map() };
  for (const k of SEKSJONER) ny.sek[k] = JSON.stringify(S[k]);
  for (const t of S.transaksjoner) { const { endret, ...rest } = t; ny.t.set(t.id, JSON.stringify(rest)); }
  let endret = false;
  if (bilde) {
    for (const k of SEKSJONER) if (bilde.sek[k] !== ny.sek[k]) { S.endret[k] = naa; endret = true; }
    for (const t of S.transaksjoner) if (bilde.t.get(t.id) !== ny.t.get(t.id)) { t.endret = naa; endret = true; }
    for (const id of bilde.t.keys()) if (!ny.t.has(id)) { S.slettet[id] = naa; endret = true; }
  }
  bilde = ny;
  return endret;
}
function nyttBilde() { bilde = null; stempel(); }

/* ---------- kvitteringer i IndexedDB ---------- */
let dbP = null;
function db() {
  if (!dbP) dbP = new Promise((ok, feil) => {
    const r = indexedDB.open('husholdningsokonomi-kvitteringer', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('k');
    r.onsuccess = () => ok(r.result); r.onerror = () => feil(r.error);
  });
  return dbP;
}
async function kvSett(id, data) { const d = await db(); return new Promise((ok, f) => { const tx = d.transaction('k', 'readwrite'); tx.objectStore('k').put(data, id); tx.oncomplete = ok; tx.onerror = () => f(tx.error); }); }
async function kvHent(id) { const d = await db(); return new Promise((ok, f) => { const r = d.transaction('k').objectStore('k').get(id); r.onsuccess = () => ok(r.result); r.onerror = () => f(r.error); }); }
async function kvAlle() { const d = await db(); return new Promise((ok, f) => { const ut = {}; const r = d.transaction('k').objectStore('k').openCursor(); r.onsuccess = () => { const c = r.result; if (c) { ut[c.key] = c.value; c.continue(); } else ok(ut); }; r.onerror = () => f(r.error); }); }
async function kvTom() { const d = await db(); return new Promise(ok => { const tx = d.transaction('k', 'readwrite'); tx.objectStore('k').clear(); tx.oncomplete = ok; }); }

/* ---------- hjelpere ---------- */
const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const kr = (n, des = 0) => (Number(n) || 0).toLocaleString('nb-NO', { minimumFractionDigits: des, maximumFractionDigits: des });
const krD = n => kr(n, 2);
const pad = n => String(n).padStart(2, '0');
const iDag = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const datoNo = iso => { if (!iso) return ''; const [y, m, d] = iso.split('-'); return `${+d}.${+m}.${y}`; };
const mndNavn = ym => { const [y, m] = ym.split('-'); return `${MND[+m - 1]} ${y}`; };
const sisteDag = (y, m) => new Date(y, m, 0).getDate();
const nyId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.add('vis'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('vis'), 3200); }
const kortNavn = id => (S.innstillinger.kort.find(k => k.id === id) || { navn: id }).navn;
const belopFort = t => t.status === 'fort' ? (t.fort ?? t.belop) : 0;

function nokkel(tekst) {
  const stopp = new Set(['as', 'ab', 'ltd', 'pte', 'www', 'com', 'no', 'llc', 'inc', 'the', 'og', 'https', 'http', 'gmbh', 'sumup', 'izettle', 'zettle', 'vipps', 'tm', 'payment']);
  const ord = String(tekst || '').toLowerCase().replace(/[^a-zæøåäöü&]+/g, ' ').split(' ').filter(w => w.length >= 2 && !stopp.has(w));
  return ord.slice(0, 2).join(' ');
}
const normTekst = t => String(t || '').toLowerCase().replace(/\s+/g, ' ').trim();

/* Hvilken kortfaktura en transaksjon hører til */
function faktura(kortId, dato) {
  const kort = S.innstillinger.kort.find(k => k.id === kortId) || { startdag: 1 };
  const sd = Number(kort.startdag) || 1;
  let [y, m, d] = dato.split('-').map(Number);
  if (sd > 1 && d >= sd) { m++; if (m > 12) { m = 1; y++; } }
  const key = `${y}-${pad(m)}`;
  let fra, til;
  if (sd > 1) {
    let py = y, pm = m - 1; if (pm < 1) { pm = 12; py--; }
    fra = `${py}-${pad(pm)}-${pad(sd)}`; til = `${y}-${pad(m)}-${pad(sd - 1)}`;
  } else {
    fra = `${y}-${pad(m)}-01`; til = `${y}-${pad(m)}-${pad(sisteDag(y, m))}`;
  }
  return { key, fra, til, fakturadato: til };
}
function fakturaFraKey(kortId, key) {
  const kort = S.innstillinger.kort.find(k => k.id === kortId) || { startdag: 1 };
  const [y, m] = key.split('-').map(Number);
  const sd = Number(kort.startdag) || 1;
  return faktura(kortId, sd > 1 ? `${y}-${pad(m)}-${pad(sd - 1)}` : `${y}-${pad(m)}-01`);
}

/* ---------- automatisk plassering ---------- */
function utfallsnokkel(t) {
  if (t.status === 'fort') return 'fort:' + t.post;
  if (t.status === 'privat') return 'privat:' + (t.eier || '');
  if (t.status === 'utelatt') return 'utelatt:' + (t.grunn || 'Annet');
  return null;
}
function brukUtfall(t, u) {
  const [status, verdi] = u.split(/:(.*)/s);
  t.status = status; delete t.eier; delete t.grunn;
  if (status === 'fort') { t.post = verdi; }
  else { t.post = ''; delete t.fort; }
  if (status === 'privat') t.eier = verdi;
  if (status === 'utelatt') t.grunn = verdi || 'Annet';
  delete t.forslag; delete t.sporsmal;
}
function klassifiser(t) {
  const tekst = t.tekst || '';
  if (INNBETALING.test(tekst)) return { utfall: 'utelatt:Innbetaling', auto: true };
  let sporAlltid = null;
  try { sporAlltid = S.innstillinger.sporAlltid ? new RegExp(S.innstillinger.sporAlltid, 'i') : null; } catch (e) { sporAlltid = null; }
  const k = nokkel(tekst);
  const historikk = k ? S.transaksjoner.filter(x => x !== t && x.status !== 'bekreft' && nokkel(x.tekst) === k).slice(-25) : [];
  const telling = {};
  // Engangsutfall (utlegg for andre, refusjon, svindel …) skal ikke styre neste kjøp i samme butikk
  const engang = /^utelatt:(?!Innbetaling|Jobb)/;
  for (const x of historikk) { const u = utfallsnokkel(x); if (u && !engang.test(u)) telling[u] = (telling[u] || 0) + 1; }
  const sortert = Object.entries(telling).sort((a, b) => b[1] - a[1]);
  const flertall = sortert[0] && sortert[0][0];
  if (sporAlltid && sporAlltid.test(tekst)) return { utfall: null, forslag: flertall, sporsmal: 'Privat eller jobb?' };
  if (t.belop < 0) return { utfall: null, forslag: flertall || 'utelatt:Refusjon', sporsmal: 'Pengene tilbake – hva gjelder det?' };
  if (sortert.length === 1) {
    const u = sortert[0][0];
    if ((u.startsWith('fort:') && S.poster.some(p => 'fort:' + p.navn === u)) || (u.startsWith('privat:') && sortert[0][1] >= 2)) return { utfall: u, auto: true };
    return { utfall: null, forslag: u };
  }
  if (sortert.length > 1) return { utfall: null, forslag: flertall, sporsmal: 'Har vært ført ulikt før' };
  for (const [re, post] of NOKKELORD) if (re.test(tekst) && S.poster.some(p => p.navn === post)) return { utfall: 'fort:' + post, auto: true };
  return { utfall: null };
}
function plasser(t) {
  const r = klassifiser(t);
  if (r.utfall) brukUtfall(t, r.utfall);
  else { t.status = 'bekreft'; t.post = ''; t.forslag = r.forslag || ''; t.sporsmal = r.sporsmal || ''; }
}

/* ---------- lesing av fakturafiler ---------- */
async function lesFil(fil) {
  const navn = fil.name.toLowerCase();
  if (/\.(xlsx|xls|ods)$/.test(navn)) {
    if (!window.XLSX) throw new Error('Excel-leseren er ikke lastet ennå. Sjekk nettforbindelsen og prøv igjen.');
    const wb = XLSX.read(await fil.arrayBuffer(), { type: 'array', cellDates: true });
    let beste = [];
    for (const ark of wb.SheetNames) {
      const rader = XLSX.utils.sheet_to_json(wb.Sheets[ark], { header: 1, raw: true, defval: '' });
      if (rader.length > beste.length) beste = rader;
    }
    return beste;
  }
  const buf = await fil.arrayBuffer();
  let tekst = new TextDecoder('utf-8').decode(buf);
  if (tekst.includes('�')) tekst = new TextDecoder('windows-1252').decode(buf);
  return parseCsv(tekst.replace(/^﻿/, ''));
}
function parseCsv(tekst) {
  const forsteLinjer = tekst.split(/\r?\n/).slice(0, 10).join('\n');
  const skille = [';', '\t', ','].map(c => [c, forsteLinjer.split(c).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rader = []; let rad = [], felt = '', iAnf = false;
  for (let i = 0; i < tekst.length; i++) {
    const c = tekst[i];
    if (iAnf) {
      if (c === '"') { if (tekst[i + 1] === '"') { felt += '"'; i++; } else iAnf = false; }
      else felt += c;
    } else if (c === '"') iAnf = true;
    else if (c === skille) { rad.push(felt); felt = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && tekst[i + 1] === '\n') i++; rad.push(felt); rader.push(rad); rad = []; felt = ''; }
    else felt += c;
  }
  if (felt || rad.length) { rad.push(felt); rader.push(rad); }
  return rader.filter(r => r.some(v => String(v).trim() !== ''));
}
function tilTall(v) {
  if (typeof v === 'number') return v;
  let s = String(v ?? '').replace(/[\s ]|kr|nok/gi, '').replace(/−/g, '-');
  if (!s) return NaN;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (s.endsWith('-')) { neg = true; s = s.slice(0, -1); }
  const sk = s.lastIndexOf(','), sp = s.lastIndexOf('.');
  if (sk > -1 && sp > -1) s = sk > sp ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (sk > -1) s = s.replace(/\.(?=\d{3})/g, '').replace(',', '.');
  else if (sp > -1 && /\.\d{3}$/.test(s) && (s.match(/\./g) || []).length >= 1 && !/\.\d{1,2}$/.test(s)) s = s.replace(/\./g, '');
  const n = parseFloat(s);
  return neg ? -n : n;
}
function datoDeler(v) {
  if (v instanceof Date && !isNaN(v)) return { iso: `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}` };
  if (typeof v === 'number' && v > 30000 && v < 80000) { const d = new Date(Math.round((v - 25569) * 864e5)); return { iso: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` }; }
  const s = String(v ?? '').trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); if (m) return { iso: `${m[1]}-${pad(m[2])}-${pad(m[3])}` };
  m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
  if (m) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return { a: +m[1], b: +m[2], y, skille: s.includes('/') ? '/' : '.' }; }
  return null;
}
function tolkRader(rader) {
  const finn = (rad, re) => rad.findIndex(c => re.test(String(c).toLowerCase().trim()));
  let hode = -1, iDato = -1, iTekst = -1, iBelop = -1;
  for (let r = 0; r < Math.min(rader.length, 40); r++) {
    const rad = rader[r].map(c => String(c));
    let d = finn(rad, /^(transaksjonsdato|kjøpsdato|dato|date|trans\.? ?dato)/);
    if (d < 0) d = finn(rad, /dato|date/);
    const b = finn(rad, /beløp|belop|amount|^sum|^kr|nok/);
    if (d > -1 && b > -1) {
      hode = r; iDato = d; iBelop = b;
      iTekst = finn(rad, /beskrivelse|spesifikasjon|tekst|description|forklaring|butikk|merchant|detaljer|mottaker|transaksjon$|navn/);
      break;
    }
  }
  const data = rader.slice(hode + 1);
  if (hode < 0) { // gjett kolonner
    const pr = data.slice(0, 20);
    const kol = Math.max(...pr.map(r => r.length));
    const score = i => ({ d: pr.filter(r => datoDeler(r[i])).length, n: pr.filter(r => !isNaN(tilTall(r[i])) && !datoDeler(r[i])).length, len: pr.reduce((s, r) => s + String(r[i] ?? '').length, 0) });
    const sc = Array.from({ length: kol }, (_, i) => score(i));
    iDato = sc.findIndex(s => s.d >= pr.length / 2);
    iBelop = sc.map((s, i) => [s.n, i]).filter(([n, i]) => i !== iDato).sort((a, b) => b[0] - a[0])[0]?.[1] ?? -1;
    iTekst = sc.map((s, i) => [s.len, i]).filter(([, i]) => i !== iDato && i !== iBelop).sort((a, b) => b[0] - a[0])[0]?.[1] ?? -1;
  }
  if (iDato < 0 || iBelop < 0) throw new Error('Fant ikke kolonner for dato og beløp i filen.');
  if (iTekst < 0) iTekst = rader[hode]?.findIndex((c, i) => i !== iDato && i !== iBelop) ?? -1;
  const deler = data.map(r => datoDeler(r[iDato]));
  let dagForst = true; // norsk standard
  if (deler.some(p => p && p.skille === '/' && p.b > 12)) dagForst = false;
  if (deler.some(p => p && p.a > 12)) dagForst = true;
  const ut = [];
  data.forEach((r, i) => {
    const p = deler[i]; if (!p) return;
    const iso = p.iso || (dagForst ? `${p.y}-${pad(p.b)}-${pad(p.a)}` : `${p.y}-${pad(p.a)}-${pad(p.b)}`);
    const belop = tilTall(r[iBelop]);
    if (isNaN(belop) || belop === 0) return;
    ut.push({ dato: iso, tekst: String(r[iTekst] ?? '').trim() || '(uten tekst)', belop });
  });
  const kjop = ut.filter(t => !INNBETALING.test(t.tekst));
  if (kjop.length && kjop.filter(t => t.belop < 0).length > kjop.length / 2) ut.forEach(t => t.belop = -t.belop);
  return ut;
}
function gjettKort(filnavn) {
  const n = filnavn.toLowerCase();
  for (const k of S.innstillinger.kort) if (k.monster && new RegExp(k.monster, 'i').test(n)) return k.id;
  return '';
}
function leggTil(kortId, rader, kilde = 'import') {
  const tell = new Map();
  for (const t of S.transaksjoner) { const k = `${t.kort}|${t.dato}|${Number(t.belop).toFixed(2)}|${normTekst(t.tekst)}`; tell.set(k, (tell.get(k) || 0) + 1); }
  const sett = new Map(); const res = { nye: 0, duplikater: 0, auto: 0, svar: 0 };
  for (const r of rader) {
    const k = `${kortId}|${r.dato}|${Number(r.belop).toFixed(2)}|${normTekst(r.tekst)}`;
    const n = (sett.get(k) || 0) + 1; sett.set(k, n);
    if (n <= (tell.get(k) || 0)) { res.duplikater++; continue; }
    const t = { id: nyId(), kort: kortId, dato: r.dato, tekst: r.tekst, belop: Math.round(r.belop * 100) / 100, kilde, merknad: r.merknad || '' };
    if (r.utfall) brukUtfall(t, r.utfall); else plasser(t);
    S.transaksjoner.push(t); res.nye++;
    if (t.status === 'bekreft') res.svar++; else res.auto++;
  }
  S.transaksjoner.sort((a, b) => a.dato.localeCompare(b.dato));
  lagre();
  return res;
}

/* ---------- beregninger ---------- */
const sumGruppe = g => S.faste.filter(f => f.gruppe === g).reduce((s, f) => s + (Number(f.belop) || 0), 0);
const variabeltBudsjett = () => S.poster.reduce((s, p) => s + (Number(p.budsjett) || 0), 0);
const iMnd = (t, ym) => t.dato.startsWith(ym);
function forbrukPerPost(ym) {
  const m = {}; for (const p of S.poster) m[p.navn] = 0;
  for (const t of S.transaksjoner) if (t.status === 'fort' && iMnd(t, ym)) m[t.post] = (m[t.post] || 0) + belopFort(t);
  return m;
}
function manedsrad(ar, mnd) {
  const ym = `${ar}-${pad(mnd)}`;
  const h = S.historikk.find(x => x.ar === ar && x.mnd === mnd);
  const trans = S.transaksjoner.filter(t => iMnd(t, ym));
  const variabelt = trans.filter(t => t.status === 'fort').reduce((s, t) => s + belopFort(t), 0);
  if (h) return { ym, inntekt: h.inntekt, faste: h.faste + h.sparing, budsjett: h.variabelt_budsjett, variabelt: h.variabelt, kilde: 'regneark' };
  if (!trans.length) return { ym, inntekt: sumGruppe('Inntekt'), faste: sumGruppe('Fast kostnad') + sumGruppe('Sparing'), budsjett: variabeltBudsjett(), variabelt: null, kilde: '' };
  return { ym, inntekt: sumGruppe('Inntekt'), faste: sumGruppe('Fast kostnad') + sumGruppe('Sparing'), budsjett: variabeltBudsjett(), variabelt, kilde: 'transaksjoner' };
}
const ramme = p => Math.round((Number(p.lonn) || 0) * 15 / 85);

/* ---------- visning ---------- */
function tegn() {
  $('#app-navn').textContent = S.innstillinger.navn || 'Husholdningsøkonomi';
  document.title = S.innstillinger.navn || 'Husholdningsøkonomi';
  const antSvar = S.transaksjoner.filter(t => t.status === 'bekreft').length;
  const tel = $('#svar-teller'); tel.hidden = !antSvar; tel.textContent = antSvar;
  document.querySelectorAll('#faner button').forEach(b => b.classList.toggle('aktiv', b.dataset.fane === fane));
  const el = $('#innhold');
  el.innerHTML = ({ oversikt: visOversikt, svar: visSvar, importer: visImporter, overforing: visOverforing, transaksjoner: visTransaksjoner, budsjett: visBudsjett, arkiv: visArkiv, innstillinger: visInnstillinger }[fane])();
  etterTegning();
}
function etterTegning() {
  const slipp = $('#slipp');
  if (slipp) {
    const inn = $('#fil-input');
    slipp.onclick = () => inn.click();
    slipp.ondragover = e => { e.preventDefault(); slipp.classList.add('over'); };
    slipp.ondragleave = () => slipp.classList.remove('over');
    slipp.ondrop = e => { e.preventDefault(); slipp.classList.remove('over'); importerFiler([...e.dataTransfer.files]); };
    inn.onchange = () => { importerFiler([...inn.files]); inn.value = ''; };
  }
}

function tomtVarsel() {
  return `<div class="panel"><h2>Kom i gang</h2>
  <p>Ingen data ennå. Velg én av disse:</p>
  <div class="rad"><button class="primar" data-act="last-backup">Last inn startdata / backup-fil</button>
  <button data-act="gaa" data-fane="budsjett">Sett opp budsjettet selv</button></div>
  <p class="note">Data lagres bare i denne nettleseren. Ta backup under Innstillinger av og til.</p></div>`;
}

function visOversikt() {
  if (!S.transaksjoner.length && !S.faste.length) return tomtVarsel();
  const dag = iDag();
  const sisteMnd = S.transaksjoner.length ? S.transaksjoner[S.transaksjoner.length - 1].dato.slice(0, 7) : dag.slice(0, 7);
  const ym = ui.mnd || (dag.slice(0, 7) > sisteMnd ? sisteMnd : dag.slice(0, 7));
  const mnder = [...new Set([dag.slice(0, 7), ...S.transaksjoner.map(t => t.dato.slice(0, 7))])].sort().reverse();
  const forbruk = forbrukPerPost(ym);
  const brukt = Object.values(forbruk).reduce((a, b) => a + b, 0);
  const budsjett = variabeltBudsjett();
  const inntekt = sumGruppe('Inntekt'), faste = sumGruppe('Fast kostnad'), sparing = sumGruppe('Sparing');
  const resultat = inntekt - faste - sparing - brukt;
  const antSvar = S.transaksjoner.filter(t => t.status === 'bekreft').length;
  let h = '';
  // varsler
  const varsler = [];
  if (antSvar) varsler.push(`<div class="varsel"><b>${antSvar} transaksjon${antSvar > 1 ? 'er' : ''} trenger svar.</b> <button class="liten" data-act="gaa" data-fane="svar">Svar nå</button></div>`);
  for (const k of S.innstillinger.kort.filter(k => k.id !== 'annet')) {
    const naa = faktura(k.id, dag);
    let [y, m] = naa.key.split('-').map(Number); m--; if (m < 1) { m = 12; y--; }
    const forrige = fakturaFraKey(k.id, `${y}-${pad(m)}`);
    const harKort = S.transaksjoner.some(t => t.kort === k.id);
    const harForrige = S.transaksjoner.some(t => t.kort === k.id && t.dato >= forrige.fra && t.dato <= forrige.til);
    if (harKort && !harForrige) varsler.push(`<div class="varsel">${esc(k.navn)}: fakturaen for ${datoNo(forrige.fra)}–${datoNo(forrige.til)} er ikke lagt inn. <button class="liten" data-act="gaa" data-fane="importer">Legg inn</button></div>`);
  }
  if (!synkPa()) varsler.push(`<div class="varsel ok">Vil dere se de samme tallene på begge telefonene? <button class="liten" data-act="gaa" data-fane="innstillinger">Koble til felles lagring</button></div>`);
  else if (synk.feil) varsler.push(`<div class="varsel feil">Felles lagring: ${esc(synk.sisteFeil || 'synk feilet')} <button class="liten" data-act="gaa" data-fane="innstillinger">Se innstillinger</button></div>`);
  const sb = S.innstillinger.sisteBackup;
  if (S.transaksjoner.length && (!sb || (Date.now() - new Date(sb)) > 30 * 864e5)) varsler.push(`<div class="varsel">Det er ${sb ? 'over en måned siden' : 'ikke tatt'} backup. <button class="liten" data-act="backup">Ta backup nå</button></div>`);
  h += varsler.join('');

  h += `<div class="rad"><h2 style="margin:0">Variable kostnader</h2><select data-act="velg-mnd">${mnder.map(m => `<option value="${m}" ${m === ym ? 'selected' : ''}>${mndNavn(m)}</option>`).join('')}</select></div>`;
  const dagerIMnd = sisteDag(+ym.slice(0, 4), +ym.slice(5, 7));
  const andelGatt = ym === dag.slice(0, 7) ? (+dag.slice(8, 10)) / dagerIMnd : 1;
  h += `<div class="kpier">
    <div class="kpi"><div class="lbl">Brukt variabelt</div><div class="verdi">${kr(brukt)}</div><div class="sub">av ${kr(budsjett)} i budsjett</div></div>
    <div class="kpi"><div class="lbl">Igjen av budsjettet</div><div class="verdi ${budsjett - brukt < 0 ? 'neg' : 'pos'}">${kr(budsjett - brukt)}</div><div class="sub">${ym === dag.slice(0, 7) ? Math.round(andelGatt * 100) + ' % av måneden er gått' : mndNavn(ym)}</div></div>
    <div class="kpi"><div class="lbl">Inntekt</div><div class="verdi">${kr(inntekt)}</div><div class="sub">faste ${kr(faste)} · sparing ${kr(sparing)}</div></div>
    <div class="kpi"><div class="lbl">Resultat hittil</div><div class="verdi ${resultat < 0 ? 'neg' : 'pos'}">${kr(resultat)}</div><div class="sub">inntekt − faste − sparing − brukt</div></div>
  </div>`;
  h += `<div class="panel">${S.poster.map(p => {
    const b = Number(p.budsjett) || 0, f = forbruk[p.navn] || 0;
    if (!b && !f) return '';
    const pst = b ? Math.min(100, f / b * 100) : 100;
    const kl = f > b ? 'over' : (b && f / b > andelGatt + 0.1 ? 'naer' : '');
    return `<div class="bar-rad"><div>${esc(p.navn)}</div><div class="bar ${kl}"><span style="width:${pst}%"></span></div><div class="bar-tall">${kr(f)} / ${kr(b)}</div></div>`;
  }).join('')}</div>`;
  const andre = Object.keys(forbruk).filter(n => !S.poster.some(p => p.navn === n) && forbruk[n]);
  if (andre.length) h += `<p class="note">Ført på poster som ikke finnes i budsjettet: ${andre.map(n => `${esc(n)} (${kr(forbruk[n])})`).join(', ')}.</p>`;

  // personlig ramme
  if (S.personer.length) {
    h += `<h2>Personlig 15 %-ramme – ${mndNavn(ym)}</h2><div class="panel">${S.personer.map(p => {
      const r = ramme(p);
      const f = S.transaksjoner.filter(t => t.status === 'privat' && t.eier === p.navn && iMnd(t, ym)).reduce((s, t) => s + t.belop, 0);
      return `<div class="bar-rad"><div>${esc(p.navn)}</div><div class="bar ${f > r ? 'over' : ''}"><span style="width:${r ? Math.min(100, f / r * 100) : 0}%"></span></div><div class="bar-tall">${kr(f)} / ${kr(r)}</div></div>`;
    }).join('')}<p class="note">Private kjøp på felles kort. Rammen er lønn til husholdningen × 15/85.</p></div>`;
  }

  // år
  const ar = +(ui.ar || ym.slice(0, 4));
  const arene = [...new Set([...S.historikk.map(x => x.ar), ...S.transaksjoner.map(t => +t.dato.slice(0, 4)), +dag.slice(0, 4)])].sort().reverse();
  h += `<div class="rad" style="margin-top:28px"><h2 style="margin:0">Måned for måned</h2><select data-act="velg-ar">${arene.map(a => `<option ${a === ar ? 'selected' : ''}>${a}</option>`).join('')}</select></div>`;
  let sum = { i: 0, f: 0, b: 0, v: 0, r: 0 };
  const rader = [];
  for (let m = 1; m <= 12; m++) {
    const r = manedsrad(ar, m);
    const res = r.variabelt == null ? null : r.inntekt - r.faste - r.variabelt;
    if (r.variabelt != null) { sum.i += r.inntekt; sum.f += r.faste; sum.b += r.budsjett; sum.v += r.variabelt; sum.r += res; }
    rader.push(`<tr><td>${MND[m - 1]}</td><td class="tall skjul-mobil">${kr(r.inntekt)}</td><td class="tall skjul-mobil">${kr(r.faste)}</td><td class="tall">${kr(r.budsjett)}</td><td class="tall">${r.variabelt == null ? '–' : kr(r.variabelt)}</td><td class="tall ${res < 0 ? 'neg' : ''}">${res == null ? '–' : kr(res)}</td></tr>`);
  }
  h += `<div class="panel tabell-wrap"><table><thead><tr><th>Måned</th><th class="tall skjul-mobil">Inntekt</th><th class="tall skjul-mobil">Faste + sparing</th><th class="tall">Budsjett var.</th><th class="tall">Faktisk var.</th><th class="tall">Resultat</th></tr></thead><tbody>${rader.join('')}
  <tr class="sum"><td>Sum ført</td><td class="tall skjul-mobil">${kr(sum.i)}</td><td class="tall skjul-mobil">${kr(sum.f)}</td><td class="tall">${kr(sum.b)}</td><td class="tall">${kr(sum.v)}</td><td class="tall ${sum.r < 0 ? 'neg' : ''}">${kr(sum.r)}</td></tr></tbody></table>
  <p class="note">Måneder uten tall er ikke ført ennå. Måneder fra regnearket bruker tallene derfra.</p></div>`;
  return h;
}

function utfallValg(t, knapper = true) {
  const valg = [
    ...S.poster.map(p => ['fort:' + p.navn, p.navn]),
    ...S.personer.map(p => ['privat:' + p.navn, 'Privat – ' + p.navn]),
    ...UTELATT_GRUNNER.map(g => ['utelatt:' + g, 'Utelatt – ' + g]),
  ];
  if (!knapper) {
    const naa = t.status === 'bekreft' ? 'bekreft:' : utfallsnokkel(t);
    return `<select data-act="sett-utfall" data-id="${t.id}">${t.status === 'bekreft' ? '<option value="bekreft:">– Trenger svar –</option>' : ''}${valg.map(([v, l]) => `<option value="${esc(v)}" ${v === naa ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  }
  return valg;
}
function utfallTekst(u) {
  if (!u) return '';
  const [s, v] = u.split(/:(.*)/s);
  return s === 'fort' ? v : s === 'privat' ? 'Privat – ' + v : 'Utelatt – ' + v;
}

function visSvar() {
  const liste = S.transaksjoner.filter(t => t.status === 'bekreft');
  if (!liste.length) return `<div class="varsel ok">Alt er plassert. Ingenting trenger svar.</div>`;
  const bruk = {};
  for (const t of S.transaksjoner) if (t.status === 'fort') bruk[t.post] = (bruk[t.post] || 0) + 1;
  const topp = S.poster.map(p => p.navn).sort((a, b) => (bruk[b] || 0) - (bruk[a] || 0)).slice(0, 6);
  const medForslag = liste.filter(t => t.forslag).length;
  let h = `<h2>Trenger svar (${liste.length})</h2><p class="note">Det du velger huskes. Neste gang samme butikk dukker opp, føres den automatisk. «Utlegg for andre» gjelder bare den ene transaksjonen.</p>`;
  if (medForslag) h += `<div class="rad"><button class="primar" data-act="godta-alle">Godta alle ${medForslag} forslag</button></div>`;
  h += liste.map(t => `<div class="svar-kort">
    <div class="hode"><div><div class="tekst">${esc(t.tekst)}</div><div class="liten-tekst">${datoNo(t.dato)} · ${esc(kortNavn(t.kort))}${t.sporsmal ? ' · ' + esc(t.sporsmal) : ''}</div>
    ${t.forslag ? `<div class="forslag">Forslag: ${esc(utfallTekst(t.forslag))} <button class="liten" data-act="utfall" data-id="${t.id}" data-u="${esc(t.forslag)}">Godta</button></div>` : ''}</div>
    <div class="verdi ${t.belop < 0 ? 'pos' : ''}" style="font-weight:650">${krD(t.belop)}</div></div>
    <div class="valg">
      ${topp.map(p => `<button class="liten" data-act="utfall" data-id="${t.id}" data-u="${esc('fort:' + p)}">${esc(p)}</button>`).join('')}
      ${S.personer.map(p => `<button class="liten" data-act="utfall" data-id="${t.id}" data-u="${esc('privat:' + p.navn)}">Privat ${esc(p.navn)}</button>`).join('')}
      <button class="liten" data-act="utfall" data-id="${t.id}" data-u="utelatt:Utlegg for andre">Utlegg for andre</button>
      <button class="liten" data-act="utfall" data-id="${t.id}" data-u="utelatt:Jobb">Jobb</button>
      ${utfallValg(t, false)}
      <input placeholder="Merknad (valgfritt)" data-act="merknad" data-id="${t.id}" value="${esc(t.merknad)}" style="flex:1;min-width:140px">
    </div></div>`).join('');
  return h;
}

function visImporter() {
  const kortValg = S.innstillinger.kort.map(k => `<option value="${k.id}">${esc(k.navn)}</option>`).join('');
  let h = `<h2>Last inn kortfaktura</h2>
  <p class="note">Eksporter transaksjonene fra nettbanken (CSV eller Excel) og slipp filene her. Overlappende fakturaer går fint – transaksjoner som allerede er lagt inn, hoppes over.</p>
  <div class="rad"><label>Kort: <select id="imp-kort"><option value="">Gjett fra filnavnet</option>${kortValg}</select></label></div>
  <div id="slipp" class="slipp"><b>Slipp filer her</b> eller klikk for å velge<br><span class="liten-tekst">CSV, XLSX eller XLS</span></div>
  <input type="file" id="fil-input" accept=".csv,.txt,.xlsx,.xls,.ods" multiple hidden>`;
  if (ui.sisteImport) h += `<div class="varsel ${ui.sisteImport.feil ? 'feil' : 'ok'}" style="margin-top:12px">${ui.sisteImport.html}</div>`;
  h += `<h2>Legg inn enkeltutgift</h2><p class="note">For Vipps, kontant eller noe som ikke kommer på kortfakturaen.</p>
  <div class="panel"><div class="rad">
    <input type="date" id="ny-dato" value="${iDag()}">
    <input id="ny-tekst" placeholder="Hva (f.eks. Vipps til barnevakt)" style="flex:1;min-width:160px">
    <input type="number" id="ny-belop" placeholder="Beløp" step="0.01">
    <select id="ny-kort">${S.innstillinger.kort.map(k => `<option value="${k.id}" ${k.id === 'annet' ? 'selected' : ''}>${esc(k.navn)}</option>`).join('')}</select>
    <select id="ny-utfall"><option value="">Plasser automatisk</option>${utfallValg({}, true).map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('')}</select>
    <button class="primar" data-act="ny-utgift">Legg til</button>
  </div><label class="liten-tekst"><input type="checkbox" id="ny-kvittering"> Ta bilde av kvittering etterpå</label></div>`;
  return h;
}
async function importerFiler(filer) {
  const valgt = $('#imp-kort') ? $('#imp-kort').value : '';
  const linjer = []; let feil = false;
  for (const f of filer) {
    try {
      const kort = valgt || gjettKort(f.name);
      if (!kort) { linjer.push(`<b>${esc(f.name)}</b>: velg hvilket kort filen gjelder, og prøv igjen.`); feil = true; continue; }
      const rader = tolkRader(await lesFil(f));
      if (!rader.length) { linjer.push(`<b>${esc(f.name)}</b>: fant ingen transaksjoner.`); feil = true; continue; }
      const r = leggTil(kort, rader);
      const fra = rader.reduce((a, t) => t.dato < a ? t.dato : a, rader[0].dato), til = rader.reduce((a, t) => t.dato > a ? t.dato : a, rader[0].dato);
      linjer.push(`<b>${esc(f.name)}</b> (${esc(kortNavn(kort))}, ${datoNo(fra)}–${datoNo(til)}): ${r.nye} nye, ${r.auto} plassert automatisk, ${r.svar} trenger svar${r.duplikater ? `, ${r.duplikater} fantes fra før` : ''}.`);
    } catch (e) { console.error(e); linjer.push(`<b>${esc(f.name)}</b>: ${esc(e.message)}`); feil = true; }
  }
  const svar = S.transaksjoner.filter(t => t.status === 'bekreft').length;
  ui.sisteImport = { feil, html: linjer.join('<br>') + (svar ? `<br><button class="liten primar" data-act="gaa" data-fane="svar" style="margin-top:6px">Svar på ${svar} transaksjoner</button>` : '') };
  tegn();
}

function visOverforing() {
  const kort = S.innstillinger.kort;
  const nokler = [...new Set(S.transaksjoner.map(t => faktura(t.kort, t.dato).key))].sort().reverse();
  if (!nokler.length) return tomtVarsel();
  const key = ui.faktMnd && nokler.includes(ui.faktMnd) ? ui.faktMnd : nokler[0];
  const iFaktura = t => faktura(t.kort, t.dato).key === key;
  const trans = S.transaksjoner.filter(iFaktura);
  const aktive = kort.filter(k => trans.some(t => t.kort === k.id));
  const poster = [...new Set([...S.poster.map(p => p.navn), ...trans.filter(t => t.status === 'fort').map(t => t.post)])];
  const celle = (post, kid) => trans.filter(t => t.kort === kid && t.status === 'fort' && t.post === post).reduce((s, t) => s + belopFort(t), 0);
  let h = `<div class="rad"><h2 style="margin:0">Overføring per budsjettpost</h2><select data-act="velg-faktura">${nokler.map(k => `<option value="${k}" ${k === key ? 'selected' : ''}>Fakturaer ${mndNavn(k).toLowerCase()}</option>`).join('')}</select></div>
  <p class="note">Beløpet som skal overføres fra hver budsjettkonto for å dekke kortfakturaene. Hver kolonne er én faktura.</p>`;
  const bekreft = trans.filter(t => t.status === 'bekreft').length;
  if (bekreft) h += `<div class="varsel">${bekreft} transaksjoner i disse fakturaene trenger svar før tallene er ferdige. <button class="liten" data-act="gaa" data-fane="svar">Svar nå</button></div>`;
  h += `<div class="panel tabell-wrap"><table><thead><tr><th>Post</th>${aktive.map(k => { const f = fakturaFraKey(k.id, key); return `<th class="tall">${esc(k.navn)}<br><span class="liten-tekst">${datoNo(f.fra)}–${datoNo(f.til)}</span></th>`; }).join('')}<th class="tall">Totalt</th></tr></thead><tbody>`;
  const tot = {}; let totalt = 0;
  for (const p of poster) {
    const verdier = aktive.map(k => celle(p, k.id));
    const sum = verdier.reduce((a, b) => a + b, 0);
    if (!sum) continue;
    aktive.forEach((k, i) => tot[k.id] = (tot[k.id] || 0) + verdier[i]); totalt += sum;
    h += `<tr><td>${esc(p)}</td>${verdier.map(v => `<td class="tall">${v ? krD(v) : '–'}</td>`).join('')}<td class="tall"><b>${krD(sum)}</b></td></tr>`;
  }
  h += `<tr class="sum"><td>Sum husholdning</td>${aktive.map(k => `<td class="tall">${krD(tot[k.id] || 0)}</td>`).join('')}<td class="tall">${krD(totalt)}</td></tr>`;
  for (const p of S.personer) {
    const v = aktive.map(k => trans.filter(t => t.kort === k.id && t.status === 'privat' && t.eier === p.navn).reduce((s, t) => s + t.belop, 0));
    if (v.some(x => x)) h += `<tr><td>Privat ${esc(p.navn)} (betaler selv)</td>${v.map(x => `<td class="tall">${x ? krD(x) : '–'}</td>`).join('')}<td class="tall">${krD(v.reduce((a, b) => a + b, 0))}</td></tr>`;
  }
  const ut = aktive.map(k => trans.filter(t => t.kort === k.id && t.status === 'utelatt' && t.grunn !== 'Innbetaling').reduce((s, t) => s + t.belop, 0));
  if (ut.some(x => x)) h += `<tr><td>Utelatt (jobb, utlegg, refusjon)</td>${ut.map(x => `<td class="tall">${x ? krD(x) : '–'}</td>`).join('')}<td class="tall">${krD(ut.reduce((a, b) => a + b, 0))}</td></tr>`;
  h += `<tr><td>Overført?</td>${aktive.map(k => { const n = `${k.id}:${key}`; const d = S.overfort[n]; return `<td class="tall"><label><input type="checkbox" data-act="overfort" data-n="${n}" ${d ? 'checked' : ''}> ${d ? datoNo(d) : ''}</label></td>`; }).join('')}<td></td></tr>`;
  h += `</tbody></table></div>`;
  const uteListe = trans.filter(t => t.status === 'utelatt' && t.grunn !== 'Innbetaling');
  if (uteListe.length) h += `<h3>Utelatt fra husholdningen</h3><div class="panel tabell-wrap">${transTabell(uteListe, false)}</div>`;
  return h;
}

function transTabell(liste, redigerbar = true) {
  if (!liste.length) return '<p class="muted">Ingen transaksjoner.</p>';
  return `<table><thead><tr><th>Dato</th><th>Tekst</th><th class="skjul-mobil">Kort</th><th class="tall">Beløp</th><th>Plassering</th><th class="skjul-mobil">Merknad</th><th></th></tr></thead><tbody>${liste.map(t => `<tr>
    <td style="white-space:nowrap">${datoNo(t.dato)}</td><td>${esc(t.tekst)}</td><td class="skjul-mobil">${esc(kortNavn(t.kort))}</td>
    <td class="tall">${krD(t.belop)}${t.status === 'fort' && t.fort != null && t.fort !== t.belop ? `<br><span class="liten-tekst">ført ${krD(t.fort)}</span>` : ''}</td>
    <td>${redigerbar ? utfallValg(t, false) : `<span class="chip ${t.status}">${esc(t.status === 'bekreft' ? 'Trenger svar' : utfallTekst(utfallsnokkel(t)))}</span>`}</td>
    <td class="skjul-mobil">${redigerbar ? `<input data-act="merknad" data-id="${t.id}" value="${esc(t.merknad)}" style="width:100%;min-width:120px">` : esc(t.merknad)}</td>
    <td style="white-space:nowrap">
      <button class="ikon-knapp" title="${t.kvittering ? 'Vis kvittering' : 'Legg til kvittering'}" data-act="${t.kvittering ? 'vis-kv' : 'ny-kv'}" data-id="${t.id}">${t.kvittering ? '🧾' : '📎'}</button>
      ${redigerbar ? `<button class="ikon-knapp" title="Før bare en del av beløpet" data-act="delvis" data-id="${t.id}">½</button>` : ''}
      ${redigerbar && t.kilde === 'manuell' ? `<button class="ikon-knapp" title="Slett" data-act="slett-trans" data-id="${t.id}">🗑</button>` : ''}
    </td></tr>`).join('')}</tbody></table>`;
}
function visTransaksjoner() {
  const f = ui.filter;
  const mnder = [...new Set(S.transaksjoner.map(t => t.dato.slice(0, 7)))].sort().reverse();
  let liste = S.transaksjoner.filter(t =>
    (!f.kort || t.kort === f.kort) && (!f.mnd || t.dato.startsWith(f.mnd)) &&
    (!f.status || t.status === f.status) && (!f.post || t.post === f.post) &&
    (!f.sok || (t.tekst + ' ' + (t.merknad || '')).toLowerCase().includes(f.sok.toLowerCase()))).slice().reverse();
  const sum = liste.reduce((s, t) => s + t.belop, 0);
  const vis = liste.slice(0, 300);
  return `<h2>Transaksjoner</h2><div class="rad">
    <input type="search" placeholder="Søk" data-act="filter" data-f="sok" value="${esc(f.sok)}">
    <select data-act="filter" data-f="mnd"><option value="">Alle måneder</option>${mnder.map(m => `<option value="${m}" ${f.mnd === m ? 'selected' : ''}>${mndNavn(m)}</option>`).join('')}</select>
    <select data-act="filter" data-f="kort"><option value="">Alle kort</option>${S.innstillinger.kort.map(k => `<option value="${k.id}" ${f.kort === k.id ? 'selected' : ''}>${esc(k.navn)}</option>`).join('')}</select>
    <select data-act="filter" data-f="status"><option value="">Alle typer</option>${[['fort', 'Ført på budsjett'], ['privat', 'Privat'], ['utelatt', 'Utelatt'], ['bekreft', 'Trenger svar']].map(([v, l]) => `<option value="${v}" ${f.status === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
    <select data-act="filter" data-f="post"><option value="">Alle poster</option>${S.poster.map(p => `<option ${f.post === p.navn ? 'selected' : ''}>${esc(p.navn)}</option>`).join('')}</select>
  </div><p class="note">${liste.length} transaksjoner, sum ${krD(sum)} kr${liste.length > vis.length ? ` – viser de ${vis.length} nyeste` : ''}. Endrer du plassering, lærer appen det til neste gang.</p>
  <div class="panel tabell-wrap">${transTabell(vis)}</div>`;
}

function visBudsjett() {
  const inntekt = sumGruppe('Inntekt'), faste = sumGruppe('Fast kostnad'), sparing = sumGruppe('Sparing'), variabelt = variabeltBudsjett();
  const rest = inntekt - faste - sparing - variabelt;
  let h = `<h2>Budsjett per måned</h2><div class="kpier">
    <div class="kpi"><div class="lbl">Inntekt</div><div class="verdi">${kr(inntekt)}</div></div>
    <div class="kpi"><div class="lbl">Faste kostnader</div><div class="verdi">${kr(faste)}</div></div>
    <div class="kpi"><div class="lbl">Sparing</div><div class="verdi">${kr(sparing)}</div></div>
    <div class="kpi"><div class="lbl">Variabelt budsjett</div><div class="verdi">${kr(variabelt)}</div></div>
    <div class="kpi"><div class="lbl">Til overs</div><div class="verdi ${rest < 0 ? 'neg' : 'pos'}">${kr(rest)}</div></div></div>`;
  h += `<h2>Variable poster (kortbetalt)</h2><div class="panel tabell-wrap"><table><thead><tr><th>Post</th><th class="tall">Budsjett/mnd</th><th class="tall skjul-mobil">Snitt 2026</th><th></th></tr></thead><tbody>
    ${S.poster.map((p, i) => `<tr><td><input value="${esc(p.navn)}" data-act="post-navn" data-i="${i}" style="width:100%"></td><td class="tall"><input type="number" value="${p.budsjett}" data-act="post-belop" data-i="${i}"></td><td class="tall skjul-mobil">${p.snitt2026 != null ? kr(p.snitt2026) : ''}</td><td><button class="ikon-knapp" data-act="slett-post" data-i="${i}" title="Fjern">✕</button></td></tr>`).join('')}
    </tbody></table><button class="liten" data-act="ny-post" style="margin-top:8px">+ Ny post</button></div>`;
  for (const g of ['Inntekt', 'Fast kostnad', 'Sparing']) {
    const rader = S.faste.map((f, i) => [f, i]).filter(([f]) => f.gruppe === g);
    h += `<h2>${g === 'Fast kostnad' ? 'Faste kostnader' : g}</h2><div class="panel tabell-wrap"><table><tbody>
      ${rader.map(([f, i]) => `<tr><td><input value="${esc(f.post)}" data-act="fast-post" data-i="${i}" style="width:100%"></td><td class="tall"><input type="number" value="${f.belop}" data-act="fast-belop" data-i="${i}"></td><td class="skjul-mobil"><input value="${esc(f.merknad)}" data-act="fast-merknad" data-i="${i}" placeholder="Merknad" style="width:100%"></td><td><button class="ikon-knapp" data-act="slett-fast" data-i="${i}" title="Fjern">✕</button></td></tr>`).join('')}
      <tr class="sum"><td>Sum</td><td class="tall">${kr(sumGruppe(g))}</td><td colspan="2"></td></tr></tbody></table>
      <button class="liten" data-act="ny-fast" data-g="${g}" style="margin-top:8px">+ Ny linje</button></div>`;
  }
  h += `<h2>Personer og 15 %-ramme</h2><p class="note">Lønn som går til husholdningen (85 %). Rammen for private utgifter regnes som lønn × 15/85.</p><div class="panel tabell-wrap"><table><thead><tr><th>Navn</th><th class="tall">Lønn til husholdning</th><th class="tall">Ramme/mnd</th><th></th></tr></thead><tbody>
    ${S.personer.map((p, i) => `<tr><td><input value="${esc(p.navn)}" data-act="person-navn" data-i="${i}"></td><td class="tall"><input type="number" value="${p.lonn}" data-act="person-lonn" data-i="${i}"></td><td class="tall">${kr(ramme(p))}</td><td><button class="ikon-knapp" data-act="slett-person" data-i="${i}">✕</button></td></tr>`).join('')}
    </tbody></table><button class="liten" data-act="ny-person" style="margin-top:8px">+ Ny person</button></div>`;
  return h;
}

function visArkiv() {
  if (!S.ekstra.length && !S.historikk.length) return `<p class="muted">Ingen arkivdata. Arkivet fylles fra startdata-filen.</p>`;
  const tabell = rader => {
    if (!rader.length) return '';
    const kol = [...new Set(rader.flatMap(r => Object.keys(r)))];
    return `<table><thead><tr>${kol.map(k => `<th>${esc(k.replace(/_/g, ' '))}</th>`).join('')}</tr></thead><tbody>${rader.map(r => `<tr>${kol.map(k => typeof r[k] === 'number' ? `<td class="tall">${kr(r[k], Number.isInteger(r[k]) ? 0 : 2)}</td>` : `<td>${esc(r[k])}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  };
  return `<p class="note">Oversikter fra utgangspunktet (dashbordet). Til oppslag – de oppdateres ikke automatisk.</p>` +
    S.ekstra.map(e => `<h2>${esc(e.tittel)}</h2><div class="panel tabell-wrap">${tabell(e.rader || [])}</div>`).join('') +
    (S.historikk.length ? `<h2>Måneder fra regnearket</h2><div class="panel tabell-wrap">${tabell(S.historikk)}</div>` : '');
}

function visInnstillinger() {
  const i = S.innstillinger;
  return visSynkPanel() + `<h2>Backup</h2><p class="note">${synkPa() ? 'Dataene deles via felles lagring. En backup-fil er likevel lurt å ha.' : 'Alt ligger bare i denne nettleseren.'} Ta backup jevnlig, og bruk backup-filen for å flytte til en annen maskin eller telefon.</p>
  <div class="panel"><div class="rad"><button class="primar" data-act="backup">Last ned backup</button><button data-act="last-backup">Last inn backup / startdata</button></div>
  <p class="liten-tekst">Siste backup: ${i.sisteBackup ? datoNo(i.sisteBackup.slice(0, 10)) : 'aldri'} · ${S.transaksjoner.length} transaksjoner</p></div>
  <h2>Generelt</h2><div class="panel">
    <div class="rad"><label>Navn på appen <input value="${esc(i.navn)}" data-act="innst" data-k="navn"></label></div>
    <div class="rad"><label style="flex:1">Spør alltid ved (f.eks. privat eller jobb) <input value="${esc(i.sporAlltid)}" data-act="innst" data-k="sporAlltid" style="width:100%"></label></div>
    <p class="liten-tekst">Ord skilt med | . Gjelder transaksjoner der teksten inneholder ett av ordene.</p></div>
  <h2>Kort og fakturaperioder</h2><div class="panel tabell-wrap"><table><thead><tr><th>Kort</th><th class="tall">Periode starter dag</th><th>Gjenkjenn filnavn (ord skilt med |)</th></tr></thead><tbody>
    ${i.kort.map((k, n) => `<tr><td><input value="${esc(k.navn)}" data-act="kort" data-n="${n}" data-k="navn"></td><td class="tall"><input type="number" min="1" max="28" value="${k.startdag}" data-act="kort" data-n="${n}" data-k="startdag" style="width:70px"></td><td><input value="${esc(k.monster)}" data-act="kort" data-n="${n}" data-k="monster" style="width:100%"></td></tr>`).join('')}
  </tbody></table><p class="liten-tekst">Amex: perioden går fra den 20. til den 19. Kort med dag 1 følger kalendermåneden.</p></div>
  <h2>Faresone</h2><div class="panel"><button class="fare" data-act="slett-alt">Slett alle data i denne nettleseren</button></div>`;
}

/* ---------- handlinger ---------- */
function finnT(id) { return S.transaksjoner.find(t => t.id === id); }
function settUtfall(id, u) {
  const t = finnT(id); if (!t) return;
  if (u === 'bekreft:') { t.status = 'bekreft'; t.post = ''; delete t.eier; delete t.grunn; }
  else brukUtfall(t, u);
  // lær: plasser andre ubesvarte med samme butikk på nytt
  const k = nokkel(t.tekst);
  let flere = 0;
  if (k) for (const x of S.transaksjoner) if (x.status === 'bekreft' && x !== t && nokkel(x.tekst) === k) { plasser(x); if (x.status !== 'bekreft') flere++; }
  lagre();
  if (flere) toast(`${flere} lignende ble plassert automatisk`);
}
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-act], #faner button'); if (!b) return;
  if (b.dataset.fane && !b.dataset.act) { fane = b.dataset.fane; ui.sisteImport = null; tegn(); window.scrollTo(0, 0); return; }
  const a = b.dataset.act, id = b.dataset.id, i = +b.dataset.i;
  switch (a) {
    case 'gaa': fane = b.dataset.fane; tegn(); window.scrollTo(0, 0); break;
    case 'utfall': settUtfall(id, b.dataset.u); tegn(); break;
    case 'godta-alle': { let n = 0; for (const t of S.transaksjoner.filter(t => t.status === 'bekreft' && t.forslag)) { brukUtfall(t, t.forslag); n++; } lagre(); toast(`${n} forslag godtatt`); tegn(); break; }
    case 'delvis': {
      const t = finnT(id); if (!t) break;
      if (t.status !== 'fort') { toast('Velg en budsjettpost først'); break; }
      const v = prompt(`Hvor mye av ${krD(t.belop)} kr skal føres på ${t.post}?`, String(t.fort ?? t.belop).replace('.', ','));
      if (v == null) break; const n = tilTall(v); if (isNaN(n)) break;
      if (n === t.belop) delete t.fort; else t.fort = n; lagre(); tegn(); break;
    }
    case 'slett-trans': if (confirm('Slette denne utgiften?')) { S.transaksjoner = S.transaksjoner.filter(t => t.id !== id); lagre(); tegn(); } break;
    case 'ny-kv': ui.kvitteringFor = id; $('#kvittering-input').click(); break;
    case 'vis-kv': visKvittering(id); break;
    case 'ny-utgift': {
      const dato = $('#ny-dato').value, tekst = $('#ny-tekst').value.trim(), belop = tilTall($('#ny-belop').value);
      if (!dato || !tekst || isNaN(belop)) { toast('Fyll inn dato, tekst og beløp'); break; }
      const u = $('#ny-utfall').value;
      leggTil($('#ny-kort').value, [{ dato, tekst, belop, utfall: u || null }], 'manuell');
      const ny = S.transaksjoner.filter(t => t.kilde === 'manuell' && t.tekst === tekst && t.dato === dato).pop();
      toast(ny && ny.status === 'bekreft' ? 'Lagt til – trenger svar' : 'Lagt til');
      if ($('#ny-kvittering').checked && ny) { ui.kvitteringFor = ny.id; $('#kvittering-input').click(); }
      tegn(); break;
    }
    case 'backup': await lastNedBackup(); break;
    case 'last-backup': velgBackup(); break;
    case 'slett-alt': if (confirm('Slette ALLE data i denne nettleseren? Ta backup først hvis du er usikker.')) { localStorage.removeItem(LAGRINGSNOKKEL); await kvTom(); S = tomTilstand(); nyttBilde(); tegn(); } break;
    case 'ny-post': S.poster.push({ navn: 'Ny post', budsjett: 0 }); lagre(); tegn(); break;
    case 'slett-post': if (confirm(`Fjerne posten «${S.poster[i].navn}»? Transaksjoner beholdes.`)) { S.poster.splice(i, 1); lagre(); tegn(); } break;
    case 'ny-fast': S.faste.push({ gruppe: b.dataset.g, post: '', belop: 0, merknad: '' }); lagre(); tegn(); break;
    case 'slett-fast': S.faste.splice(i, 1); lagre(); tegn(); break;
    case 'ny-person': S.personer.push({ navn: 'Navn', lonn: 0 }); lagre(); tegn(); break;
    case 'slett-person': S.personer.splice(i, 1); lagre(); tegn(); break;
  }
});
document.addEventListener('change', e => {
  const el = e.target, a = el.dataset && el.dataset.act; if (!a) return;
  const i = +el.dataset.i, v = el.value;
  switch (a) {
    case 'sett-utfall': settUtfall(el.dataset.id, v); tegn(); break;
    case 'merknad': { const t = finnT(el.dataset.id); if (t) { t.merknad = v; lagre(); } break; }
    case 'velg-mnd': ui.mnd = v; ui.ar = null; tegn(); break;
    case 'velg-ar': ui.ar = v; tegn(); break;
    case 'velg-faktura': ui.faktMnd = v; tegn(); break;
    case 'overfort': if (el.checked) S.overfort[el.dataset.n] = iDag(); else delete S.overfort[el.dataset.n]; lagre(); tegn(); break;
    case 'filter': ui.filter[el.dataset.f] = v; tegn(); if (el.dataset.f === 'sok') { const s = document.querySelector('[data-f=sok]'); s.focus(); s.setSelectionRange(s.value.length, s.value.length); } break;
    case 'post-navn': { const gammel = S.poster[i].navn, ny = v.trim(); if (!ny) break; S.poster[i].navn = ny; for (const t of S.transaksjoner) { if (t.post === gammel) t.post = ny; if (t.forslag === 'fort:' + gammel) t.forslag = 'fort:' + ny; } lagre(); tegn(); break; }
    case 'post-belop': S.poster[i].budsjett = tilTall(v) || 0; lagre(); tegn(); break;
    case 'fast-post': S.faste[i].post = v; lagre(); break;
    case 'fast-belop': S.faste[i].belop = tilTall(v) || 0; lagre(); tegn(); break;
    case 'fast-merknad': S.faste[i].merknad = v; lagre(); break;
    case 'person-navn': { const g = S.personer[i].navn; S.personer[i].navn = v; for (const t of S.transaksjoner) if (t.eier === g) t.eier = v; lagre(); tegn(); break; }
    case 'person-lonn': S.personer[i].lonn = tilTall(v) || 0; lagre(); tegn(); break;
    case 'innst': S.innstillinger[el.dataset.k] = v; lagre(); tegn(); break;
    case 'kort': { const k = S.innstillinger.kort[+el.dataset.n]; k[el.dataset.k] = el.dataset.k === 'startdag' ? Math.max(1, Math.min(28, +v || 1)) : v; lagre(); tegn(); break; }
  }
});
document.addEventListener('input', e => {
  if (e.target.dataset && e.target.dataset.act === 'filter' && e.target.dataset.f === 'sok') {
    clearTimeout(document.sokT); document.sokT = setTimeout(() => e.target.dispatchEvent(new Event('change', { bubbles: true })), 350);
  }
});

/* ---------- kvitteringer ---------- */
function komprimer(fil) {
  return new Promise((ok, feil) => {
    if (!fil.type.startsWith('image/')) { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = feil; r.readAsDataURL(fil); return; }
    const img = new Image(); const url = URL.createObjectURL(fil);
    img.onload = () => {
      const maks = 1600, s = Math.min(1, maks / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
      ok(c.toDataURL('image/jpeg', 0.8));
    };
    img.onerror = feil; img.src = url;
  });
}
document.getElementById('kvittering-input').addEventListener('change', async e => {
  const fil = e.target.files[0]; e.target.value = '';
  const t = finnT(ui.kvitteringFor); if (!fil || !t) return;
  try { await kvSett(t.id, await komprimer(fil)); t.kvittering = true; lagre(); toast('Kvittering lagret'); tegn(); }
  catch (err) { toast('Kunne ikke lagre kvitteringen: ' + err.message); }
});
async function visKvittering(id) {
  let data = await kvHent(id);
  if (!data && synkPa()) { toast('Henter kvittering …'); try { data = await hentDeltKvittering(id); } catch (e) { toast(e.message); return; } }
  if (!data) { toast('Fant ikke kvitteringen'); return; }
  if (data.startsWith('data:application/pdf')) { const w = window.open(); if (w) w.document.write(`<iframe src="${data}" style="border:0;width:100%;height:100vh"></iframe>`); return; }
  const d = $('#bilde-dialog'); d.querySelector('img').src = data; d.showModal();
}

/* ---------- backup ---------- */
async function lastNedBackup() {
  let kv = {}; try { kv = await kvAlle(); } catch (e) { }
  S.innstillinger.sisteBackup = new Date().toISOString(); lagre();
  const blob = new Blob([JSON.stringify(Object.assign({}, S, { kvitteringer: kv }))], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = `okonomi-${iDag()}.backup.json`; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast('Backup lastet ned'); tegn();
}
function velgBackup() {
  const inn = document.createElement('input'); inn.type = 'file'; inn.accept = '.json,application/json';
  inn.onchange = async () => {
    const f = inn.files[0]; if (!f) return;
    try {
      const d = JSON.parse(await f.text());
      if (!d || d.app !== 'husholdningsbudsjett') throw new Error('Dette ser ikke ut som en backup fra appen.');
      if (S.transaksjoner.length && !confirm('Dette erstatter dataene som ligger her nå. Fortsette?')) return;
      const kv = d.kvitteringer || {}; delete d.kvitteringer;
      S = normaliser(d); nyttBilde(); lagreLokalt(); planleggSynk();
      for (const [id, v] of Object.entries(kv)) await kvSett(id, v);
      toast(`Lastet inn ${S.transaksjoner.length} transaksjoner`); fane = 'oversikt'; tegn();
    } catch (e) { alert('Kunne ikke lese filen: ' + e.message); }
  };
  inn.click();
}

/* ---------- felles lagring i et privat GitHub-repo ---------- */
const SYNK_NOKKEL = 'husholdningsokonomi-synk';
let synk = (() => { try { return JSON.parse(localStorage.getItem(SYNK_NOKKEL)) || {}; } catch (e) { return {}; } })();
const lagreSynk = () => { try { localStorage.setItem(SYNK_NOKKEL, JSON.stringify(synk)); } catch (e) { } };
const synkPa = () => !!(synk.token && synk.repo);
let synkPagar = null, synkIgjen = false, synkTimer = null, venterTegning = false;

function settSynkStatus(tekst, feil = false) {
  synk.status = tekst; synk.feil = feil;
  const el = $('#synk-status'); if (!el) return;
  el.hidden = !synkPa(); el.textContent = tekst; el.classList.toggle('feil', feil);
}
function planleggSynk() { if (!synkPa()) return; clearTimeout(synkTimer); synkTimer = setTimeout(synkroniser, 1500); }

const b64Inn = str => { const b = new TextEncoder().encode(str); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };
const b64Ut = b => new TextDecoder().decode(Uint8Array.from(atob(String(b).replace(/\s/g, '')), c => c.charCodeAt(0)));
function stabil(v) {
  if (Array.isArray(v)) return '[' + v.map(stabil).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => JSON.stringify(k) + ':' + stabil(v[k])).join(',') + '}';
  return JSON.stringify(v);
}
async function ghKall(sti, opt = {}) {
  const r = await fetch(`https://api.github.com/repos/${synk.repo}/contents/${sti}${opt.method ? '' : '?t=' + Date.now()}`, {
    ...opt, cache: 'no-store',
    headers: { Authorization: `Bearer ${synk.token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(opt.headers || {}) },
  });
  if (r.status === 401) throw new Error('Nøkkelen virker ikke lenger (utløpt eller slettet). Lag en ny under Innstillinger.');
  if (r.status === 403 || (r.status === 404 && opt.method)) throw new Error('Nøkkelen har ikke tilgang til ' + synk.repo + '. Sjekk at repoet er valgt og at Contents er «Read and write».');
  return r;
}
async function hentFjern(sti = 'data.json') {
  const r = await ghKall(sti);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('GitHub svarte ' + r.status);
  const j = await r.json();
  let tekst = j.content ? b64Ut(j.content) : await (await ghKall(sti, { headers: { Accept: 'application/vnd.github.raw' } })).text();
  return { tekst, sha: j.sha };
}
async function skrivFjern(sti, tekst, sha, melding) {
  const r = await ghKall(sti, { method: 'PUT', body: JSON.stringify({ message: melding, content: b64Inn(tekst), ...(sha ? { sha } : {}) }) });
  if (r.status === 409 || r.status === 422) return null; // noen andre skrev samtidig
  if (!r.ok) throw new Error('GitHub svarte ' + r.status + ' ved lagring');
  return (await r.json()).content.sha;
}
function slaSammen(a, b) {
  const ut = JSON.parse(JSON.stringify(a));
  const ea = a.endret || {}, eb = b.endret || {};
  ut.endret = {};
  for (const k of SEKSJONER) {
    if ((eb[k] || 0) > (ea[k] || 0) && b[k] !== undefined) { ut[k] = JSON.parse(JSON.stringify(b[k])); ut.endret[k] = eb[k]; }
    else ut.endret[k] = ea[k] || 0;
  }
  ut.slettet = Object.assign({}, a.slettet || {});
  for (const [id, t] of Object.entries(b.slettet || {})) ut.slettet[id] = Math.max(ut.slettet[id] || 0, t);
  const m = new Map((a.transaksjoner || []).map(t => [t.id, t]));
  for (const t of b.transaksjoner || []) { const x = m.get(t.id); if (!x || (t.endret || 0) > (x.endret || 0)) m.set(t.id, JSON.parse(JSON.stringify(t))); }
  ut.transaksjoner = [...m.values()].filter(t => !(ut.slettet[t.id] && ut.slettet[t.id] >= (t.endret || 0)));
  return normaliser(ut);
}
function tegnHvisLedig() {
  const a = document.activeElement;
  if (a && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName) && a.closest('#innhold')) { venterTegning = true; return; }
  venterTegning = false; tegn();
}
document.addEventListener('focusout', () => setTimeout(() => { if (venterTegning) tegnHvisLedig(); }, 300));

function synkroniser() {
  if (!synkPa()) return Promise.resolve();
  if (synkPagar) { synkIgjen = true; return synkPagar; }
  synkPagar = (async () => {
    try {
      settSynkStatus('Synkroniserer…');
      for (let forsok = 0; forsok < 5; forsok++) {
        const fjern = await hentFjern();
        let fjernData = null;
        if (fjern) { try { fjernData = normaliser(JSON.parse(fjern.tekst)); } catch (e) { throw new Error('Den felles datafilen er ødelagt.'); } }
        if (fjernData) {
          const sammen = slaSammen(S, fjernData);
          if (stabil(sammen) !== stabil(S)) { S = sammen; nyttBilde(); lagreLokalt(); tegnHvisLedig(); }
        }
        if (fjernData && stabil(fjernData) === stabil(S)) { synk.sha = fjern.sha; break; }
        const sha = await skrivFjern('data.json', JSON.stringify(S), fjern && fjern.sha, 'Oppdatert fra ' + (synk.enhet || 'appen'));
        if (sha) { synk.sha = sha; break; }
      }
      synk.sist = new Date().toISOString(); lagreSynk();
      const t = new Date(); settSynkStatus(`Synkronisert ${pad(t.getHours())}:${pad(t.getMinutes())}`);
      lastOppKvitteringer();
    } catch (e) {
      console.error(e); settSynkStatus('Synk feilet', true); synk.sisteFeil = e.message; lagreSynk();
      if (fane === 'innstillinger') tegnHvisLedig();
    } finally {
      synkPagar = null;
      if (synkIgjen) { synkIgjen = false; setTimeout(synkroniser, 200); }
    }
  })();
  return synkPagar;
}
async function lastOppKvitteringer() {
  for (const t of S.transaksjoner.filter(t => t.kvittering && !t.kvitteringDelt)) {
    try {
      const data = await kvHent(t.id); if (!data) continue;
      const fjern = await hentFjern(`kvitteringer/${t.id}.txt`);
      if (!fjern) await skrivFjern(`kvitteringer/${t.id}.txt`, data, null, 'Kvittering');
      t.kvitteringDelt = true; lagre();
    } catch (e) { console.error(e); return; }
  }
}
async function hentDeltKvittering(id) {
  if (!synkPa()) return null;
  const f = await hentFjern(`kvitteringer/${id}.txt`);
  if (f) await kvSett(id, f.tekst);
  return f ? f.tekst : null;
}
async function kobleTil(repo, token) {
  repo = String(repo || '').trim().replace(/^https?:\/\/github\.com\//, '').replace(/\/$/, '');
  token = String(token || '').trim();
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !token) { toast('Fyll inn både repo og nøkkel'); return; }
  synk = { repo, token, enhet: /iphone|ipad|android/i.test(navigator.userAgent) ? 'telefon' : 'datamaskin' }; lagreSynk();
  await synkroniser();
  if (synk.feil) { toast(synk.sisteFeil || 'Kunne ikke koble til'); }
  else toast('Koblet til felles lagring');
  fane = 'innstillinger'; tegn();
}
const oppsettkode = () => btoa(JSON.stringify({ r: synk.repo, t: synk.token }));
function lesOppsettkode(kode) { try { const o = JSON.parse(atob(String(kode).trim())); return o.r && o.t ? o : null; } catch (e) { return null; } }
function standardRepo() { const h = location.hostname; return h.endsWith('.github.io') ? h.split('.')[0] + '/mediakit-data' : ''; }

function visSynkPanel() {
  if (synkPa()) {
    return `<h2>Felles lagring</h2><div class="panel">
      <p><b>${synk.feil ? '⚠️ ' + esc(synk.sisteFeil || 'Synk feilet') : '✅ Koblet til'}</b> – data deles via det private repoet <code>${esc(synk.repo)}</code>.</p>
      <p class="liten-tekst">Sist synkronisert: ${synk.sist ? new Date(synk.sist).toLocaleString('nb-NO') : 'aldri'}. Appen synkroniserer når den åpnes og når noe endres.</p>
      <div class="rad"><button class="primar" data-act="synk-naa">Synkroniser nå</button><button data-act="vis-kode">Koble til en annen telefon</button><button class="fare" data-act="koble-fra">Koble fra</button></div>
      ${ui.visKode ? `<div class="varsel"><p>Åpne appen på den andre telefonen, gå til <b>Innstillinger → Felles lagring</b> og lim inn denne koden. Send den bare til den som skal bruke appen, den gir tilgang til dataene.</p>
        <div class="rad"><input readonly value="${esc(oppsettkode())}" style="flex:1" id="kode-felt"><button data-act="kopier-kode">Kopier</button></div></div>` : ''}
    </div>`;
  }
  const lenke = 'https://github.com/settings/personal-access-tokens/new?name=Husholdningsokonomi&description=' + encodeURIComponent('Felles lagring for budsjettappen') + '&contents=write';
  return `<h2>Felles lagring (deling mellom telefoner)</h2><div class="panel">
    <p>Koble appen til et privat GitHub-repo, så ser alle telefonene de samme tallene og kvitteringene.</p>
    <h3>Har du en kode fra den andre telefonen?</h3>
    <div class="rad"><input id="oppsett-kode" placeholder="Lim inn oppsettkoden" style="flex:1"><button class="primar" data-act="bruk-kode">Koble til</button></div>
    <h3>Første gang (gjøres én gang)</h3>
    <ol class="liten-tekst" style="font-size:.9rem;color:var(--fg)">
      <li><a href="${lenke}" target="_blank" rel="noopener">Åpne GitHub for å lage en nøkkel</a>.</li>
      <li>Under <b>Expiration</b>: velg <b>No expiration</b> (eller lengst mulig).</li>
      <li>Under <b>Repository access</b>: velg <b>Only select repositories</b> og velg <b>mediakit-data</b>.</li>
      <li>Under <b>Permissions → Contents</b>: sjekk at det står <b>Read and write</b>.</li>
      <li>Trykk <b>Generate token</b>, kopier nøkkelen og lim den inn her:</li>
    </ol>
    <div class="rad"><input id="synk-repo" value="${esc(standardRepo())}" placeholder="brukernavn/mediakit-data"><input id="synk-token" type="password" placeholder="Nøkkel (github_pat_…)" style="flex:1" autocomplete="off"><button class="primar" data-act="koble-til">Koble til</button></div>
    <p class="liten-tekst">Det som ligger på denne telefonen nå, slås sammen med det som allerede er delt. Ingenting blir borte.</p>
  </div>`;
}

document.addEventListener('click', async e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  switch (b.dataset.act) {
    case 'koble-til': await kobleTil($('#synk-repo').value, $('#synk-token').value); break;
    case 'bruk-kode': { const o = lesOppsettkode($('#oppsett-kode').value); if (!o) { toast('Koden ser ikke riktig ut'); break; } await kobleTil(o.r, o.t); break; }
    case 'synk-naa': await synkroniser(); tegn(); break;
    case 'vis-kode': ui.visKode = !ui.visKode; tegn(); break;
    case 'kopier-kode': try { await navigator.clipboard.writeText(oppsettkode()); toast('Kopiert'); } catch (err) { $('#kode-felt').select(); } break;
    case 'koble-fra': if (confirm('Koble fra felles lagring på denne enheten? Dataene her beholdes, men endringer deles ikke lenger.')) { synk = {}; lagreSynk(); settSynkStatus(''); tegn(); } break;
  }
});
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') synkroniser(); });
setInterval(() => { if (document.visibilityState === 'visible') synkroniser(); }, 60000);

nyttBilde();
tegn();
settSynkStatus(synkPa() ? 'Synkroniserer…' : '');
synkroniser();
