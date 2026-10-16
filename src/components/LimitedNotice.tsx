import { Info } from 'lucide-react';

/** Aviso cuando el backend no pudo verificar parte de los datos (p. ej. despliegue Edge sin sockets TLS/TCP). */
export function LimitedNotice({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <div
      role="note"
      className="flex items-start gap-3 p-4 rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-200 text-xs leading-relaxed"
    >
      <Info className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
}
