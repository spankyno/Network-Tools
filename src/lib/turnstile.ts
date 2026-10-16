// Reto Cloudflare Turnstile bajo demanda. Se activa SOLO cuando una ruta pesada responde 403 CAPTCHA_REQUIRED:
// se muestra un modal, el usuario lo resuelve una vez y la petición original se reintenta sola.
// El servidor guarda un pase firmado en una cookie HttpOnly (10 min), así que no hay que resolverlo en cada consulta.

const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

interface TurnstileApi {
  render(el: HTMLElement, opts: Record<string, unknown>): string;
  reset(id?: string): void;
  remove(id?: string): void;
}
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let siteKeyPromise: Promise<string | null> | null = null;
let scriptPromise: Promise<void> | null = null;
let inFlight: Promise<void> | null = null;

function getSiteKey(apiBase: string): Promise<string | null> {
  if (!siteKeyPromise) {
    siteKeyPromise = fetch(`${apiBase}/api/config`, { signal: AbortSignal.timeout(8000) })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => (typeof d?.turnstileSiteKey === 'string' && d.turnstileSiteKey ? d.turnstileSiteKey : null))
      .catch(() => {
        siteKeyPromise = null; // no cachear un fallo de red
        return null;
      });
  }
  return siteKeyPromise;
}

function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (!scriptPromise) {
    scriptPromise = new Promise<void>((resolve, reject) => {
      const s = document.createElement('script');
      s.src = SCRIPT_URL;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => {
        scriptPromise = null;
        reject(new Error('No se pudo cargar el servicio de verificación.'));
      };
      document.head.appendChild(s);
    });
  }
  return scriptPromise;
}

async function postToken(apiBase: string, token: string): Promise<{ ok: boolean; message?: string }> {
  try {
    const r = await fetch(`${apiBase}/api/turnstile/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
      credentials: 'same-origin', // la cookie de pase la fija el servidor; solo funciona con la API en el mismo origen/sitio
      signal: AbortSignal.timeout(10_000),
    });
    if (r.ok) return { ok: true };
    const d = await r.json().catch(() => ({}));
    return { ok: false, message: d?.error || 'La verificación falló. Inténtelo de nuevo.' };
  } catch {
    return { ok: false, message: 'No se pudo contactar con el servidor. Inténtelo de nuevo.' };
  }
}

function openChallenge(apiBase: string, siteKey: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4';
    overlay.innerHTML = `
      <div role="dialog" aria-modal="true" aria-labelledby="nc-human-title"
           class="w-full max-w-sm rounded-2xl border border-slate-700 bg-slate-900 p-6 text-slate-200 shadow-2xl">
        <h2 id="nc-human-title" class="text-base font-semibold text-white">Verificación rápida</h2>
        <p class="mt-2 text-sm text-slate-400">Para proteger el servicio frente a usos automatizados, confirme que no es un robot. Solo se pide una vez cada pocos minutos.</p>
        <div data-widget class="mt-4 flex min-h-[70px] justify-center"></div>
        <p data-error role="alert" class="mt-3 hidden text-sm text-red-400"></p>
        <button type="button" data-cancel class="mt-4 w-full rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:bg-slate-800">Cancelar</button>
      </div>`;
    document.body.appendChild(overlay);

    const widgetEl = overlay.querySelector<HTMLElement>('[data-widget]')!;
    const errorEl = overlay.querySelector<HTMLElement>('[data-error]')!;
    const cancelBtn = overlay.querySelector<HTMLButtonElement>('[data-cancel]')!;
    let widgetId: string | undefined;
    cancelBtn.focus();

    const close = () => {
      if (widgetId !== undefined) window.turnstile?.remove(widgetId);
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      previouslyFocused?.focus?.();
    };
    const cancel = () => {
      close();
      reject(new DOMException('Verificación cancelada', 'AbortError'));
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancel();
    };
    document.addEventListener('keydown', onKey);
    cancelBtn.addEventListener('click', cancel);

    const showError = (msg: string) => {
      errorEl.textContent = msg;
      errorEl.classList.remove('hidden');
    };

    loadScript()
      .then(() => {
        widgetId = window.turnstile!.render(widgetEl, {
          sitekey: siteKey,
          theme: 'auto',
          callback: async (token: string) => {
            const res = await postToken(apiBase, token);
            if (res.ok) {
              close();
              resolve();
            } else {
              showError(res.message || 'La verificación falló.');
              window.turnstile?.reset(widgetId);
            }
          },
          'error-callback': () => showError('No se pudo completar el reto. Inténtelo de nuevo.'),
          'expired-callback': () => window.turnstile?.reset(widgetId),
        });
      })
      .catch((e: Error) => {
        close();
        reject(e);
      });
  });
}

/**
 * Garantiza que el usuario tiene un pase válido. Devuelve de inmediato si Turnstile no está configurado.
 * Las llamadas concurrentes comparten un único modal.
 */
export function ensureHumanPass(apiBase: string): Promise<void> {
  if (!inFlight) {
    inFlight = (async () => {
      const siteKey = await getSiteKey(apiBase);
      if (!siteKey) throw new Error('NO_TURNSTILE'); // el servidor lo exige pero no publicó clave: no hay nada que mostrar
      await openChallenge(apiBase, siteKey);
    })().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}
