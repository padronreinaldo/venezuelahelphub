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
  const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "*/*" } });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return type === "json" ? r.json() : r.text();
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
const RSS_FEEDS = [{ name: "El Pitazo", url: "https://elpitazo.net/feed/" }];

function parseRssItems(xml) {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => {
    const b = m[1];
    const pick = (re) => (b.match(re) || [, ""])[1].trim();
    const cdata = (s) => s.replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "").trim();
    const title = cdata(pick(/<title>([\s\S]*?)<\/title>/));
    const link = cdata(pick(/<link>([\s\S]*?)<\/link>/));
    const date = pick(/<pubDate>([\s\S]*?)<\/pubDate>/);
    const content = pick(/<content:encoded>([\s\S]*?)<\/content:encoded>/);
    let img =
      pick(/<media:content[^>]*url="([^"]+)"/) ||
      pick(/<enclosure[^>]*url="([^"]+)"/) ||
      (content.match(/<img[^>]*src="([^"]+)"/) || [, ""])[1];
    return { title, link, date, img };
  });
}

async function fetchPress() {
  const out = [];
  for (const feed of RSS_FEEDS) {
    try {
      const xml = await get(feed.url, "text");
      for (const it of parseRssItems(xml)) {
        if (!it.title || !KEYWORDS.test(it.title)) continue;
        out.push({
          source: feed.name, section: "Venezuela",
          date: it.date ? new Date(it.date).toISOString().slice(0, 10) : "",
          img: it.img || "",
          titleEs: it.title, titleEn: it.title,
          url: it.link,
        });
        if (out.length >= 8) break;
      }
    } catch (e) {
      console.warn(`RSS ${feed.name} falló:`, e.message);
    }
  }
  return out;
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
  const settled = async (p) => { try { return await p; } catch (e) { console.warn(e.message); return []; } };

  const [usgs, rweb, press] = await Promise.all([
    settled(fetchUSGS()), settled(fetchReliefWeb()), settled(fetchPress()),
  ]);

  const updates = dedupe([...usgs, ...rweb], "url").slice(0, 8);
  const news = dedupe(press, "url").slice(0, 8);

  writeIfNonEmpty("updates.json", updates);
  writeIfNonEmpty("news.json", news);
})();
