import React, { useState, useEffect, useRef } from 'react';
import {
  Gauge,
  ArrowDown,
  ArrowUp,
  Activity,
  Play,
  RotateCcw,
  Square,
  CheckCircle2,
  Copy,
  Download,
  Server,
  Zap,
  Globe,
  Radio,
  Gamepad2,
  Tv,
  Video,
  Info,
} from 'lucide-react';
import { useToast } from '../Toast';
import { saveHistoryItem } from '../../lib/history';
import { getSpeedTestEndpoints } from '../../lib/api';
import {
  SpeedTestResult,
  SpeedTestPoint,
  SpeedTestPingData,
  SpeedTestThroughputData,
} from '../../types/network';

interface SpeedTestToolProps {
  onRunQuery?: () => void;
}

type TestPhase = 'idle' | 'ping' | 'download' | 'upload' | 'complete' | 'error';
type ServerChoice = 'local' | 'cloudflare';

export const SpeedTestTool: React.FC<SpeedTestToolProps> = ({ onRunQuery }) => {
  const { toast } = useToast();

  const [phase, setPhase] = useState<TestPhase>('idle');
  const [serverChoice, setServerChoice] = useState<ServerChoice>('local');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Live Metrics
  const [pingData, setPingData] = useState<SpeedTestPingData>({
    current: 0,
    min: 0,
    avg: 0,
    max: 0,
    jitter: 0,
  });

  const [downloadData, setDownloadData] = useState<SpeedTestThroughputData>({
    currentMbps: 0,
    avgMbps: 0,
    peakMbps: 0,
    transferredBytes: 0,
  });

  const [uploadData, setUploadData] = useState<SpeedTestThroughputData>({
    currentMbps: 0,
    avgMbps: 0,
    peakMbps: 0,
    transferredBytes: 0,
  });

  const [loadedPing, setLoadedPing] = useState<number>(0);
  const [graphPoints, setGraphPoints] = useState<SpeedTestPoint[]>([]);
  const [finalResult, setFinalResult] = useState<SpeedTestResult | null>(null);
  const [copied, setCopied] = useState(false);

  // Connection metadata (Navigator API & IP)
  const [connectionInfo, setConnectionInfo] = useState<{
    effectiveType?: string;
    downlink?: number;
    rtt?: number;
  }>({});

  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (typeof navigator !== 'undefined' && (navigator as any).connection) {
      const conn = (navigator as any).connection;
      setConnectionInfo({
        effectiveType: conn.effectiveType?.toUpperCase(),
        downlink: conn.downlink,
        rtt: conn.rtt,
      });
    }
  }, []);

  const resetMetrics = () => {
    setPingData({ current: 0, min: 0, avg: 0, max: 0, jitter: 0 });
    setDownloadData({ currentMbps: 0, avgMbps: 0, peakMbps: 0, transferredBytes: 0 });
    setUploadData({ currentMbps: 0, avgMbps: 0, peakMbps: 0, transferredBytes: 0 });
    setLoadedPing(0);
    setGraphPoints([]);
    setFinalResult(null);
    setErrorMessage(null);
  };

  const cancelTest = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setPhase('idle');
    toast('Prueba de velocidad cancelada', 'info');
  };

  // Helper to measure a single ping
  const measurePing = async (pingUrl: string, signal: AbortSignal): Promise<number> => {
    const t0 = performance.now();
    const separator = pingUrl.includes('?') ? '&' : '?';
    const cacheBuster = `${separator}_t=${Date.now()}_${Math.random()}`;
    await fetch(pingUrl + cacheBuster, {
      method: 'GET',
      cache: 'no-store',
      signal,
    });
    return performance.now() - t0;
  };

  // Main Speed Test Runner
  const runSpeedTest = async () => {
    resetMetrics();
    const abort = new AbortController();
    abortControllerRef.current = abort;
    const signal = abort.signal;

    const endpoints = getSpeedTestEndpoints(serverChoice);

    try {
      // ---------------------------------------------------------
      // FASE 1: Latencia (Ping) y Jitter (10 muestras sucesivas)
      // ---------------------------------------------------------
      setPhase('ping');
      const pingSamples: number[] = [];
      const testStart = performance.now();

      for (let i = 0; i < 10; i++) {
        if (signal.aborted) return;
        try {
          const rtt = await measurePing(endpoints.pingUrl, signal);
          pingSamples.push(rtt);

          const min = Math.min(...pingSamples);
          const max = Math.max(...pingSamples);
          const sum = pingSamples.reduce((a, b) => a + b, 0);
          const avg = sum / pingSamples.length;

          // Jitter = media de diferencias absolutas
          let jitter = 0;
          if (pingSamples.length > 1) {
            let diffSum = 0;
            for (let j = 1; j < pingSamples.length; j++) {
              diffSum += Math.abs(pingSamples[j] - pingSamples[j - 1]);
            }
            jitter = diffSum / (pingSamples.length - 1);
          }

          setPingData({
            current: Math.round(rtt * 10) / 10,
            min: Math.round(min * 10) / 10,
            avg: Math.round(avg * 10) / 10,
            max: Math.round(max * 10) / 10,
            jitter: Math.round(jitter * 10) / 10,
          });

          setGraphPoints((prev) => [
            ...prev,
            {
              timeMs: Math.round(performance.now() - testStart),
              phase: 'ping',
              mbps: 0,
              pingMs: Math.round(rtt),
            },
          ]);

          // Pequeña pausa entre pings para no saturar la red
          await new Promise((r) => setTimeout(r, 60));
        } catch (err: any) {
          if (signal.aborted) return;
          console.warn('Ping sample failed:', err);
        }
      }

      if (pingSamples.length === 0) {
        throw new Error('No se pudo establecer conexión con el servidor de prueba.');
      }

      // ---------------------------------------------------------
      // FASE 2: Prueba de Descarga (Download Mbps)
      // ---------------------------------------------------------
      setPhase('download');

      // Adaptable chunk sizing across 3 parallel download streams
      const streamCount = 3;
      const downloadTargetSeconds = 7;
      const downloadStart = performance.now();
      let totalDownloaded = 0;
      let peakDownloadMbps = 0;

      // Medición de ping bajo carga
      let activeLoadedPing = 0;

      const runDownloadStream = async (streamIndex: number) => {
        let chunkBytes = 1.5 * 1024 * 1024; // Inicia con 1.5MB

        while (performance.now() - downloadStart < downloadTargetSeconds * 1000) {
          if (signal.aborted) break;

          const url = endpoints.downUrl(chunkBytes);
          const separator = url.includes('?') ? '&' : '?';
          const cacheBuster = `${separator}_s=${streamIndex}_t=${Date.now()}`;

          const t0 = performance.now();
          const response = await fetch(url + cacheBuster, {
            cache: 'no-store',
            signal,
          });

          if (!response.body) {
            const buf = await response.arrayBuffer();
            totalDownloaded += buf.byteLength;
          } else {
            const reader = response.body.getReader();
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              if (value) {
                totalDownloaded += value.length;
                const elapsedSec = (performance.now() - downloadStart) / 1000;
                if (elapsedSec > 0.2) {
                  const instantMbps = (totalDownloaded * 8) / elapsedSec / 1000000;
                  if (instantMbps > peakDownloadMbps) peakDownloadMbps = instantMbps;

                  setDownloadData({
                    currentMbps: Math.round(instantMbps * 10) / 10,
                    avgMbps: Math.round(instantMbps * 10) / 10,
                    peakMbps: Math.round(peakDownloadMbps * 10) / 10,
                    transferredBytes: totalDownloaded,
                  });

                  setGraphPoints((prev) => [
                    ...prev.slice(-80),
                    {
                      timeMs: Math.round(performance.now() - testStart),
                      phase: 'download',
                      mbps: Math.round(instantMbps * 10) / 10,
                    },
                  ]);
                }
              }
            }
          }

          const streamElapsed = (performance.now() - t0) / 1000;
          // Escalar tamaño de chunk si la conexión es muy veloz
          if (streamElapsed < 0.4 && chunkBytes < 15 * 1024 * 1024) {
            chunkBytes = Math.min(chunkBytes * 2, 15 * 1024 * 1024);
          }
        }
      };

      // Lanzar pings intercalados para medir Bufferbloat durante la descarga
      const measureLoadedLatency = async () => {
        await new Promise((r) => setTimeout(r, 1200));
        if (signal.aborted) return;
        try {
          const lp = await measurePing(endpoints.pingUrl, signal);
          activeLoadedPing = lp;
          setLoadedPing(Math.round(lp * 10) / 10);
        } catch {
          // continuar
        }
      };

      await Promise.all([
        ...Array.from({ length: streamCount }, (_, idx) => runDownloadStream(idx)),
        measureLoadedLatency(),
      ]);

      const downloadElapsed = (performance.now() - downloadStart) / 1000;
      const finalDownloadMbps = downloadElapsed > 0 ? (totalDownloaded * 8) / downloadElapsed / 1000000 : 0;
      const roundedDownload = Math.round(finalDownloadMbps * 10) / 10;
      const roundedPeakDownload = Math.round(Math.max(peakDownloadMbps, finalDownloadMbps) * 10) / 10;

      setDownloadData({
        currentMbps: roundedDownload,
        avgMbps: roundedDownload,
        peakMbps: roundedPeakDownload,
        transferredBytes: totalDownloaded,
      });

      // ---------------------------------------------------------
      // FASE 3: Prueba de Subida (Upload Mbps)
      // ---------------------------------------------------------
      setPhase('upload');

      const uploadTargetSeconds = 5;
      const uploadStart = performance.now();
      let totalUploaded = 0;
      let peakUploadMbps = 0;

      // Generar payload binario aleatorio en cliente (1MB por paquete)
      const uploadChunkSize = 1024 * 1024;
      const uploadBuffer = new Uint8Array(uploadChunkSize);
      for (let i = 0; i < uploadChunkSize; i++) {
        uploadBuffer[i] = (i * 47 + 13) & 0xff;
      }

      const runUploadStream = async () => {
        while (performance.now() - uploadStart < uploadTargetSeconds * 1000) {
          if (signal.aborted) break;

          const t0 = performance.now();
          await fetch(endpoints.upUrl, {
            method: 'POST',
            body: uploadBuffer,
            cache: 'no-store',
            signal,
          });

          totalUploaded += uploadBuffer.byteLength;
          const elapsedSec = (performance.now() - uploadStart) / 1000;
          if (elapsedSec > 0.2) {
            const instantMbps = (totalUploaded * 8) / elapsedSec / 1000000;
            if (instantMbps > peakUploadMbps) peakUploadMbps = instantMbps;

            setUploadData({
              currentMbps: Math.round(instantMbps * 10) / 10,
              avgMbps: Math.round(instantMbps * 10) / 10,
              peakMbps: Math.round(peakUploadMbps * 10) / 10,
              transferredBytes: totalUploaded,
            });

            setGraphPoints((prev) => [
              ...prev.slice(-100),
              {
                timeMs: Math.round(performance.now() - testStart),
                phase: 'upload',
                mbps: Math.round(instantMbps * 10) / 10,
              },
            ]);
          }
        }
      };

      await Promise.all([runUploadStream(), runUploadStream()]);

      const uploadElapsed = (performance.now() - uploadStart) / 1000;
      const finalUploadMbps = uploadElapsed > 0 ? (totalUploaded * 8) / uploadElapsed / 1000000 : 0;
      const roundedUpload = Math.round(finalUploadMbps * 10) / 10;
      const roundedPeakUpload = Math.round(Math.max(peakUploadMbps, finalUploadMbps) * 10) / 10;

      setUploadData({
        currentMbps: roundedUpload,
        avgMbps: roundedUpload,
        peakMbps: roundedPeakUpload,
        transferredBytes: totalUploaded,
      });

      // ---------------------------------------------------------
      // FASE 4: Consolidación y Calificación de Red
      // ---------------------------------------------------------
      const idleAvgPing = pingSamples.reduce((a, b) => a + b, 0) / pingSamples.length;
      const effectiveLoadedPing = activeLoadedPing > 0 ? activeLoadedPing : idleAvgPing * 1.25;
      const pingDiff = Math.max(0, effectiveLoadedPing - idleAvgPing);

      let bufferbloatGrade: 'A+' | 'A' | 'B' | 'C' | 'D' | 'F' = 'A';
      if (pingDiff < 5) bufferbloatGrade = 'A+';
      else if (pingDiff < 15) bufferbloatGrade = 'A';
      else if (pingDiff < 40) bufferbloatGrade = 'B';
      else if (pingDiff < 100) bufferbloatGrade = 'C';
      else if (pingDiff < 200) bufferbloatGrade = 'D';
      else bufferbloatGrade = 'F';

      const result: SpeedTestResult = {
        ping: {
          current: Math.round(pingSamples[pingSamples.length - 1] * 10) / 10,
          min: Math.round(Math.min(...pingSamples) * 10) / 10,
          avg: Math.round(idleAvgPing * 10) / 10,
          max: Math.round(Math.max(...pingSamples) * 10) / 10,
          jitter: pingData.jitter,
        },
        download: {
          currentMbps: roundedDownload,
          avgMbps: roundedDownload,
          peakMbps: roundedPeakDownload,
          transferredBytes: totalDownloaded,
        },
        upload: {
          currentMbps: roundedUpload,
          avgMbps: roundedUpload,
          peakMbps: roundedPeakUpload,
          transferredBytes: totalUploaded,
        },
        bufferbloat: {
          idlePing: Math.round(idleAvgPing * 10) / 10,
          loadedPing: Math.round(effectiveLoadedPing * 10) / 10,
          difference: Math.round(pingDiff * 10) / 10,
          grade: bufferbloatGrade,
        },
        server: {
          name: endpoints.name,
          location: endpoints.location,
          endpoint: serverChoice,
        },
        timestamp: Date.now(),
      };

      setFinalResult(result);
      setPhase('complete');

      // Guardar en historial de diagnósticos
      saveHistoryItem(
        'speedtest',
        `${roundedDownload} Mbps ↓ / ${roundedUpload} Mbps ↑ (${endpoints.name})`,
        `${result.ping.avg} ms`
      );
      if (onRunQuery) onRunQuery();

      toast('Prueba de velocidad completada con éxito', 'success');
    } catch (err: any) {
      if (signal.aborted) return;
      console.error('Error durante test de velocidad:', err);
      setPhase('error');
      setErrorMessage(err.message || 'Error al ejecutar la prueba de velocidad.');
      toast('Fallo en la prueba de velocidad', 'error');
    } finally {
      abortControllerRef.current = null;
    }
  };

  const copyResults = () => {
    if (!finalResult) return;
    const text = [
      `🌐 Network Tools Hub · Test de Velocidad de Conexión`,
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      `⬇️ Descarga:  ${finalResult.download.avgMbps} Mbps (Pico: ${finalResult.download.peakMbps} Mbps)`,
      `⬆️ Subida:    ${finalResult.upload.avgMbps} Mbps (Pico: ${finalResult.upload.peakMbps} Mbps)`,
      `⏱️ Latencia:   ${finalResult.ping.avg} ms (Mín: ${finalResult.ping.min} ms · Máx: ${finalResult.ping.max} ms)`,
      `⚡ Jitter:     ${finalResult.ping.jitter} ms`,
      `🛡️ Bufferbloat: Grado ${finalResult.bufferbloat.grade} (+${finalResult.bufferbloat.difference} ms bajo carga)`,
      `🏢 Servidor:   ${finalResult.server.name} (${finalResult.server.location})`,
      `📅 Fecha:      ${new Date(finalResult.timestamp).toLocaleString()}`,
    ].join('\n');

    navigator.clipboard.writeText(text);
    setCopied(true);
    toast('Resultados copiados al portapapeles', 'success');
    setTimeout(() => setCopied(false), 2000);
  };

  const downloadJson = () => {
    if (!finalResult) return;
    const blob = new Blob([JSON.stringify(finalResult, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `speedtest-results-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast('Informe JSON exportado', 'info');
  };

  // Helper values for the active meter
  const currentSpeed =
    phase === 'download'
      ? downloadData.currentMbps
      : phase === 'upload'
      ? uploadData.currentMbps
      : phase === 'complete'
      ? finalResult?.download.avgMbps || 0
      : 0;

  // SVG Gauge calculations (270 degrees sweep)
  const radius = 95;
  const circumference = 2 * Math.PI * radius;
  // Sweep from 135 deg to 405 deg (270 total deg, 75% of circle)
  const arcTotalLength = circumference * 0.75;
  // Non-linear mapping for speeds (0 to 1000 Mbps)
  const progressRatio = Math.min(1, Math.log10(Math.max(1, currentSpeed + 1)) / Math.log10(1001));
  const strokeDashoffset = arcTotalLength * (1 - progressRatio);

  return (
    <div className="space-y-6">
      {/* Selector de Servidor y Cabecera de Control */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Gauge className="w-5 h-5 text-cyan-400" />
            <h3 className="text-base font-bold text-slate-100">
              Test de Velocidad y Calidad de Conexión
            </h3>
          </div>
          <p className="text-xs text-slate-400">
            Medición bidireccional en tiempo real de ancho de banda (Mbps), latencia RTT, jitter y bufferbloat.
          </p>
        </div>

        {/* Segmented Control para Selección de Nodo */}
        <div className="flex items-center gap-2 self-start md:self-auto">
          <div className="flex items-center p-1 bg-slate-950/80 rounded-lg border border-slate-800 text-xs">
            <button
              onClick={() => setServerChoice('local')}
              disabled={phase !== 'idle' && phase !== 'complete' && phase !== 'error'}
              className={`px-3 py-1.5 font-medium rounded-md transition-colors ${
                serverChoice === 'local'
                  ? 'bg-slate-800 text-cyan-400 font-bold shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              } disabled:opacity-50`}
            >
              Servidor Edge de la App
            </button>
            <button
              onClick={() => setServerChoice('cloudflare')}
              disabled={phase !== 'idle' && phase !== 'complete' && phase !== 'error'}
              className={`px-3 py-1.5 font-medium rounded-md transition-colors ${
                serverChoice === 'cloudflare'
                  ? 'bg-slate-800 text-cyan-400 font-bold shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              } disabled:opacity-50`}
            >
              Cloudflare Global CDN
            </button>
          </div>

          {phase === 'idle' || phase === 'complete' || phase === 'error' ? (
            <button
              onClick={runSpeedTest}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-bold transition-all shadow-sm shadow-cyan-500/20 whitespace-nowrap"
            >
              <Play className="w-4 h-4 fill-current" />
              <span>{phase === 'complete' ? 'Repetir Test' : 'Iniciar Test'}</span>
            </button>
          ) : (
            <button
              onClick={cancelTest}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-rose-500/20 border border-rose-500/40 hover:bg-rose-500/30 text-rose-400 text-xs font-bold transition-colors whitespace-nowrap"
            >
              <Square className="w-3.5 h-3.5 fill-current" />
              <span>Cancelar</span>
            </button>
          )}
        </div>
      </div>

      {/* Panel Principal: Indicador Velocímetro y Métricas en Tiempo Real */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Velocímetro Central */}
        <div className="lg:col-span-6 rounded-xl border border-slate-800 bg-slate-900/40 p-6 flex flex-col items-center justify-center relative overflow-hidden min-h-[380px]">
          {/* Fondo sutil de cuadrícula técnica */}
          <div className="absolute inset-0 bg-[radial-gradient(#1e293b_1px,transparent_1px)] [background-size:16px_16px] opacity-25 pointer-events-none" />

          {/* Estado de la fase activa */}
          <div className="z-10 mb-2">
            <span
              className={`text-xs font-mono uppercase tracking-wider px-2.5 py-1 rounded-md border ${
                phase === 'ping'
                  ? 'bg-amber-500/10 border-amber-500/30 text-amber-400 animate-pulse'
                  : phase === 'download'
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 animate-pulse'
                  : phase === 'upload'
                  ? 'bg-violet-500/10 border-violet-500/30 text-violet-400 animate-pulse'
                  : phase === 'complete'
                  ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-400'
                  : 'bg-slate-800/60 border-slate-700/60 text-slate-400'
              }`}
            >
              {phase === 'idle' && 'Listo para Medir'}
              {phase === 'ping' && 'Midiendo Latencia y Jitter...'}
              {phase === 'download' && 'Midiendo Descarga (Download)...'}
              {phase === 'upload' && 'Midiendo Subida (Upload)...'}
              {phase === 'complete' && 'Test Completado'}
              {phase === 'error' && 'Error de Conexión'}
            </span>
          </div>

          {/* SVG Circular Speedometer */}
          <div className="relative w-64 h-64 flex items-center justify-center z-10">
            <svg className="w-full h-full -rotate-45" viewBox="0 0 240 240">
              {/* Círculo de pista base (270 grados) */}
              <circle
                cx="120"
                cy="120"
                r={radius}
                className="stroke-slate-800"
                strokeWidth="12"
                fill="transparent"
                strokeDasharray={`${arcTotalLength} ${circumference}`}
                strokeLinecap="round"
              />
              {/* Arco activo con gradiente dinámico */}
              <circle
                cx="120"
                cy="120"
                r={radius}
                className={`transition-all duration-150 ease-out ${
                  phase === 'upload'
                    ? 'stroke-violet-400'
                    : phase === 'download'
                    ? 'stroke-emerald-400'
                    : 'stroke-cyan-400'
                }`}
                strokeWidth="12"
                fill="transparent"
                strokeDasharray={`${arcTotalLength} ${circumference}`}
                strokeDashoffset={strokeDashoffset}
                strokeLinecap="round"
                style={{
                  filter:
                    phase === 'download'
                      ? 'drop-shadow(0 0 8px rgba(52, 211, 153, 0.4))'
                      : phase === 'upload'
                      ? 'drop-shadow(0 0 8px rgba(167, 139, 250, 0.4))'
                      : 'none',
                }}
              />
            </svg>

            {/* Lectura numérica central */}
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
              <span className="text-5xl font-extrabold font-mono tracking-tight text-slate-100">
                {currentSpeed.toFixed(currentSpeed >= 100 ? 0 : 1)}
              </span>
              <span className="text-xs uppercase font-mono tracking-widest text-slate-400 mt-1">
                Mbps
              </span>
              <span className="text-[11px] font-mono text-slate-500 mt-1">
                {phase === 'download' && '↓ Descarga'}
                {phase === 'upload' && '↑ Subida'}
                {phase === 'complete' && 'Resultado Final'}
                {phase === 'ping' && 'Analizando RTT...'}
                {phase === 'idle' && 'Pulsa Iniciar'}
              </span>
            </div>
          </div>

          {/* Gráfico Sparkline de Throughput en tiempo real */}
          {graphPoints.length > 3 && (
            <div className="w-full mt-4 pt-3 border-t border-slate-800/80 z-10">
              <div className="flex items-center justify-between text-[11px] font-mono text-slate-500 mb-1.5">
                <span>Curva de Rendimiento en Vivo</span>
                <span>{graphPoints[graphPoints.length - 1]?.mbps || 0} Mbps</span>
              </div>
              <div className="h-14 w-full flex items-end gap-0.5 bg-slate-950/60 p-1.5 rounded-lg border border-slate-800/60 overflow-hidden">
                {graphPoints.slice(-40).map((pt, idx) => {
                  const maxMbps = Math.max(...graphPoints.map((p) => p.mbps), 20);
                  const heightPercent = Math.max(6, Math.min(100, (pt.mbps / maxMbps) * 100));
                  return (
                    <div
                      key={idx}
                      className={`flex-1 rounded-t-sm transition-all duration-75 ${
                        pt.phase === 'upload'
                          ? 'bg-violet-400/80'
                          : pt.phase === 'download'
                          ? 'bg-emerald-400/80'
                          : 'bg-amber-400/60'
                      }`}
                      style={{ height: `${heightPercent}%` }}
                      title={`${pt.phase}: ${pt.mbps} Mbps`}
                    />
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Métricas Principales en Tarjetas de Cuadrícula */}
        <div className="lg:col-span-6 flex flex-col justify-between gap-3">
          {/* Fila 1: Descarga y Subida */}
          <div className="grid grid-cols-2 gap-3">
            {/* Tarjeta Descarga */}
            <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-400">
                  <ArrowDown className="w-4 h-4" />
                  <span>Descarga</span>
                </div>
                <span className="text-[10px] font-mono text-slate-500">Download</span>
              </div>
              <div>
                <div className="text-3xl font-extrabold font-mono text-slate-100">
                  {downloadData.avgMbps > 0 ? downloadData.avgMbps.toFixed(1) : '--'}
                  <span className="text-xs font-normal text-slate-400 ml-1">Mbps</span>
                </div>
                <div className="flex items-center gap-2 text-[11px] font-mono text-slate-400 mt-1">
                  <span>Pico: {downloadData.peakMbps > 0 ? `${downloadData.peakMbps.toFixed(1)} Mbps` : '--'}</span>
                  <span>·</span>
                  <span>{(downloadData.transferredBytes / (1024 * 1024)).toFixed(1)} MB</span>
                </div>
              </div>
            </div>

            {/* Tarjeta Subida */}
            <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-violet-400">
                  <ArrowUp className="w-4 h-4" />
                  <span>Subida</span>
                </div>
                <span className="text-[10px] font-mono text-slate-500">Upload</span>
              </div>
              <div>
                <div className="text-3xl font-extrabold font-mono text-slate-100">
                  {uploadData.avgMbps > 0 ? uploadData.avgMbps.toFixed(1) : '--'}
                  <span className="text-xs font-normal text-slate-400 ml-1">Mbps</span>
                </div>
                <div className="flex items-center gap-2 text-[11px] font-mono text-slate-400 mt-1">
                  <span>Pico: {uploadData.peakMbps > 0 ? `${uploadData.peakMbps.toFixed(1)} Mbps` : '--'}</span>
                  <span>·</span>
                  <span>{(uploadData.transferredBytes / (1024 * 1024)).toFixed(1)} MB</span>
                </div>
              </div>
            </div>
          </div>

          {/* Fila 2: Latencia, Jitter y Bufferbloat */}
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3 space-y-1">
              <span className="text-[11px] text-slate-400 block">Latencia (Ping)</span>
              <span className="text-xl font-bold font-mono text-amber-400">
                {pingData.avg > 0 ? `${pingData.avg.toFixed(1)}` : '--'}
                <span className="text-xs text-slate-500 ml-0.5">ms</span>
              </span>
              <span className="text-[10px] font-mono text-slate-500 block truncate">
                Mín: {pingData.min > 0 ? `${pingData.min}ms` : '--'}
              </span>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3 space-y-1">
              <span className="text-[11px] text-slate-400 block">Jitter (Var)</span>
              <span className="text-xl font-bold font-mono text-cyan-400">
                {pingData.jitter > 0 ? `${pingData.jitter.toFixed(1)}` : '--'}
                <span className="text-xs text-slate-500 ml-0.5">ms</span>
              </span>
              <span className="text-[10px] font-mono text-slate-500 block truncate">
                Máx: {pingData.max > 0 ? `${pingData.max}ms` : '--'}
              </span>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3 space-y-1">
              <span className="text-[11px] text-slate-400 block">Bufferbloat</span>
              <div className="flex items-baseline gap-1">
                <span className="text-xl font-bold font-mono text-emerald-400">
                  {finalResult?.bufferbloat.grade || (loadedPing > 0 ? 'Eval.' : '--')}
                </span>
                {loadedPing > 0 && (
                  <span className="text-[10px] font-mono text-slate-400">
                    +{Math.round(Math.max(0, loadedPing - pingData.avg))}ms
                  </span>
                )}
              </div>
              <span className="text-[10px] font-mono text-slate-500 block truncate">
                Bajo carga activa
              </span>
            </div>
          </div>

          {/* Información del Servidor y Conexión */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3.5 flex items-center justify-between text-xs">
            <div className="flex items-center gap-2.5">
              <Server className="w-4 h-4 text-cyan-400 shrink-0" />
              <div>
                <span className="font-semibold text-slate-200 block text-xs">
                  {getSpeedTestEndpoints(serverChoice).name}
                </span>
                <span className="text-[11px] text-slate-400">
                  {getSpeedTestEndpoints(serverChoice).location}
                </span>
              </div>
            </div>

            {connectionInfo.effectiveType && (
              <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-300">
                {connectionInfo.effectiveType}
              </span>
            )}
          </div>

          {/* Botones de acción tras completar */}
          {finalResult && (
            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={copyResults}
                className="flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-slate-700 bg-slate-800/80 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition-colors"
              >
                {copied ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? 'Copiado' : 'Copiar Resumen'}</span>
              </button>
              <button
                onClick={downloadJson}
                className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-slate-800 bg-slate-900/80 hover:bg-slate-800 text-slate-300 text-xs font-semibold transition-colors"
                title="Descargar informe JSON"
              >
                <Download className="w-3.5 h-3.5" />
                <span>JSON</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Evaluación de Idoneidad para Actividades (Streaming 4K, Gaming, Videollamadas) */}
      {finalResult && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5 space-y-4">
          <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wider font-mono flex items-center gap-2">
            <Zap className="w-4 h-4 text-cyan-400" />
            <span>Evaluación de Idoneidad para Aplicaciones y Servicios</span>
          </h4>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {/* Gaming */}
            <div className="rounded-lg border border-slate-800/80 bg-slate-950/60 p-3.5 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-slate-200 text-xs font-semibold">
                  <Gamepad2 className="w-4 h-4 text-emerald-400" />
                  <span>Juegos en Línea</span>
                </div>
                <span
                  className={`text-[10px] font-mono font-bold ${
                    finalResult.ping.avg <= 30 && finalResult.ping.jitter <= 5
                      ? 'text-emerald-400'
                      : finalResult.ping.avg <= 60
                      ? 'text-cyan-400'
                      : 'text-amber-400'
                  }`}
                >
                  {finalResult.ping.avg <= 30 && finalResult.ping.jitter <= 5
                    ? 'Excelente'
                    : finalResult.ping.avg <= 60
                    ? 'Bueno'
                    : 'Aceptable'}
                </span>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Ping de {finalResult.ping.avg}ms y jitter de {finalResult.ping.jitter}ms.
                {finalResult.ping.avg <= 30
                  ? ' Sin retardo perceptible en partidas competitivas.'
                  : ' Conexión adecuada para juego multijugador estándar.'}
              </p>
            </div>

            {/* Streaming 4K / 8K */}
            <div className="rounded-lg border border-slate-800/80 bg-slate-950/60 p-3.5 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-slate-200 text-xs font-semibold">
                  <Tv className="w-4 h-4 text-cyan-400" />
                  <span>Streaming 4K / 8K</span>
                </div>
                <span
                  className={`text-[10px] font-mono font-bold ${
                    finalResult.download.avgMbps >= 25 ? 'text-emerald-400' : 'text-amber-400'
                  }`}
                >
                  {finalResult.download.avgMbps >= 100
                    ? 'Óptimo (Múltiple 4K)'
                    : finalResult.download.avgMbps >= 25
                    ? 'Suficiente 4K'
                    : 'HD 1080p'}
                </span>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                {finalResult.download.avgMbps >= 25
                  ? `Ancho de banda suficiente (${finalResult.download.avgMbps} Mbps) para reproducir contenido 4K HDR sin pausas de búfer.`
                  : `Se recomiendan al menos 25 Mbps para contenido 4K ininterrumpido.`}
              </p>
            </div>

            {/* Videollamadas & Teletrabajo */}
            <div className="rounded-lg border border-slate-800/80 bg-slate-950/60 p-3.5 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-slate-200 text-xs font-semibold">
                  <Video className="w-4 h-4 text-violet-400" />
                  <span>Videollamadas HD</span>
                </div>
                <span
                  className={`text-[10px] font-mono font-bold ${
                    finalResult.upload.avgMbps >= 10 && finalResult.ping.jitter <= 15
                      ? 'text-emerald-400'
                      : 'text-cyan-400'
                  }`}
                >
                  {finalResult.upload.avgMbps >= 10 && finalResult.ping.jitter <= 15
                    ? 'Excelente'
                    : 'Adecuado'}
                </span>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Subida de {finalResult.upload.avgMbps} Mbps con estabilidad de bufferbloat{' '}
                {finalResult.bufferbloat.grade}. Fluidez garantizada en Zoom, Meet y Teams.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Manejo de errores si la prueba falla */}
      {errorMessage && (
        <div className="p-4 rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-300 text-xs flex items-center gap-3">
          <Info className="w-4 h-4 shrink-0 text-rose-400" />
          <span>{errorMessage}</span>
        </div>
      )}
    </div>
  );
};
