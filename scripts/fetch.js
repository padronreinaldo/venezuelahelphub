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
// Palabras clave del evento. Se añaden términos de ayuda/respuesta para que la
// cobertura de solidaridad internacional (países y ONG ayudando) entre al feed.
const KEYWORDS = /(sismo|terremoto|earthquake|réplica|replica|temblor|damnificad|rescatist|búsqueda y rescate|ayuda humanitaria|ayuda internacional)/i;

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

/* ---------- 2) ReliefWeb / OCHA ----------
 * NOTA: la API v1 fue decomisionada (HTTP 410) y la v2 exige un `appname` APROBADO
 * por ReliefWeb (de lo contrario responde 403). Solicita el tuyo aquí y reemplázalo:
 *   https://apidoc.reliefweb.int/parameters#appname
 * Mientras el appname no esté aprobado, esta fuente devuelve 403 y simplemente no
 * aporta ítems (el feed "Actualizaciones" se nutre de USGS + prensa, ver más abajo). */
const RW_APPNAME = process.env.RELIEFWEB_APPNAME || "venezuela-relief-hub";
async function fetchReliefWeb() {
  const url =
    `https://api.reliefweb.int/v2/reports?appname=${encodeURIComponent(RW_APPNAME)}` +
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
    // Resumen del feed: útil para extraer cifras de víctimas cuando no están en el título
    const desc = decode(cdata(pick(/<description>([\s\S]*?)<\/description>/))).replace(/<[^>]+>/g, " ");
    let img =
      pick(/<media:content[^>]*url="([^"]+)"/) ||
      pick(/<media:thumbnail[^>]*url="([^"]+)"/) ||
      pick(/<enclosure[^>]*url="([^"]+)"/) ||
      (content.match(/<img[^>]*src="([^"]+)"/) || [, ""])[1];
    return { title, link, date, img, desc };
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
  // URL del evento de mayor magnitud, para citar la fuente USGS exacta
  const biggest = (j.features || []).find((f) => f.properties.mag === maxMagnitude);
  const eventUrl = biggest?.properties?.url || "https://earthquake.usgs.gov/earthquakes/map/";
  return { maxMagnitude: Number(maxMagnitude.toFixed(1)), aftershocks, url: eventUrl };
}

/* ---------- USGS: actividad sísmica reciente (lista detallada por evento) ----------
 * Normaliza cada terremoto a un objeto estable para el front (data/quakes.json). Es la
 * "primera capa" del centro de información: misma forma servirá para sumar FUNVISIS, etc. */
async function fetchQuakes() {
  const start = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
  const url =
    "https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson" +
    "&latitude=10.5&longitude=-68.5&maxradiuskm=600&minmagnitude=2.5" +
    `&starttime=${start}&orderby=time&limit=40`;
  const j = await get(url);
  return (j.features || [])
    .map((f) => {
      const p = f.properties || {}, c = (f.geometry && f.geometry.coordinates) || [];
      if (typeof p.mag !== "number" || !p.time) return null;
      return {
        id: f.id,                                   // Event ID oficial del USGS
        time: new Date(p.time).toISOString(),       // fecha y hora (UTC ISO)
        mag: Number(p.mag.toFixed(1)),              // magnitud
        depth: typeof c[2] === "number" ? Number(c[2].toFixed(1)) : null, // profundidad (km)
        lat: typeof c[1] === "number" ? Number(c[1].toFixed(3)) : null,
        lon: typeof c[0] === "number" ? Number(c[0].toFixed(3)) : null,
        place: p.place || "",                       // ubicación descriptiva
        url: p.url || "",                           // URL oficial del evento
        dyfi: typeof p.cdi === "number" ? p.cdi : null,   // intensidad sentida (DYFI/CDI)
        alert: p.alert || null,                     // PAGER: green/yellow/orange/red
        tsunami: p.tsunami ? true : false,          // aviso de tsunami
        status: p.status || null,                   // reviewed / automatic (preliminar)
        source: "USGS",
      };
    })
    .filter(Boolean);
}

/* ---------- FUNVISIS (vía proyecto comunitario sismosVE) ----------
 * FUNVISIS no expone un API oficial; sismosVE toma sus datos oficiales y los sirve como
 * JSON. Es COMPLEMENTARIO al USGS (capta réplicas locales pequeñas que el USGS no lista).
 * Si la API de terceros falla, simplemente no aporta ítems (USGS sigue siendo la base). */
async function fetchFunvisis() {
  const url = "https://sismosve.rafnixg.dev/api/sismos/recent?limit=40";
  const j = await get(url);
  const arr = (j && j.sismos) || [];
  return arr
    .map((s) => {
      const p = s.properties || {}, c = (s.geometry && s.geometry.coordinates) || [];
      const mag = parseFloat(p.value);
      if (isNaN(mag)) return null;
      const depth = parseFloat(p.depth);
      const lat = c[1] != null ? Number(c[1]) : (p.lat ? Number(p.lat) : null);
      const lon = c[0] != null ? Number(c[0]) : (p.long ? Number(p.long) : null);
      // FUNVISIS reporta en hora local de Venezuela (VET = UTC-4). date "DD-MM-YYYY", time "HH:MM".
      let time = null;
      const dm = (p.date || "").match(/^(\d{2})-(\d{2})-(\d{4})$/);
      const tm = (p.time || "").match(/^(\d{1,2}):(\d{2})/);
      if (dm && tm) time = new Date(Date.UTC(+dm[3], +dm[2] - 1, +dm[1], +tm[1] + 4, +tm[2])).toISOString();
      return {
        id: ("fv-" + p.date + "-" + p.time + "-" + lat + "-" + lon).replace(/[^A-Za-z0-9_.:-]/g, ""),
        time: time || new Date().toISOString(),
        mag: Number(mag.toFixed(1)),
        depth: isNaN(depth) ? null : Number(depth.toFixed(1)),
        lat: lat != null ? Number(lat.toFixed(3)) : null,
        lon: lon != null ? Number(lon.toFixed(3)) : null,
        place: p.addressFormatted || "",          // ya viene en español
        url: "http://www.funvisis.gob.ve/recientes.php",
        dyfi: null, alert: null, tsunami: false, status: null,
        source: "FUNVISIS",
      };
    })
    .filter(Boolean);
}

// Extrae cifras de víctimas de un texto ("188 muertos, 1.520 heridos y 157 desaparecidos")
// y registra de QUÉ fuente y URL salió cada cifra, para mostrar procedencia en el sitio.
const toInt = (s) => parseInt(String(s).replace(/[.,\s]/g, ""), 10); // quita separadores de miles (ES "." / EN ",")
function scanCasualties(text, cas, source, url) {
  const grab = (re) => { const m = text.match(re); return m ? toInt(m[1]) : null; };
  const d = grab(/([\d][\d.\s]{0,9}\d|\d)\s*(?:muertos|fallecidos|decesos|muertes)/i);
  const h = grab(/([\d][\d.\s]{0,9}\d|\d)\s*heridos/i);
  const x = grab(/([\d][\d.\s]{0,9}\d|\d)\s*desaparecidos/i);
  // Guarda el valor mayor visto en esta corrida junto con su fuente/URL
  const set = (key, v) => { if (v != null && (cas[key].value == null || v > cas[key].value)) cas[key] = { value: v, source, url }; };
  set("deaths", d); set("injured", h); set("missing", x);
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
  const casualties = {
    deaths:  { value: null, source: null, url: null },
    injured: { value: null, source: null, url: null },
    missing: { value: null, source: null, url: null },
  };
  for (const feed of RSS_FEEDS) {
    try {
      const origin = new URL(feed.url).origin;
      const xml = await get(feed.url, "text");
      let added = 0;
      for (const it of parseRssItems(xml)) {
        if (!it.title || !(KEYWORDS.test(it.title) || KEYWORDS.test(it.desc || ""))) continue;
        // escanea título + resumen del feed y recuerda fuente/URL de cada cifra
        scanCasualties(`${it.title} ${it.desc || ""}`, casualties, feed.name, it.link);
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

/* ---------- 4) Cifras de referencia INTERNACIONAL (Wikipedia EN) ----------
 * Decisión editorial: ya NO anclamos en el parte oficial del gobierno (que muestra
 * discrepancias). Tomamos como primaria la versión EN del artículo ("2026 Venezuela
 * earthquakes"), que refleja el consenso de ONU/OCHA y agencias internacionales (AP,
 * Reuters, Al Jazeera) y se actualiza continuamente. La ES (parte oficial) queda solo
 * como respaldo si la EN no devuelve nada. El infobox |casualties es estructurado. */
const WIKI_EN = "2026_Venezuela_earthquakes";
const WIKI_ES = "Terremotos_de_Venezuela_de_2026";
const pos = (n) => (typeof n === "number" && n > 0 ? n : null); // descarta 0/None
async function wikiCasualties(host, page, field, res) {
  const api = `https://${host}/w/api.php?action=parse&page=${page}&prop=wikitext&format=json&formatversion=2`;
  const j = await get(api);
  const wt = j?.parse?.wikitext || "";
  const m = wt.match(field);
  const f = m ? m[1] : wt.slice(0, 1800); // si no halla el campo, escanea el encabezado
  const grab = (re) => { const x = f.match(re); return x ? toInt(x[1]) : null; };
  return res(grab);
}
async function fetchWikipediaCasualties() {
  // 1) INTERNACIONAL (EN): infobox |casualties con dead/injured/missing
  try {
    const en = await wikiCasualties(
      "en.wikipedia.org", WIKI_EN, /\|\s*casualties\s*=\s*([\s\S]*?)(?=\n\s*\|\s*\w|\n\}\})/i,
      (grab) => ({
        deaths:  pos(grab(/([\d][\d.,\s]*\d|\d)\+?\s*(?:dead|killed|deaths|fatalities)/i)),
        injured: pos(grab(/([\d][\d.,\s]*\d|\d)\+?\s*injured/i)),
        missing: pos(grab(/([\d][\d.,\s]*\d|\d)\+?\s*(?:missing|unaccounted)/i)),
        source: "ONU/OCHA · ref. internacional (Wikipedia EN)",
        url: `https://en.wikipedia.org/wiki/${WIKI_EN}`,
      })
    );
    if (en && (en.deaths != null || en.injured != null)) return en;
  } catch (e) { console.warn("Wikipedia EN falló:", e.message); }
  // 2) RESPALDO (ES): parte oficial citado en el infobox |víctimas
  try {
    return await wikiCasualties(
      "es.wikipedia.org", WIKI_ES, /\|\s*v[íi]ctimas\s*=\s*([\s\S]*?)(?=\n\s*\|\s*\w|\n\}\})/i,
      (grab) => ({
        deaths:  pos(grab(/\+?\s*([\d][\d.,\s]*\d|\d)\s*(?:muertos|fallecidos|muertes|decesos)/i)),
        injured: pos(grab(/\+?\s*([\d][\d.,\s]*\d|\d)\s*heridos/i)),
        missing: pos(grab(/\+?\s*([\d][\d.,\s]*\d|\d)\s*desaparecidos/i)),
        source: "Parte oficial (Wikipedia ES)",
        url: `https://es.wikipedia.org/wiki/${WIKI_ES}`,
      })
    );
  } catch (e) { console.warn("Wikipedia ES falló:", e.message); return {}; }
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

  const [usgs, rweb, pressRes, seismicRes, wikiRes, quakesRes, funvisisRes] = await Promise.all([
    settled(fetchUSGS()), settled(fetchReliefWeb()), settled(fetchPress()),
    settled(fetchSeismicStats()), settled(fetchWikipediaCasualties()), settled(fetchQuakes()),
    settled(fetchFunvisis()),
  ]);

  const usgsA = usgs || [], rwebA = rweb || [];
  const pressNews = (pressRes && pressRes.news) || [];
  const press = (pressRes && pressRes.casualties) || {};
  const seismic = seismicRes || {};
  const wiki = wikiRes || {};

  // Cifras de víctimas: prioridad a la fuente ESTRUCTURADA (Wikipedia, que cita el parte
  // oficial); si una cifra no está ahí, se usa el raspado de prensa como respaldo.
  const fromWiki = (key) =>
    wiki[key] != null ? { value: wiki[key], source: wiki.source, url: wiki.url, official: true } : null;
  const casualties = {
    deaths:  fromWiki("deaths")  || press.deaths  || { value: null, source: null, url: null },
    injured: fromWiki("injured") || press.injured || { value: null, source: null, url: null },
    missing: fromWiki("missing") || press.missing || { value: null, source: null, url: null },
  };

  // El feed "Actualizaciones" combina USGS + ReliefWeb (institucional) y, para que no
  // se congele cuando esas fuentes no traen nada nuevo, lo completa con prensa reciente.
  const pressToUpdate = (n) => ({
    sourceEs: n.source, sourceEn: n.source,
    date: n.date, conf: "med",
    titleEs: n.titleEs, titleEn: n.titleEn,
    sumEs: `Cobertura de ${n.source} sobre el sismo. Lee la nota completa en la fuente original.`,
    sumEn: `Coverage from ${n.source} about the earthquake. Read the full story at the original source.`,
    areas: [], needsEs: [], needsEn: [],
    url: n.url,
  });
  const updates = dedupe(
    [...usgsA, ...rwebA, ...pressNews.map(pressToUpdate)],
    "url"
  ).slice(0, 8);
  const news = dedupe(pressNews, "url").slice(0, 12);
  // Si una noticia no trae imagen en el RSS, buscar el og:image del artículo
  await Promise.all(news.map(async (n) => { if (!n.img) n.img = await ogImage(n.url); }));

  writeIfNonEmpty("updates.json", updates);
  writeIfNonEmpty("news.json", news);

  // Actividad sísmica: combina lo nuevo con el historial previo (dedupe por Event ID;
  // el dato más reciente del USGS gana, p.ej. cuando un evento pasa de automatic→reviewed
  // o se corrige su magnitud). Historial rodante ordenado por hora desc.
  const quakesUsgs = Array.isArray(quakesRes) ? quakesRes : [];
  const quakesFv = Array.isArray(funvisisRes) ? funvisisRes : [];
  const quakesNew = [...quakesUsgs, ...quakesFv];
  let prevQuakes = [];
  try { prevQuakes = JSON.parse(fs.readFileSync(path.join(OUT_DIR, "quakes.json"), "utf8")) || []; } catch (e) {}
  const byId = new Map();
  for (const q of [...prevQuakes, ...quakesNew]) {
    if (q && q.id) byId.set(q.id, { ...(byId.get(q.id) || {}), ...q });
  }
  // Dedup cruzado entre fuentes: si FUNVISIS y USGS reportan el MISMO evento físico
  // (mismo minuto aprox., misma zona, magnitud similar), se conserva el de USGS (con Event ID).
  const allQ = [...byId.values()];
  const usgsOnly = allQ.filter((q) => q.source !== "FUNVISIS");
  const sameEvent = (u, q) => {
    const dt = Math.abs(new Date(u.time) - new Date(q.time)) / 60000;          // minutos
    const dd = Math.abs((u.lat || 0) - (q.lat || 0)) + Math.abs((u.lon || 0) - (q.lon || 0));
    const dmg = Math.abs((u.mag || 0) - (q.mag || 0));
    return dt <= 3 && dd <= 0.6 && dmg <= 0.8;
  };
  const quakes = allQ
    .filter((q) => q.source !== "FUNVISIS" || !usgsOnly.some((u) => sameEvent(u, q)))
    .sort((a, b) => new Date(b.time) - new Date(a.time))
    .slice(0, 500); // historial completo desde el 24 jun (para la gráfica)
  writeIfNonEmpty("quakes.json", quakes);

  // Procedencia por dato: cada cifra recuerda CUÁNDO se confirmó por última vez desde una
  // fuente real (seenAt) y DE QUÉ fuente (source + url). Si esta corrida no la confirma,
  // se conserva el valor anterior CON su hora real (no se finge que es de ahora).
  const now = new Date().toISOString();
  let prev = {}, prevProv = {}, prevAlt = {};
  try {
    const pm = JSON.parse(fs.readFileSync(path.join(OUT_DIR, "meta.json"), "utf8"));
    prev = pm.stats || {}; prevProv = pm.prov || {}; prevAlt = pm.alt || {};
  } catch (e) {}

  // Lo OBSERVADO en esta corrida (o null si la fuente no lo trajo)
  const usgsUrl = seismic.url || "https://earthquake.usgs.gov/earthquakes/map/";
  const obs = {
    maxMagnitude: seismic.maxMagnitude != null ? { value: seismic.maxMagnitude, source: "USGS", url: usgsUrl } : null,
    aftershocks:  seismic.aftershocks  != null ? { value: seismic.aftershocks,  source: "USGS", url: usgsUrl } : null,
    deaths:  casualties.deaths?.value  != null ? casualties.deaths  : null, // puede traer .official
    injured: casualties.injured?.value != null ? casualties.injured : null,
    missing: casualties.missing?.value != null ? casualties.missing : null,
  };

  // Muertos/heridos solo crecen: si el dato nuevo es menor que el vigente, se ignora (no retrocede).
  const MONOTONIC = new Set(["deaths", "injured"]);
  const CASUALTY = new Set(["deaths", "injured", "missing"]);
  // Guarda anti-vandalismo: descarta un salto absurdo (>20x) sobre un valor ya consolidado.
  const plausible = (key, val, pv) =>
    !(CASUALTY.has(key) && typeof pv === "number" && pv >= 50 && val > pv * 20);
  const stats = {}, prov = {};
  for (const key of ["maxMagnitude", "aftershocks", "deaths", "injured", "missing"]) {
    const cur = obs[key];                 // {value,source,url} observado ahora, o null
    const pv = prev[key];                 // valor anterior (número o null)
    const pp = prevProv[key] || {};       // procedencia anterior
    if (cur && !cur.official && !plausible(key, cur.value, pv)) {
      console.warn(`⚠ ${key}=${cur.value} descartado por salto improbable (previo ${pv}, fuente ${cur.source}).`);
    }
    // Una fuente estructurada de referencia (cur.official: Wikipedia EN/ES) puede corregir
    // hacia arriba o abajo y NO está sujeta a la guarda anti-vandalismo (el salto del parte
    // oficial a la cifra internacional es legítimo). La prensa sí es monótona y con guarda.
    if (cur && (cur.official || plausible(key, cur.value, pv)) && (cur.official || !MONOTONIC.has(key) || pv == null || cur.value >= pv)) {
      stats[key] = cur.value;             // confirmado AHORA por una fuente
      prov[key] = { seenAt: now, source: cur.source, url: cur.url };
    } else if (pv != null) {
      stats[key] = pv;                    // no se confirmó ahora: conserva valor y su hora real
      prov[key] = { seenAt: pp.seenAt || null, source: pp.source || null, url: pp.url || null };
    } else {
      stats[key] = null;
      prov[key] = {};
    }
  }

  // Cifras de OTRAS FUENTES (prensa/ONG): nota secundaria que se muestra SOLO cuando
  // difiere de la cifra oficial. Mismas guardas (monótonas para muertos/heridos,
  // anti-vandalismo) y se conserva la anterior si esta corrida no la observa, con su
  // hora real (seenAt). El front compara con la oficial y oculta la nota si coinciden.
  const alt = {};
  for (const key of ["deaths", "injured", "missing"]) {
    const cur = press[key] && press[key].value != null ? press[key] : null; // {value,source,url}
    const pa = prevAlt[key] || {};
    const pv = typeof pa.value === "number" ? pa.value : null;
    if (cur && plausible(key, cur.value, pv) && (!MONOTONIC.has(key) || pv == null || cur.value >= pv)) {
      alt[key] = { value: cur.value, source: cur.source, url: cur.url, seenAt: now };
    } else if (pv != null) {
      alt[key] = { value: pv, source: pa.source || null, url: pa.url || null, seenAt: pa.seenAt || null };
    }
  }

  const meta = {
    updatedAt: now,
    stats,
    prov,
    alt,
    sources: { usgs: usgsA.length, reliefweb: rwebA.length, press: pressNews.length, wikipedia: wiki.deaths != null || wiki.injured != null ? 1 : 0, funvisis: quakesFv.length },
    counts: { updates: updates.length, news: news.length, quakes: quakes.length }
  };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, "meta.json"), JSON.stringify(meta, null, 2) + "\n");
  console.log("✓ meta.json:", meta.updatedAt, "| stats:", JSON.stringify(stats));
})();
