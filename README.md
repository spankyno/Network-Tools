# Network Tools Hub (NetCheck)

Suite profesional de diagnóstico de redes e infraestructura web construida con React 19, TypeScript, Tailwind CSS v4, TanStack Query y Leaflet + OpenStreetMap. Opera 100% en planes gratuitos (*free tier*) de Cloudflare Pages y APIs públicas abiertas.

---

## 🚀 Despliegue en Cloudflare Pages desde GitHub

Sigue estos sencillos pasos para compilar y desplegar la aplicación directamente desde tu repositorio de GitHub:

### Paso 1: Conectar el repositorio en Cloudflare
1. Entra a tu panel de control de Cloudflare: [dash.cloudflare.com](https://dash.cloudflare.com/).
2. En el menú lateral izquierdo, haz clic en **Workers & Pages** (o **Pages**).
3. Haz clic en el botón azul **Create application** (Crear aplicación).
4. Selecciona la pestaña **Pages** y haz clic en **Connect to Git** (Conectar a Git).
5. Autoriza tu cuenta de GitHub (si aún no lo has hecho) y selecciona el repositorio de Network Tools Hub.

---

### Paso 2: Configuración de Build (Ajustes de compilación)
En la pantalla de configuración del proyecto, introduce los siguientes valores exactos:

| Parámetro | Valor |
| :--- | :--- |
| **Project name** | `network-tools-hub` (o el nombre que prefieras) |
| **Production branch** | `main` (o tu rama principal) |
| **Framework preset** | `Vite` |
| **Build command** | `npm run build` |
| **Build output directory** | `dist` |
| **Root directory** | `/` (o dejar vacío) |

---

### Paso 3: Versión de Node.js
El repositorio ya incluye los archivos `.node-version`, `.nvmrc` y `.npmrc` configurados en Node.js 22. Si deseas asegurarte manualmente en la sección **Environment variables**, puedes añadir:

| Variable | Valor |
| :--- | :--- |
| `NODE_VERSION` | `22` |

*(Esto garantiza que Cloudflare utilice Node.js 22 LTS con soporte nativo para Vite 8 y Tailwind CSS v4).*

---

### Paso 4: Desplegar
1. Haz clic en **Save and Deploy** (Guardar y Desplegar).
2. Cloudflare Pages iniciará la compilación de forma automática:
   - Compilará la interfaz web con `npm run build` en el directorio `dist/`.
   - Compilará y desplegará de forma automática las rutas `/api/*` como **Cloudflare Pages Functions** (definidas en el directorio `functions/`).
   - Copiará el archivo `_redirects` para que el enrutamiento SPA funcione perfectamente sin errores 404.
3. Al finalizar obtendrás una URL gratuita del tipo: `https://network-tools-hub.pages.dev`.

---

### Paso 5 (Opcional): Dominio Personalizado Gratuito
1. En tu proyecto de Cloudflare Pages, entra en la pestaña **Custom domains**.
2. Haz clic en **Set up a custom domain**.
3. Escribe tu dominio (ej. `tools.tudominio.com` o `tudominio.com`).
4. Cloudflare configurará automáticamente los registros DNS y aprovisionará el certificado SSL/TLS de forma 100% gratuita.

---

## 🛠️ Desarrollo Local

```bash
# Instalar dependencias
npm install

# Iniciar servidor local de desarrollo (Express + Vite + APIs completas)
npm run dev

# Compilar para producción
npm run build

# Comprobación de tipos TypeScript
npm run lint

# Tests (validación SSRF, redirecciones, límites, historial, backend Edge)
npm test

# Servidor Node en producción (tras `npm run build`)
npm start
```

---

## 🔐 Seguridad y despliegue

La app ejecuta conexiones de red **a petición de usuarios anónimos**, así que está diseñada para impedir su abuso:

- **Solo destinos públicos.** `shared/net-utils.ts` bloquea loopback, redes privadas, link-local (metadatos cloud `169.254.169.254`), CGNAT, multicast, formas ambiguas (`127.1`, `2130706433`, `::ffff:127.0.0.1`…) y nombres `.local/.internal`.
- **Anti DNS-rebinding (Node).** La IP validada es la IP a la que conecta el socket (`server/security.ts › safeLookup`).
- **Redirecciones revalidadas** salto a salto en `/api/headers`.
- **Rate limiting** por IP, límites de concurrencia y de ancho de banda en el speed test, y topes de tamaño.
- **Cabeceras de seguridad y CSP** definidas una sola vez en `shared/headers.ts` (se genera `public/_headers` en cada build).

| Variable | Dónde | Para qué |
| :--- | :--- | :--- |
| `TRUST_PROXY` | Node | Nº de proxies de confianza. **Obligatoria tras un proxy/CDN.** |
| `ALLOWED_ORIGINS` | Node y Cloudflare | Orígenes CORS permitidos (vacío = solo mismo origen). |

### Dos backends, capacidades distintas

| Herramienta | Node (`npm start`) | Cloudflare Pages Functions |
| :--- | :--- | :--- |
| SSL/TLS | Handshake real: protocolo, cifrado, huellas, cadena | **Parcial**: fechas/emisor/SAN desde logs CT + conexión HTTPS verificada. Se avisa en la UI. |
| Puertos | TCP real | TCP real vía `cloudflare:sockets`; no puede sondear IPs de Cloudflare ni algunos puertos (se avisa). |
| HTTP/2 | ALPN real | Solo si lo anuncia el registro DNS HTTPS (sin ALPN en el Edge). |

> Para inspección TLS completa en producción, use el despliegue Node (Cloud Run, Fly.io, un VPS…).

### Recomendado en Cloudflare
Cree una regla de **Rate Limiting (WAF)** sobre `/api/*`: el limitador en memoria de las Functions es por *isolate* y solo es de mejor esfuerzo.
