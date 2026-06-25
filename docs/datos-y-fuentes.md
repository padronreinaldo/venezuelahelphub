# Cómo se actualizan los datos del sitio

Este documento explica, para todo el equipo, **de dónde salen las cifras y noticias del sitio, cada cuánto se actualizan y cómo verificar la fuente de cada dato.** No hace falta saber programar para entender la primera parte.

---

## 1. El ciclo de actualización (en una imagen)

```
⏰ GitHub Actions (cada 30 min)
        │  corre  scripts/fetch.js  en los servidores de GitHub (nadie tiene que estar prendido)
        ▼
🌐 Consulta las fuentes:  USGS · Wikipedia · prensa (RSS) · ReliefWeb
        ▼
📝 Reescribe  data/updates.json · data/news.json · data/meta.json
        ▼
⬆️  git commit + push a la rama main   (solo si algo cambió)
        ▼
🚀 GitHub Pages redeploya automáticamente  → publica los JSON nuevos
        ▼
👀 El navegador del visitante lee los JSON  (index.html → loadData())  y pinta los datos frescos
```

**Puntos clave:**

- El **HTML casi nunca cambia.** Lo único que se actualiza solo son los 3 archivos `data/*.json`. `index.html` solo cambia cuando alguien lo edita a mano.
- La frescura máxima en el peor caso es **~40 min** (cron de 30 min + caché de 10 min de GitHub Pages en los JSON).
- El cron de GitHub Actions es **best-effort**: bajo carga se retrasa o se salta corridas. Por eso está cada 30 min y no cada hora.
- **Tu carpeta local NO se actualiza sola.** El bot pushea a `main` en GitHub; para ver lo último en local hay que hacer `git pull`.

---

## 2. De dónde sale cada dato

| Dato en el sitio | Fuente | Cómo se obtiene |
|---|---|---|
| **Magnitud máxima · Réplicas** | USGS (FDSNWS) | API oficial de sismos, ventana de 7 días alrededor de Venezuela. Se consulta en vivo en cada corrida. |
| **Fallecidos · Heridos** | **Wikipedia (ES)** — campo `víctimas` del infobox del artículo, que cita el parte oficial | Fuente **estructurada y parseable**. Se usa la versión ES a propósito (ver §4). |
| **Desaparecidos** | Prensa venezolana (RSS) | El infobox ES no trae "desaparecidos", así que se extrae de titulares/resúmenes de prensa. |
| **Actualizaciones** (feed) | USGS + ReliefWeb + prensa | Combina las institucionales y se completa con prensa reciente para que **no se congele**. |
| **Noticias locales** (carrusel) | Prensa venezolana (RSS): El Pitazo, Efecto Cocuyo, Tal Cual, Runrun.es | Filtradas por palabras clave del sismo. |

**Principio del proyecto:** siempre se conserva y se muestra el **enlace a la fuente original**. Nunca inventamos cifras.

---

## 3. Procedencia: la fuente y la hora REAL de cada cifra

El cambio más importante: `data/meta.json` ya no guarda solo *cuándo corrió el script*, sino **cuándo se confirmó por última vez cada cifra y desde qué fuente**. El sitio muestra esto debajo de cada número (ej. *"Consultado hace 5 min · Fuente: Wikipedia (ES) ↗"*).

Estructura de `meta.json`:

```json
{
  "updatedAt": "2026-06-25T23:05:33.983Z",   // última vez que corrió el script
  "stats":  { "maxMagnitude": 7.5, "aftershocks": 4, "deaths": 188, "injured": 1500, "missing": 157 },
  "prov": {                                    // procedencia por dato
    "deaths":  { "seenAt": "2026-06-25T23:05:33.983Z", "source": "Wikipedia (ES)", "url": "https://es.wikipedia.org/wiki/..." },
    "missing": { "seenAt": "2026-06-25T20:11:00.000Z", "source": "Efecto Cocuyo",  "url": "https://efectococuyo.com/..." }
  },
  "sources": { "usgs": 3, "reliefweb": 0, "press": 15, "wikipedia": 1 }
}
```

Reglas de la procedencia (en `scripts/fetch.js`):

- Si una corrida **confirma** una cifra desde una fuente → `seenAt = ahora`, con la fuente y URL.
- Si **no** la confirma → **conserva el valor anterior con su hora real** (no finge que es de ahora). En el sitio se verá *"hace 2 d"*.
- Si nunca se confirmó → el sitio muestra en ámbar **"sin confirmación reciente"** (señal honesta de dato viejo).

Así cualquiera puede saber, mirando el sitio, **si un número está fresco o quedó viejo**, y hacer clic para verificar la fuente.

---

## 4. Por qué Wikipedia, y las guardas de seguridad

Para las víctimas confirmadas (muertos/heridos) **no existe una API oficial limpia**: el balance oficial vive en partes de prensa y comunicados (texto sin estructura). Las opciones eran:

- Raspar titulares con regex (frágil: la cifra solo cambia si un titular la repite con esas palabras exactas).
- USGS PAGER / GDACS → son **estimaciones modeladas**, no el conteo oficial.
- **Wikipedia** → el infobox tiene un campo estructurado que los editores mantienen **citando el parte oficial**. Es la opción estructurada que coincide con lo que el sitio muestra.

Elegimos Wikipedia como fuente primaria, **con guardas porque es editable por cualquiera**:

- Se usa la versión **ES** a propósito: la EN llegó a mostrar *"45.000 desaparecidos"* (casi seguro un error confundiendo desplazados con desaparecidos).
- **Anti-vandalismo:** se descarta un salto absurdo (más de 20× sobre un valor ya consolidado). Bloquea cosas como 45.000 o 999.999, pero permite correcciones normales.
- Una **fuente oficial estructurada puede corregir** una cifra hacia arriba o abajo; la **prensa** es monótona para muertos/heridos (un titular viejo no puede bajar la cifra).

> Honestidad: Wikipedia es un **agregador que cita** fuentes oficiales, no la autoridad primaria. Por eso cada cifra **enlaza** al artículo (donde se ven las citas) y muestra cuándo se confirmó.

---

## 5. Estado de ReliefWeb (OCHA)

La API v1 de ReliefWeb **fue decomisionada** (responde HTTP 410) y la v2 **exige un `appname` aprobado** por ReliefWeb (si no, responde 403). El código ya apunta a v2 y deja el appname configurable, pero **alguien del equipo debe registrarlo** para reactivar esta fuente:

1. Solicitar un appname en: https://apidoc.reliefweb.int/parameters#appname
2. Ponerlo como variable de entorno `RELIEFWEB_APPNAME` en el workflow (o reemplazar el valor por defecto en `scripts/fetch.js`).

Mientras tanto **no bloquea nada**: el feed "Actualizaciones" se nutre de USGS + prensa.

---

## 6. Cómo correrlo y probarlo localmente

```bash
# Desde la RAÍZ del repo (la carpeta venezuelahelphub), NO desde la carpeta de arriba:
node scripts/fetch.js          # regenera data/*.json. Necesita Node 20+ (usa fetch nativo)

# Previsualizar el sitio:
python3 -m http.server 8000    # luego abrir http://localhost:8000
```

> Error común: `Cannot find module '.../scripts/fetch.js'` = lo estás corriendo desde la carpeta equivocada. Tiene que ser desde `venezuelahelphub/`.

---

## 7. Limitaciones conocidas / pendientes

- **Desaparecidos** depende del raspado de prensa (frágil) hasta que haya una fuente estructurada para esa cifra.
- **ReliefWeb** está apagado hasta registrar el appname (§5).
- El **nombre del artículo de Wikipedia** está fijo en `scripts/fetch.js` (`WIKI_PAGE`). Si el artículo se renombra, hay que actualizar esa constante.
- Las cifras son **preliminares**; el sitio es informativo y no reemplaza a medios ni autoridades.
