# Help Venezuela — helpvenezuela.info

Sitio humanitario, neutral e **informativo** para la respuesta a los terremotos del 24 de junio de 2026 en Venezuela. Centraliza información verificada, organizaciones legítimas con donación directa, centros de acopio, refugios, reunificación familiar y prensa local.

**En vivo:** https://helpvenezuela.info

**Principios:** no custodiamos fondos · enlazamos siempre a la fuente original · solo fuentes legítimas · bilingüe (ES/EN) · mobile-first · no competimos con medios ni autoridades.

---

## Estructura del proyecto

```
.
├─ index.html                 ← el sitio completo (HTML + CSS + JS en un archivo)
├─ logo.png / logo-white.png  ← logo (a color para fondo claro, blanco para fondo oscuro)
├─ og-image.png               ← imagen de previsualización al compartir
├─ CNAME                       ← dominio personalizado (helpvenezuela.info) para GitHub Pages
├─ data/
│  ├─ updates.json            ← feed de actualizaciones (USGS + prensa)
│  ├─ news.json               ← carrusel de noticias locales (con imagen)
│  └─ meta.json               ← hora exacta de la última actualización + cifras del hero
├─ scripts/
│  └─ fetch.js                ← obtiene datos de fuentes legítimas cada hora
├─ .github/workflows/
│  └─ fetch.yml               ← cron horario que ejecuta fetch.js y commitea
├─ analytics/
│  └─ gtm-container-import.json ← contenedor de GTM con los eventos (importar en GTM)
├─ godaddy-dns.ps1            ← (gitignored) script opcional para configurar DNS por API
└─ README.md
```

Es un sitio **estático**: no requiere build ni servidor.

---

## Hosting y despliegue (lo que se usó)

El sitio está publicado en **GitHub Pages** desde el repositorio `padronreinaldo/venezuelahelphub`.

- **GitHub → Settings → Pages → Source:** *Deploy from a branch* → rama **`main`** / carpeta **`/ (root)`**.
- **Dominio personalizado:** `helpvenezuela.info` (fijado por el archivo **`CNAME`** en la raíz del repo) con **Enforce HTTPS** activado.

**Cómo se despliega cada cambio:** cada `git push` a `main` dispara automáticamente el workflow **pages-build-deployment**, que publica el contenido de la raíz. En ~1–2 minutos los cambios están en `helpvenezuela.info`.

> Importante: **no eliminar el archivo `CNAME`** — GitHub Pages lee de ahí el dominio; si falta en un push, el dominio se desconfigura.

### Flujo para subir cambios
```bash
git pull --no-edit            # trae los commits horarios del bot antes de subir
git add .
git commit -m "tus cambios"
git push                      # GitHub Pages redespliega solo
```

---

## Dominio (GoDaddy)

El dominio `helpvenezuela.info` está registrado en **GoDaddy**. DNS configurado hacia GitHub Pages:

- **4 registros A** en `@` → `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`
- **CNAME** `www` → `padronreinaldo.github.io`

(El script `godaddy-dns.ps1` automatiza esto por la API de GoDaddy; está en `.gitignore` porque contiene credenciales.)

**Correo:** `correcciones@helpvenezuela.info` vía **Email Forwarding** gratuito de GoDaddy.

---

## Actualización automática cada hora

El **workflow** `.github/workflows/fetch.yml` corre con cron `0 * * * *` (cada hora, UTC) y también a mano (*Actions → Run workflow*):

1. Ejecuta `node scripts/fetch.js`.
2. `fetch.js` consulta **solo fuentes legítimas**: USGS (sismos y réplicas), y prensa venezolana por RSS (El Pitazo, Efecto Cocuyo, Tal Cual, Runrun.es). Para cada noticia sin imagen, toma el `og:image` del artículo.
3. Escribe `data/updates.json`, `data/news.json` y `data/meta.json`. Si una fuente falla, **conserva los datos anteriores** (nunca deja la web vacía).
4. Hace commit y push de los `data/*.json` → GitHub Pages redespliega.

**Sin aprobación humana:** si viene de una fuente de la lista, entra; siempre con enlace a la fuente original.

### Datos dinámicos en la web (`data/meta.json`)
- **`updatedAt`** → la web muestra la **hora exacta** de la última actualización ("Última actualización… hora de Venezuela"). Se reescribe en cada corrida.
- **`stats`** → las tarjetas del hero (magnitud máxima, réplicas, fallecidos, heridos, desaparecidos) se actualizan solas desde aquí.

`index.html` carga estos JSON al abrir; si no existen o fallan, usa los datos embebidos de respaldo.

---

## Analítica

- **Google Tag Manager:** contenedor `GTM-5XMFPVZG` instalado en `index.html`.
- **Google Analytics 4:** se configura dentro de GTM. Importa `analytics/gtm-container-import.json` (*GTM → Admin → Import Container*), pon tu Measurement ID `G-XXXXXXXXXX` en la variable `GA4 - Measurement ID` y publica.
- **Eventos que mide:** `donate_click`, `share_click`, `emergency_call`, `language_switch`, `family_reunification_click`, `find_help_click`, `acopio_click` (capa `dataLayer` ya integrada en el sitio).

---

## Notas

- **No custodia de fondos:** cada botón de donación lleva directo al canal oficial de la organización.
- **Desaparecidos:** la sección de reunificación familiar deriva al sistema oficial RCF de la Cruz Roja; no alojamos listas públicas.
- Las cifras de víctimas son **preliminares** y cambian; el sitio es informativo y no reemplaza a medios ni autoridades.
- Las imágenes de prensa se enlazan desde el medio original (no se re-alojan); si una bloquea el enlace externo, la tarjeta cae a un degradado con la fuente.
