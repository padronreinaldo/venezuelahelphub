#!/usr/bin/env node
/**
 * fetch.js — actualiza data/updates.json y data/news.json desde fuentes legítimas.
 * Diseñado para correr cada hora (ver .github/workflows/fetch.yml). Sin dependencias:
 * usa fetch() nativo de Node 20.
 *
 * Reglas (acordadas):
 *  - Solo fuentes legítimas (USGS, ReliefWeb/OCHA, prensa venezolana por RSS).
 *  - Sin aprobación humana: si viene de una fuente de la lista, entra.
 *  - Siempre se conserva el enlace a la fuente original.
 *  - Si una fuente falla o no devuelve nada, NO se sobreescribe el archivo (se conserva lo anterior).
 *
 * TODO opcional: traducir titleEn/sumEn con un servicio de traducción. Por ahora,
 * para ítems en español se reutiliza el texto original como titleEn/sumEn.
 */
const fs = require("fs");
const path = require("path");

const OUT_DIR = path.join(__dirname, "..", "data");
const UA = "venezuela-relief-hub/1.0 (+https://venezuelareliefhub.org)";
const KEYWORDS = /(sismo|terremoto|earthquake|réplica|replica|temblor)/i;

const get = async (url, type = "json") => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000); // 15s por fuente
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "*/*" }, signal: ctrl.signal });
    if (!r.ok) throw new Error(`${r.status} ${url}`);
    return type === "json" ? await r.json() : await r.text();
  } finally {
    clearTimeout(timer);
  }
};

/* ---------- 1) USGS: sismos recientes cerca de Venezuela ---------- */
async function fetchUSGS() {
  const start = new Date(Date.now() - 3 * 864e5).toISOString().slice(0, 10);
  const url =
    "https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson" +
    "&latitude=10.5&longitude=-68.5&maxradiuskm=600&minmagnitude=4.5" +
    `&starttime=${start}&orderby=magnitude`;
  const j = await get(url);
  return (j.features || []).slice(0, 4).map((f) => {
    const p = f.properties, mag = p.mag?.toFixed(1);
    const titleEs = `Sismo M${mag}: ${p.place}`;
    return {
      sourceEs: "USGS", sourceEn: "USGS",
      date: new Date(p.time).toISOString().slice(0, 10),
      titleEs, titleEn: `M${mag} earthquake: ${p.place}`,
      sumEs: `El USGS reporta un sismo de magnitud ${mag}. ${p.place}.`,
      sumEn: `USGS reports a magnitude ${mag} earthquake. ${p.place}.`,
      areas: [], needsEs: ["Evaluación de daños"], needsEn: ["Damage assessment"],
      url: p.url,
    };
  });
}

/* ---------- 2) ReliefWeb / OCHA ---------- */
async function fetchReliefWeb() {
  const url =
    "https://api.reliefweb.int/v1/reports?appname=venezuela-relief-hub" +
    "&query[value]=Venezuela%20earthquake&query[operator]=AND" +
    "&sort[]=date:desc&limit=6" +
    "&fields[include][]=title&fields[include][]=url_alias&fields[include][]=source.name&fields[include][]=date.created";
  const j = await get(url);
  return (j.data || []).map((d) => {
    const f = d.fields || {};
    const src = (f.source && f.source[0] && f.source[0].name) || "ReliefWeb";
    return {
      sourceEs: src, sourceEn: src,
      date: (f.date?.created || "").slice(0, 10),
      titleEs: f.title, titleEn: f.title,
      sumEs: "Reporte de situación publicado en ReliefWeb (OCHA).",
      sumEn: "Situation report published on ReliefWeb (OCHA).",
      areas: [], needsEs: ["Coordinación"], needsEn: ["Coordination"],
      url: f.url_alias || d.fields?.url || "https://reliefweb.int/country/ven",
    };
  });
}

/* ---------- 3) Prensa venezolana por RSS (El Pitazo) ---------- */
const RSS_FEEDS = [
  { name: "El Pitazo", url: "https://elpitazo.net/feed/" },
  { name: "Efecto Cocuyo", url: "https://efectococuyo.com/feed/" },
  { name: "Tal Cual", url: "https://talcualdigital.com/feed/" },
  { name: "Runrun.es", url: "https://runrun.es/feed/" }
];

// Decodifica entidades HTML comunes en los titulares (&#124; «» etc.)
const decode = (s) => (s || "")
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
  .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)))
  .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&nbsp;/g, " ").replace(/&laquo;/g, "«").replace(/&raquo;/g, "»")
  .replace(/&hellip;/g, "…").replace(/&ndash;/g, "–").replace(/&mdash;/g, "—");

function parseRssItems(xml) {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => {
    const b = m[1];
    const pick = (re) => (b.match(re) || [, ""])[1].trim();
    const cdata = (s) => s.replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "").trim();
    const title = decode(cdata(pick(/<title>([\s\S]*?)<\/title>/)));
    const link = cdata(pick(/<link>([\s\S]*?)<\/link>/));
    const date = pick(/<pubDate>([\s\S]*?)<\/pubDate>/);
    const content = pick(/<content:encoded>([\s\S]*?)<\/content:encoded>/);
    let img =
      pick(/<media:content[^>]*url="([^"]+)"/) ||
      pick(/<media:thumbnail[^>]*url="([^"]+)"/) ||
      pick(/<enclosure[^>]*url="([^"]+)"/) ||
      (content.match(/<img[^>]*src="([^"]+)"/) || [, ""])[1];
    return { title, link, date, img };
  });
}

// USGS: estadísticas sísmicas (magnitud máxima y número de réplicas, últimos 7 días)
async function fetchSeismicStats() {
  const start = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
  const url =
    "https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson" +
    "&latitude=10.5&longitude=-68.5&maxradiuskm=400&minmagnitude=2.5" +
    `&starttime=${start}&orderby=magnitude`;
  const j = await get(url);
  const mags = (j.features || []).map((f) => f.properties.mag).filter((m) => typeof m === "number");
  if (!mags.length) return {};
  const maxMagnitude = Math.max(...mags);
  const aftershocks = mags.filter((m) => m < maxMagnitude).length; // todo menos el sismo mayor
  return { maxMagnitude: Number(maxMagnitude.toFixed(1)), aftershocks };
}

// Extrae cifras de víctimas de un titular ("188 muertos, 1.520 heridos y 157 desaparecidos")
const toInt = (s) => parseInt(String(s).replace(/[.\s]/g, ""), 10);
function scanCasualties(title, cas) {
  const grab = (re) => { const m = title.match(re); return m ? toInt(m[1]) : null; };
  const d = grab(/([\d][\d.\s]{0,9}\d|\d)\s*(?:muertos|fallecidos|decesos|muertes)/i);
  const h = grab(/([\d][\d.\s]{0,9}\d|\d)\s*heridos/i);
  const x = grab(/([\d][\d.\s]{0,9}\d|\d)\s*desaparecidos/i);
  if (d && (cas.deaths === null || d > cas.deaths)) cas.deaths = d;
  if (h && (cas.injured === null || h > cas.injured)) cas.injured = h;
  if (x && (cas.missing === null || x > cas.missing)) cas.missing = x;
}

// Imagen de previsualización (og:image) de un artículo, cuando el RSS no trae imagen
async function ogImage(url) {
  try {
    const html = await get(url, "text");
    const m = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
          || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)
          || html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i);
    return m ? m[1].replace(/&amp;/g, "&") : "";
  } catch (e) { return ""; }
}

async function fetchPress() {
  const news = [];
  const casualties = { deaths: null, injured: null, missing: null };
  for (const feed of RSS_FEEDS) {
    try {
      const origin = new URL(feed.url).origin;
      const xml = await get(feed.url, "text");
      let added = 0;
      for (const it of parseRssItems(xml)) {
        if (!it.title || !KEYWORDS.test(it.title)) continue;
        scanCasualties(it.title, casualties); // siempre escanea el balance de víctimas
        if (added < 4) {                        // guarda solo 4 por medio para el carrusel
          news.push({
            source: feed.name, section: "Venezuela",
            date: it.date ? new Date(it.date).toISOString().slice(0, 10) : "",
            img: it.img ? new URL(it.img, origin).href : "",
            titleEs: it.title, titleEn: it.title,
            url: it.link,
          });
          added++;
        }
      }
    } catch (e) {
      console.warn(`RSS ${feed.name} falló:`, e.message);
    }
  }
  return { news, casualties };
}

/* ---------- utilidades ---------- */
const dedupe = (arr, key) => {
  const seen = new Set();
  return arr.filter((x) => (x[key] && !seen.has(x[key]) ? seen.add(x[key]) : false));
};
function writeIfNonEmpty(file, arr) {
  if (!Array.isArray(arr) || arr.length === 0) {
    console.warn(`Sin datos para ${file}: se conserva el archivo anterior.`);
    return;
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, file), JSON.stringify(arr, null, 2) + "\n");
  console.log(`✓ ${file}: ${arr.length} ítems`);
}

(async () => {
  const settled = async (p) => { try { return await p; } catch (e) { console.warn(e.message); return null; } };

  const [usgs, rweb, pressRes, seismicRes] = await Promise.all([
    settled(fetchUSGS()), settled(fetchReliefWeb()), settled(fetchPress()), settled(fetchSeismicStats()),
  ]);

  const usgsA = usgs || [], rwebA = rweb || [];
  const pressNews = (pressRes && pressRes.news) || [];
  const casualties = (pressRes && pressRes.casualties) || {};
  const seismic = seismicRes || {};

  const updates = dedupe([...usgsA, ...rwebA], "url").slice(0, 8);
  const news = dedupe(pressNews, "url").slice(0, 12);
  // Si una noticia no trae imagen en el RSS, buscar el og:image del artículo
  await Promise.all(news.map(async (n) => { if (!n.img) n.img = await ogImage(n.url); }));

  writeIfNonEmpty("updates.json", updates);
  writeIfNonEmpty("news.json", news);

  // Carry-forward: si esta corrida no obtuvo un dato, conserva el anterior (nunca regresa a vacío)
  let prev = {};
  try { prev = (JSON.parse(fs.readFileSync(path.join(OUT_DIR, "meta.json"), "utf8")).stats) || {}; } catch (e) {}
  const pick = (a, b) => (a === undefined || a === null ? (b === undefined ? null : b) : a);
  const stats = {
    maxMagnitude: pick(seismic.maxMagnitude, prev.maxMagnitude),
    aftershocks: pick(seismic.aftershocks, prev.aftershocks),
    deaths: pick(casualties.deaths, prev.deaths),
    injured: pick(casualties.injured, prev.injured),
    missing: pick(casualties.missing, prev.missing),
  };

  const meta = {
    updatedAt: new Date().toISOString(),
    stats,
    sources: { usgs: usgsA.length, reliefweb: rwebA.length, press: pressNews.length },
    counts: { updates: updates.length, news: news.length }
  };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, "meta.json"), JSON.stringify(meta, null, 2) + "\n");
  console.log("✓ meta.json:", meta.updatedAt, "| stats:", JSON.stringify(stats));
})();
