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
```
