# Venezuela Relief Hub

Landing humanitario, neutral e **informativo** para la respuesta a los terremotos del 24 de junio de 2026 en Venezuela. Centraliza información verificada, organizaciones legítimas con donación directa, centros de acopio, reunificación familiar y prensa local.

**Principios:** no custodiamos fondos · enlazamos siempre a la fuente original · solo fuentes legítimas · bilingüe (ES/EN) · mobile-first · no competimos con medios ni autoridades.

---

## Archivos

- `index.html` — el sitio completo, en un solo archivo (HTML + CSS + JS). No requiere build ni servidor.
- `README.md` — este documento.

Es un sitio **estático**: se puede abrir con doble clic o publicar en cualquier hosting gratuito.

---

## Publicarlo hoy (3 opciones, todas gratis)

### Opción A — Netlify Drop (la más rápida, ~2 min)
1. Entra a **https://app.netlify.com/drop**
2. Arrastra la carpeta `Venezuela  Help HUB` (o solo `index.html`) a la página.
3. Listo: te da una URL pública (ej. `tu-sitio.netlify.app`). Puedes conectar un dominio propio después.

### Opción B — Vercel
1. Sube la carpeta a un repositorio de GitHub.
2. En **https://vercel.com** → *Add New Project* → importa el repo → *Deploy*.
3. Como es estático, no hay que configurar nada.

### Opción C — GitHub Pages
1. Crea un repo en GitHub y sube `index.html`.
2. *Settings → Pages → Source: Deploy from a branch → main / root*.
3. La URL queda como `https://tuusuario.github.io/tu-repo/`.

> Para el lanzamiento de hoy, **Opción A** es suficiente.

---

## Actualización automática cada hora (el "fetch")

Hoy los datos de **Actualizaciones** y **Noticias locales** están escritos directamente dentro de `index.html` (arreglos `UPDATES` y `NEWS` en el `<script>`). Para que el sitio se mantenga fresco **sin intervención manual y sin aprobación humana**, hay que separar esos datos a archivos JSON y refrescarlos con un trabajo programado **cada hora**.

### Paso 1 — Externalizar los datos
Crea una carpeta `data/` con dos archivos:
- `data/updates.json` — el contenido del arreglo `UPDATES`.
- `data/news.json` — el contenido del arreglo `NEWS`.

Y en `index.html` reemplaza los arreglos fijos por una carga al iniciar:

```js
let UPDATES = [], NEWS = [];
async function loadData(){
  const [u, n] = await Promise.all([
    fetch('data/updates.json').then(r => r.json()).catch(() => []),
    fetch('data/news.json').then(r => r.json()).catch(() => [])
  ]);
  UPDATES = u; NEWS = n;
  renderFeed(); renderNews();
}
loadData();
```

(Si un fetch falla, el sitio sigue funcionando con lo último que cargó.)

### Paso 2 — El trabajo programado cada hora
El sitio es estático, así que el fetch lo hace un proceso aparte que **reescribe los JSON cada hora**. Tres formas, elige una:

**a) GitHub Actions (recomendado, gratis)** — crea `.github/workflows/fetch.yml`:

```yaml
name: Actualizar datos cada hora
on:
  schedule:
    - cron: "0 * * * *"   # cada hora, en punto (UTC)
  workflow_dispatch:        # permite ejecutarlo a mano
jobs:
  fetch:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: node scripts/fetch.js        # genera data/updates.json y data/news.json
      - run: |
          git config user.name "bot"
          git config user.email "bot@users.noreply.github.com"
          git add data/*.json
          git commit -m "Actualización automática de datos" || echo "sin cambios"
          git push
```

> `cron: "0 * * * *"` significa **minuto 0 de cada hora** (00:00, 01:00, 02:00, …) en **UTC**. GitHub Actions puede retrasarse algunos minutos cuando hay mucha carga; para esta finalidad es aceptable. Si quieres cada 30 min: `0,30 * * * *`.

**b) Vercel Cron** — en `vercel.json`:
```json
{ "crons": [ { "path": "/api/fetch", "schedule": "0 * * * *" } ] }
```
y una función serverless en `/api/fetch` que actualice los datos.

**c) Netlify Scheduled Functions** — una función con `schedule: "0 * * * *"`.

### Paso 3 — Qué hace `scripts/fetch.js`
1. Consulta **solo fuentes legítimas** (lista abajo).
2. Filtra lo relevante al terremoto de Venezuela.
3. Toma de cada nota: título, fecha, resumen corto, imagen (si hay) y **URL original**.
4. Escribe `data/updates.json` y `data/news.json`.
5. **No hay aprobación manual:** si viene de una fuente de la lista, entra. Siempre se conserva el enlace a la fuente original.

### Fuentes legítimas sugeridas para el fetch
- **USGS** (sismos): `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&...`
- **ReliefWeb / OCHA** (API): `https://api.reliefweb.int/v1/reports?appname=venezuela-relief-hub&query[value]=Venezuela%20earthquake`
- **IFRC** y **Cruz Roja Venezolana** (notas de prensa)
- **Prensa venezolana vía RSS:** El Pitazo (`https://elpitazo.net/feed/`), Efecto Cocuyo, Tal Cual, NTN24
- ONG ya verificadas en el sitio (Direct Relief, IMC, World Vision, GEM, Cáritas de Venezuela)

**Buenas prácticas:** identifícate con un `User-Agent`/`appname` propio, respeta los términos y el `robots.txt` de cada medio, y guarda siempre `sourceUrl`, `sourceName` y `date`. Las imágenes se enlazan desde el medio original (no las re-alojamos).

---

## Notas

- **No custodia de fondos:** todos los botones de donación llevan directo al canal oficial de cada organización.
- **Desaparecidos:** la sección de reunificación familiar deriva al sistema oficial RCF de la Cruz Roja; no alojamos listas públicas.
- Las cifras de víctimas son **preliminares** y cambian; el sitio es informativo y no reemplaza a medios ni autoridades.

*Última actualización del contenido del sitio: 25 de junio de 2026.*
