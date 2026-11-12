import { useState, useEffect, useCallback } from 'react';
import { fetchMicroservicesStatus, toggleMicroserviceState } from '../../services/api';

const DEFAULT_MICROSERVICES_CATALOG = [
    {
        ms_id: 'ms-track-map',
        name: 'Track Map Geometry Microservice',
        domain: 'Cartografía GPS & Proyección Normalizada SVG',
        gateway_path: '/ms/track-map',
        local_port: 8021,
        criticality: 'MEDIUM (UI Widget Isolated)',
        fallback_strategy:
            'Aísla el panel Mapa GPS con modo degradado y reintento sin detener la telemetría 20 Hz.',
        endpoints: ['GET /ms/track-map/map', 'GET /ms/track-map/health'],
        enabled: true,
        requests_count: 0,
        errors_count: 0,
    },
    {
        ms_id: 'ms-car-setup',
        name: 'Car Setup & Engineering Microservice',
        domain: 'Parámetros Mecánicos, Suspensión y Aerodinámica',
        gateway_path: '/ms/car-setup',
        local_port: 8022,
        criticality: 'LOW (On-Demand Modal)',
        fallback_strategy:
            'Muestra aviso de mantenimiento en el modal de Setup sin afectar el flujo de pista.',
        endpoints: ['GET /ms/car-setup/setup', 'GET /ms/car-setup/health'],
        enabled: true,
        requests_count: 0,
        errors_count: 0,
    },
    {
        ms_id: 'ms-session-catalog',
        name: 'Session Catalog & DuckDB Loader Microservice',
        domain: 'Catálogo .duckdb, Metadatos WEC/ELMS e Ingesta Wasm',
        gateway_path: '/ms/session-catalog',
        local_port: 8023,
        criticality: 'MEDIUM (Session Management)',
        fallback_strategy:
            'Conserva la sesión activa en RAM y permite abrir archivos .duckdb locales con DuckDB-Wasm.',
        endpoints: [
            'GET /ms/session-catalog/metadata',
            'POST /ms/session-catalog/switch/{filename}',
            'POST /ms/session-catalog/upload',
        ],
        enabled: true,
        requests_count: 0,
        errors_count: 0,
    },
    {
        ms_id: 'ms-telemetry-pack',
        name: 'Vectorized Telemetry 20Hz Microservice',
        domain: 'Extracción Vectorizada 20 Hz (Canales, Ruedas y Eventos)',
        gateway_path: '/ms/telemetry-pack',
        local_port: 8024,
        criticality: 'HIGH (Edge Cached)',
        fallback_strategy:
            'El Service Worker (sw.js) y TelemetryClientEngine sirven el paquete desde CacheStorage.',
        endpoints: ['GET /ms/telemetry-pack/pack', 'GET /ms/telemetry-pack/health'],
        enabled: true,
        requests_count: 0,
        errors_count: 0,
    },
    {
        ms_id: 'ms-room-sync',
        name: 'Room Clock & Presence Sync Microservice',
        domain: 'Reloj Maestro Sincronizado (1.0x) y Presencia MC-MS',
        gateway_path: '/ms/room-sync',
        local_port: 8025,
        criticality: 'MEDIUM (Local Broadcast Mesh Fallback)',
        fallback_strategy:
            'Conmuta automáticamente al bus local BroadcastChannel y reloj performance.now() del navegador.',
        endpoints: ['POST /ms/room-sync/state', 'POST /ms/room-sync/reset'],
        enabled: true,
        requests_count: 0,
        errors_count: 0,
    },
];

export default function MicroservicesModal({ apiBaseUrl, onServiceToggled, onClose }) {
    const [services, setServices] = useState(DEFAULT_MICROSERVICES_CATALOG);
    const [togglingId, setTogglingId] = useState(null);

    const refreshStatus = useCallback(async () => {
        const res = await fetchMicroservicesStatus(apiBaseUrl);
        if (res && Array.isArray(res.microservices)) {
            setServices(res.microservices);
        }
    }, [apiBaseUrl]);

    useEffect(() => {
        refreshStatus();
    }, [refreshStatus]);

    const handleToggle = async (msId, currentEnabled) => {
        setTogglingId(msId);
        const res = await toggleMicroserviceState(msId, !currentEnabled, apiBaseUrl);
        if (res?.cluster_microservices?.microservices) {
            setServices(res.cluster_microservices.microservices);
        } else {
            setServices((prev) =>
                prev.map((s) => (s.ms_id === msId ? { ...s, enabled: !currentEnabled } : s))
            );
        }
        setTogglingId(null);
        onServiceToggled?.(msId, !currentEnabled);
    };

    const onlineCount = services.filter((s) => s.enabled).length;

    return (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4">
            <div className="bg-neutral-900 border border-neutral-700 rounded-lg max-w-5xl w-full max-h-[92vh] sm:max-h-[88vh] flex flex-col shadow-2xl font-mono overflow-hidden">
                <div className="p-3 sm:p-4 border-b border-neutral-800 flex flex-wrap justify-between items-center gap-3 sm:gap-4">
                    <div className="min-w-0">
                        <div className="text-[10px] uppercase tracking-widest text-emerald-400">
                            Arquitectura de Software • Aislamiento de Fallos (Bulkhead & Circuit Breaker)
                        </div>
                        <h3 className="text-sm sm:text-lg font-bold text-white mt-0.5">
                            ORQUESTADOR DE MICROSERVICIOS ATÓMICOS ({onlineCount}/{services.length} ACTIVOS)
                        </h3>
                    </div>
                    <div className="flex flex-wrap gap-2 w-full sm:w-auto">
                        <button
                            onClick={refreshStatus}
                            className="flex-1 sm:flex-initial px-3 py-1.5 sm:py-1 rounded bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 text-xs border border-blue-500/40 cursor-pointer"
                        >
                            REFRESCAR ESTADO
                        </button>
                        <button
                            onClick={onClose}
                            className="flex-1 sm:flex-initial px-3 py-1.5 sm:py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-xs border border-neutral-700 cursor-pointer"
                        >
                            CERRAR
                        </button>
                    </div>
                </div>

                <div className="px-3 sm:px-4 py-2 sm:py-2.5 bg-neutral-950 border-b border-neutral-800 text-[11px] text-neutral-400">
                    Puedes simular la caída individual (<code className="text-red-400">HTTP 503</code>) de cualquier
                    microservicio (por ejemplo, <strong className="text-white">ms-track-map</strong>) para comprobar que
                    el resto de la PWA continúa funcionando sin interrupción.
                </div>

                <div className="p-3 sm:p-4 overflow-y-auto grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-3.5 text-xs">
                    {services.map((ms) => {
                        const isOnline = Boolean(ms.enabled);
                        return (
                            <div
                                key={ms.ms_id}
                                className={`rounded-lg border p-3.5 flex flex-col justify-between gap-3 transition ${
                                    isOnline
                                        ? 'bg-neutral-950 border-neutral-800'
                                        : 'bg-red-950/20 border-red-500/40'
                                }`}
                            >
                                <div>
                                    <div className="flex justify-between items-start gap-2">
                                        <div>
                                            <span className="text-[10px] text-cyan-400 font-bold">
                                                {ms.ms_id} (:{ms.local_port})
                                            </span>
                                            <h4 className="text-sm font-bold text-white mt-0.5">{ms.name}</h4>
                                        </div>
                                        <span
                                            className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                                                isOnline
                                                    ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                                                    : 'bg-red-500/20 text-red-400 border-red-500/40 animate-pulse'
                                            }`}
                                        >
                                            {isOnline ? 'ONLINE (200)' : 'OFFLINE (503)'}
                                        </span>
                                    </div>

                                    <div className="mt-2 text-[11px] text-neutral-300">{ms.domain}</div>

                                    <div className="mt-2 bg-neutral-900/90 border border-neutral-800 rounded p-2 text-[10px] text-neutral-400">
                                        <strong className="text-neutral-300">Tolerancia al fallo:</strong>{' '}
                                        {ms.fallback_strategy}
                                    </div>

                                    <div className="mt-2 flex flex-wrap gap-1">
                                        {(ms.endpoints || []).map((ep) => (
                                            <span
                                                key={ep}
                                                className="px-1.5 py-0.5 rounded bg-neutral-900 border border-neutral-800 text-[9px] text-neutral-400"
                                            >
                                                {ep}
                                            </span>
                                        ))}
                                    </div>
                                </div>

                                <div className="pt-2 border-t border-neutral-800/80 flex justify-between items-center">
                                    <div className="text-[10px] text-neutral-500">
                                        Peticiones: <strong className="text-neutral-300">{ms.requests_count ?? 0}</strong>{' '}
                                        • Errores 503:{' '}
                                        <strong className="text-red-400">{ms.errors_count ?? 0}</strong>
                                    </div>

                                    <button
                                        onClick={() => handleToggle(ms.ms_id, isOnline)}
                                        disabled={togglingId === ms.ms_id}
                                        className={`px-2.5 py-1 rounded text-[10px] font-bold border transition cursor-pointer ${
                                            isOnline
                                                ? 'bg-red-500/15 hover:bg-red-500/25 text-red-300 border-red-500/30'
                                                : 'bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border-emerald-500/40'
                                        }`}
                                    >
                                        {togglingId === ms.ms_id
                                            ? 'APLICANDO...'
                                            : isOnline
                                            ? 'SIMULAR CAÍDA (503)'
                                            : 'REACTIVAR SERVICIO'}
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
