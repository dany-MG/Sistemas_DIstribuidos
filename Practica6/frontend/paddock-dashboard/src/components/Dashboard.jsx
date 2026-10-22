import { useState, useEffect, useMemo } from 'react';
import {
    getApiNodes,
    DATA_NODES,
    getClientId,
    buildStreamUrl,
    fetchDashboardData,
    fetchTrackMap,
    fetchClusterStatus,
    resetPlayback,
    switchSession,
    getCarImageUrl,
} from '../services/api';
import { LineChart, Line, YAxis, ResponsiveContainer } from 'recharts';

const formatTime = (timeInSeconds) => {
    if (!timeInSeconds || timeInSeconds <= 0) return "00:00.000";
    
    const minutes = Math.floor(timeInSeconds / 60);
    const seconds = timeInSeconds % 60;
    
    return `${minutes.toString().padStart(2, '0')}:${seconds.toFixed(3).padStart(6, '0')}`;
};

const getTyreTempColor = (tempC) => {
    if (tempC < 60) return "text-sky-400 border-sky-500/30 bg-sky-500/10";
    if (tempC <= 95) return "text-emerald-400 border-emerald-500/30 bg-emerald-500/10";
    return "text-red-400 border-red-500/30 bg-red-500/10";
};

const getBrakeTempColor = (tempC) => {
    if (tempC < 250) return "text-sky-300";
    if (tempC <= 650) return "text-amber-400";
    return "text-red-400";
};

// Diccionario de Vectores Meteorológicos
const WeatherWidget = ({ condition }) => {
    const state = condition ? condition.toLowerCase() : "clear";

    if (state.includes("rain") || state.includes("shower") || state.includes("wet")) {
        return (
            <div className="flex items-center gap-2">
                <svg viewBox="0 0 24 24" className="w-8 h-8 text-neutral-400" fill="currentColor">
                    <path d="M18.5 10A5.5 5.5 0 008 8 4 4 0 004 12a4.5 4.5 0 004.5 4.5h10a4 4 0 000-8z" />
                    <path d="M10 18l-1 3m4-3l-1 3m4-3l-1 3" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round"/>
                </svg>
            </div>
        );
    }
    
    if (state.includes("cloud") || state.includes("overcast")) {
        return (
            <div className="flex items-center gap-1">
                <svg viewBox="0 0 24 24" className="w-8 h-8" fill="none">
                    <circle cx="10" cy="10" r="4" fill="#fbbf24" />
                    <path d="M18 13a4 4 0 00-3.5-3.9 5.5 5.5 0 00-10 1.9A3.5 3.5 0 005 18h12a3 3 0 001-5z" fill="#9ca3af" />
                </svg>
            </div>
        );
    }

    return (
        <div className="flex items-center gap-2">
            <svg viewBox="0 0 24 24" className="w-8 h-8 text-yellow-400" fill="currentColor">
                <circle cx="12" cy="12" r="6" />
                <path stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="M12 2v2m0 16v2m10-10h-2M4 12H2m15.364-7.364l-1.414 1.414M7.05 17.657l-1.414 1.414m12.728 0l-1.414-1.414M7.05 6.343L5.636 4.929" />
            </svg>
        </div>
    );
};

// Tarjeta individual para cada rueda (FL, FR, RL, RR)
const WheelCard = ({ label, tyreTemp = 0, brakeTemp = 0, wear = 0, pressure = 0 }) => {
    const tempStyle = getTyreTempColor(tyreTemp);
    const brakeStyle = getBrakeTempColor(brakeTemp);
    const wearClamped = Math.max(0, Math.min(100, wear));

    return (
        <div className="bg-neutral-950 rounded border border-neutral-800 p-2.5 flex flex-col justify-between gap-2">
            <div className="flex justify-between items-center border-b border-neutral-800/80 pb-1">
                <span className="text-[10px] font-mono font-bold text-neutral-400 uppercase tracking-wider">{label}</span>
                <span className="text-[10px] font-mono text-neutral-400">{pressure.toFixed(1)} kPa</span>
            </div>

            <div className="grid grid-cols-2 gap-1.5 items-center my-0.5">
                <div className={`rounded border px-2 py-1 text-center ${tempStyle}`}>
                    <div className="text-[9px] font-mono uppercase opacity-75">Tyre</div>
                    <div className="text-sm font-mono font-bold">{tyreTemp.toFixed(1)}°C</div>
                </div>
                <div className="rounded border border-neutral-800 bg-neutral-900/60 px-2 py-1 text-center">
                    <div className="text-[9px] font-mono uppercase text-neutral-500">Brake</div>
                    <div className={`text-sm font-mono font-semibold ${brakeStyle}`}>{brakeTemp.toFixed(0)}°C</div>
                </div>
            </div>

            <div>
                <div className="flex justify-between text-[9px] font-mono text-neutral-400 mb-1">
                    <span>VIDA NEUMÁTICO</span>
                    <span className={wearClamped < 40 ? "text-red-400 font-bold" : "text-neutral-200"}>
                        {wearClamped.toFixed(1)}%
                    </span>
                </div>
                <div className="w-full h-1.5 bg-neutral-800 rounded-full overflow-hidden">
                    <div
                        className={`h-full transition-all duration-200 ${
                            wearClamped > 60 ? "bg-emerald-500" : wearClamped > 30 ? "bg-amber-400" : "bg-red-500"
                        }`}
                        style={{ width: `${wearClamped}%` }}
                    />
                </div>
            </div>
        </div>
    );
};

// Modal para explorar el CarSetup que entrega el backend
const SetupModal = ({ setup, carName, onClose }) => {
    const [filter, setFilter] = useState("");
    const entries = useMemo(() => {
        if (!setup) return [];
        return Object.entries(setup).filter(([key, item]) => {
            if (!filter.trim()) return true;
            const q = filter.toLowerCase();
            return (
                key.toLowerCase().includes(q) ||
                (item.caption && item.caption.toLowerCase().includes(q)) ||
                (item.string_value && String(item.string_value).toLowerCase().includes(q))
            );
        });
    }, [setup, filter]);

    return (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="bg-neutral-900 border border-neutral-700 rounded-lg max-w-4xl w-full max-h-[82vh] flex flex-col shadow-2xl">
                <div className="p-4 border-b border-neutral-800 flex justify-between items-center gap-4">
                    <div>
                        <div className="text-[10px] font-mono uppercase tracking-widest text-neutral-400">Ingeniería de Pista</div>
                        <h3 className="text-lg font-bold text-white font-mono">
                            CAR SETUP — {carName || "VEHÍCULO"} ({entries.length} parámetros)
                        </h3>
                    </div>
                    <button
                        onClick={onClose}
                        className="px-3 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-xs font-mono border border-neutral-700 cursor-pointer"
                    >
                        CERRAR [ESC]
                    </button>
                </div>

                <div className="p-3 border-b border-neutral-800 bg-neutral-950">
                    <input
                        type="text"
                        value={filter}
                        onChange={(e) => setFilter(e.target.value)}
                        placeholder="Filtrar parámetro (ej. BRAKE, WING, SPRING, CAMBER, PRESSURE)..."
                        className="w-full bg-neutral-900 border border-neutral-800 rounded px-3 py-1.5 text-xs font-mono text-white placeholder-neutral-500 focus:outline-none focus:border-blue-500"
                    />
                </div>

                <div className="p-4 overflow-y-auto grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5 text-xs font-mono">
                    {entries.map(([key, item]) => (
                        <div key={key} className="bg-neutral-950 border border-neutral-800 rounded p-2.5 flex flex-col justify-between">
                            <div className="text-[10px] text-neutral-500 truncate" title={key}>
                                {item.caption || key.replace(/^(VM_|WM_)/, "")}
                            </div>
                            <div className="mt-1 flex justify-between items-baseline gap-2">
                                <span className="text-sm font-bold text-blue-400 truncate">
                                    {item.string_value || String(item.value ?? "N/A")}
                                </span>
                                {item.last_saved && item.last_saved !== item.string_value && (
                                    <span className="text-[10px] text-neutral-500 truncate" title={`Guardado: ${item.last_saved}`}>
                                        Base: {item.last_saved}
                                    </span>
                                )}
                            </div>
                        </div>
                    ))}
                    {entries.length === 0 && (
                        <div className="col-span-full text-center py-8 text-neutral-500 font-mono">
                            No se encontraron parámetros que coincidan con "{filter}".
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

// Modal de Topología Múltiples Clientes - Múltiples Servidores (MC-MS)
const ClusterModal = ({ clusterInfo, currentClientId, onRefresh, onClose }) => {
    return (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="bg-neutral-900 border border-neutral-700 rounded-lg max-w-4xl w-full max-h-[85vh] flex flex-col shadow-2xl font-mono">
                <div className="p-4 border-b border-neutral-800 flex justify-between items-center gap-4">
                    <div>
                        <div className="text-[10px] uppercase tracking-widest text-purple-400">
                            Sistemas Distribuidos • Topología en Vivo
                        </div>
                        <h3 className="text-lg font-bold text-white">
                            ARQUITECTURA MÚLTIPLES CLIENTES - MÚLTIPLES SERVIDORES (MC-MS)
                        </h3>
                    </div>
                    <div className="flex gap-2">
                        <button
                            onClick={onRefresh}
                            className="px-3 py-1 rounded bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 text-xs border border-blue-500/40 cursor-pointer"
                        >
                            ACTUALIZAR
                        </button>
                        <button
                            onClick={onClose}
                            className="px-3 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-xs border border-neutral-700 cursor-pointer"
                        >
                            CERRAR
                        </button>
                    </div>
                </div>

                <div className="p-4 overflow-y-auto space-y-5 text-xs">
                    {/* Nodos Servidores (API Nodes + DuckDB Data Nodes) */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="bg-neutral-950 border border-neutral-800 rounded p-3">
                            <div className="text-[10px] uppercase text-neutral-400 mb-2 border-b border-neutral-800 pb-1">
                                Servidores de API / Streaming SSE
                            </div>
                            <div className="space-y-2">
                                {(clusterInfo?.api_nodes || []).map((n) => (
                                    <div key={n.node_id} className="flex justify-between items-center bg-neutral-900 px-3 py-2 rounded border border-neutral-800">
                                        <div>
                                            <div className="font-bold text-neutral-200">{n.node_id}</div>
                                            <div className="text-[10px] text-neutral-500">{n.url}</div>
                                        </div>
                                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                            n.status === 'online'
                                                ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                                                : 'bg-red-500/15 text-red-400 border border-red-500/30'
                                        }`}>
                                            {n.status.toUpperCase()}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="bg-neutral-950 border border-neutral-800 rounded p-3">
                            <div className="text-[10px] uppercase text-neutral-400 mb-2 border-b border-neutral-800 pb-1">
                                Servidores de Recursos .duckdb (Data Nodes)
                            </div>
                            <div className="space-y-2">
                                {(clusterInfo?.data_nodes || []).map((n) => (
                                    <div key={n.node_id} className="flex justify-between items-center bg-neutral-900 px-3 py-2 rounded border border-neutral-800">
                                        <div>
                                            <div className="font-bold text-cyan-300">{n.node_id}</div>
                                            <div className="text-[10px] text-neutral-500">{n.url}</div>
                                        </div>
                                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                            n.status === 'online'
                                                ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                                                : 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                                        }`}>
                                            {n.status === 'online' ? 'ONLINE (.duckdb)' : 'STANDBY / LOCAL'}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Lista de Múltiples Clientes Conectados */}
                    <div className="bg-neutral-950 border border-neutral-800 rounded p-3">
                        <div className="flex justify-between items-center mb-2 border-b border-neutral-800 pb-1">
                            <span className="text-[10px] uppercase text-neutral-400">
                                Clientes Conectados al Muro de Boxes ({clusterInfo?.connected_clients?.length || 0})
                            </span>
                            <span className="text-[10px] text-neutral-500">
                                Reloj Maestro Sincronizado: <strong className="text-emerald-400">{clusterInfo?.sync_cursor_s ?? 0}s</strong>
                            </span>
                        </div>

                        <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr className="text-[10px] text-neutral-500 border-b border-neutral-800">
                                        <th className="py-1.5 px-2">CLIENT ID</th>
                                        <th className="py-1.5 px-2">MODO RELOJ</th>
                                        <th className="py-1.5 px-2">CURSOR TIEMPO</th>
                                        <th className="py-1.5 px-2">SERVIDOR API</th>
                                        <th className="py-1.5 px-2">SERVIDOR DUCKDB</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {(clusterInfo?.connected_clients || []).map((c) => (
                                        <tr key={c.client_id} className="border-b border-neutral-900 hover:bg-neutral-900/50">
                                            <td className="py-2 px-2 font-bold text-white">
                                                {c.client_id}
                                                {c.client_id === currentClientId && (
                                                    <span className="ml-2 text-[9px] bg-blue-500/20 text-blue-300 border border-blue-500/30 px-1.5 py-0.5 rounded">
                                                        TÚ
                                                    </span>
                                                )}
                                            </td>
                                            <td className="py-2 px-2">
                                                <span className={`px-2 py-0.5 rounded text-[10px] ${
                                                    c.mode === 'sync'
                                                        ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                                                        : 'bg-purple-500/15 text-purple-300 border border-purple-500/30'
                                                }`}>
                                                    {c.mode === 'sync' ? 'SINCRONIZADO' : 'INDEPENDIENTE'}
                                                </span>
                                            </td>
                                            <td className="py-2 px-2 text-amber-300 font-semibold">{c.cursor_s.toFixed(1)}s</td>
                                            <td className="py-2 px-2 text-blue-300">{c.api_node}</td>
                                            <td className="py-2 px-2 text-cyan-300">{c.data_node}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default function Dashboard() {
    const [apiNodes] = useState(() => getApiNodes());
    const [clientId] = useState(() => getClientId());
    const [playbackMode, setPlaybackMode] = useState('sync'); // 'sync' | 'independent'
    const [selectedApiNodeUrl, setSelectedApiNodeUrl] = useState(() => getApiNodes()[0].baseUrl);
    const [selectedDataNode, setSelectedDataNode] = useState('auto');

    const [data, setData] = useState(null);
    const [trackCoords, setTrackCoords] = useState([]);
    const [clusterStatus, setClusterStatus] = useState(null);
    const [loading, setLoading] = useState(true);
    const [connectionError, setConnectionError] = useState(false);
    const [telemetryHistory, setTelemetryHistory] = useState([]);
    const [isPaused, setIsPaused] = useState(false);
    const [showSetupModal, setShowSetupModal] = useState(false);
    const [showClusterModal, setShowClusterModal] = useState(false);

    useEffect(() => {
        let isMounted = true;

        const initializePitWall = async () => {
            const [mapPoints, initialData] = await Promise.all([
                fetchTrackMap(selectedApiNodeUrl),
                fetchDashboardData(selectedApiNodeUrl, clientId, playbackMode, selectedDataNode)
            ]);

            if (isMounted && initialData) {
                setTrackCoords(mapPoints || []);
                setData(initialData);
                setClusterStatus(initialData.cluster || null);
                setTelemetryHistory(initialData.current_telemetry ? [initialData.current_telemetry] : []);
                setLoading(false);
            } else if (isMounted) {
                setConnectionError(true);
                setLoading(false);
            }
        };

        initializePitWall();

        return () => {
            isMounted = false;
        };
    }, []);

    // Conexión SSE con soporte Multi-Cliente (mode='sync'|'independent'), Multi-Servidor y Failover automático
    useEffect(() => {
        if (loading || isPaused) return;

        const streamUrl = buildStreamUrl(selectedApiNodeUrl, clientId, playbackMode, selectedDataNode);
        const eventSource = new EventSource(streamUrl);

        eventSource.onmessage = (event) => {
            const liveTelemetry = JSON.parse(event.data);
            setData(prevData => prevData ? ({
                ...prevData,
                current_telemetry: liveTelemetry
            }) : prevData);
            setTelemetryHistory(prevHistory => {
                const newHistory = [...prevHistory, liveTelemetry];
                return newHistory.slice(-100);
            });
            setConnectionError(false);
        };

        eventSource.onerror = () => {
            setConnectionError(true);
            eventSource.close();
            // Failover automático al otro Servidor API del clúster tras 1.2s si el nodo actual cae
            const fallbackNode = apiNodes.find(n => n.baseUrl !== selectedApiNodeUrl);
            if (fallbackNode) {
                setTimeout(() => {
                    setSelectedApiNodeUrl(fallbackNode.baseUrl);
                }, 1200);
            }
        };

        return () => {
            eventSource.close();
        };
    }, [loading, isPaused, selectedApiNodeUrl, clientId, playbackMode, selectedDataNode]);

    const handleRefreshCluster = async () => {
        const status = await fetchClusterStatus(selectedApiNodeUrl);
        if (status) setClusterStatus(status);
    };

    const handleResetPlayback = async () => {
        await resetPlayback(selectedApiNodeUrl, clientId, playbackMode);
        setTelemetryHistory([]);
    };

    const handleToggleMode = (newMode) => {
        if (newMode === playbackMode) return;
        setPlaybackMode(newMode);
        setTelemetryHistory([]);
    };

    const handleSessionChange = async (e) => {
        const newSession = e.target.value;
        if (!newSession) return;
        setLoading(true);
        await switchSession(newSession, selectedApiNodeUrl);
        const [mapPoints, initialData] = await Promise.all([
            fetchTrackMap(selectedApiNodeUrl),
            fetchDashboardData(selectedApiNodeUrl, clientId, playbackMode, selectedDataNode)
        ]);
        if (initialData) {
            setTrackCoords(mapPoints || []);
            setData(initialData);
            setClusterStatus(initialData.cluster || null);
            setTelemetryHistory(initialData.current_telemetry ? [initialData.current_telemetry] : []);
        }
        setLoading(false);
    };

    // Matemáticas de Proyección Cartográfica (Se calcula solo cuando carga el mapa)
    const mapProjection = useMemo(() => {
        if (!trackCoords || trackCoords.length === 0) return null;

        const lats = trackCoords.map(p => p.lat);
        const lons = trackCoords.map(p => p.lon);
        const minLat = Math.min(...lats), maxLat = Math.max(...lats);
        const minLon = Math.min(...lons), maxLon = Math.max(...lons);

        const latRange = maxLat - minLat || 1;
        const lonRange = maxLon - minLon || 1;
        const padding = 15;
        const size = 200;

        const project = (lat, lon) => {
            const x = padding + ((lon - minLon) / lonRange) * (size - padding * 2);
            const y = (size - padding) - ((lat - minLat) / latRange) * (size - padding * 2);
            return { x, y };
        };

        const svgPoints = trackCoords
            .map(p => {
                const { x, y } = project(p.lat, p.lon);
                return `${x.toFixed(1)},${y.toFixed(1)}`;
            })
            .join(' ');

        return { svgPoints, project };
    }, [trackCoords]);

    if (loading) return <div className="text-white p-8 font-mono animate-pulse">Sincronizando telemetría con Clúster Paddock...</div>;

    const tel = data?.current_telemetry || {};

    // Normalización inteligente del volante
    const rawSteering = tel.steering_pos || 0;
    const normalizedSteering = Math.abs(rawSteering) <= 1.0 ? rawSteering * 100 : rawSteering;
    const steeringDeg = (normalizedSteering / 100) * 270;

    // Porcentaje de barra de RPM
    const maxRpm = tel.max_rpm > 0 ? tel.max_rpm : 9500;
    const rpmPercent = Math.min(100, Math.max(0, ((tel.rpm || 0) / maxRpm) * 100));

    // Proyectamos la posición actual del piloto dentro del mapa SVG
    const currentLat = tel.gps_lat || 0;
    const currentLon = tel.gps_lon || 0;
    const carPos = (mapProjection && currentLat !== 0 && currentLon !== 0)
        ? mapProjection.project(currentLat, currentLon)
        : null;

    const activeSector = tel.current_sector === 0 ? 3 : (tel.current_sector || 1);
    const carBrandImageUrl = getCarImageUrl(
        data?.session?.car_name,
        data?.session?.car_brand,
        data?.session?.car_class
    );

    return (
        <div className="min-h-screen bg-neutral-950 text-neutral-100 p-6 font-sans">
            {connectionError && (
                <div className="bg-amber-500/20 border border-amber-500 text-amber-300 p-2 mb-4 rounded text-xs font-mono animate-pulse flex justify-between items-center">
                    <span>CONMUTACIÓN DE NODO: Reconectando flujo de telemetría con otro servidor activo del clúster...</span>
                    <span>CLIENT: {clientId}</span>
                </div>
            )}

            {showSetupModal && data && (
                <SetupModal
                    setup={data.setup}
                    carName={data.session?.car_name}
                    onClose={() => setShowSetupModal(false)}
                />
            )}

            {showClusterModal && (
                <ClusterModal
                    clusterInfo={clusterStatus}
                    currentClientId={clientId}
                    onRefresh={handleRefreshCluster}
                    onClose={() => setShowClusterModal(false)}
                />
            )}

            {data && (
                <>
                    {/* BARRA SUPERIOR DE ARQUITECTURA DISTRIBUIDA (MÚLTIPLES CLIENTES - MÚLTIPLES SERVIDORES) */}
                    <div className="mb-3 bg-neutral-900/90 border border-neutral-800 rounded-lg px-4 py-2.5 flex flex-wrap justify-between items-center gap-3 text-xs font-mono">
                        {/* Identificación del Cliente y Modo de Reloj (Sincronizado vs Independiente) */}
                        <div className="flex flex-wrap items-center gap-3">
                            <span className="px-2 py-1 rounded bg-blue-500/10 border border-blue-500/30 text-blue-300 font-bold">
                                CLIENTE: {clientId}
                            </span>

                            <span className="px-2 py-1 rounded bg-emerald-500/10 border border-emerald-500/30 text-emerald-300">
                                CLIENTES EN SALA: <strong>{tel.active_clients_count || 1}</strong>
                            </span>

                            {/* Switch Sincronizado vs Independiente */}
                            <div className="inline-flex rounded border border-neutral-700 bg-neutral-950 p-0.5">
                                <button
                                    onClick={() => handleToggleMode('sync')}
                                    className={`px-2.5 py-1 rounded text-[10px] font-bold transition cursor-pointer ${
                                        playbackMode === 'sync'
                                            ? 'bg-emerald-500/25 text-emerald-300 border border-emerald-500/40'
                                            : 'text-neutral-400 hover:text-neutral-200'
                                    }`}
                                    title="Comparte el mismo reloj en vivo con todos los clientes sincronizados"
                                >
                                    MODO SINCRONIZADO
                                </button>
                                <button
                                    onClick={() => handleToggleMode('independent')}
                                    className={`px-2.5 py-1 rounded text-[10px] font-bold transition cursor-pointer ${
                                        playbackMode === 'independent'
                                            ? 'bg-purple-500/25 text-purple-300 border border-purple-500/40'
                                            : 'text-neutral-400 hover:text-neutral-200'
                                    }`}
                                    title="Cursor de tiempo aislado e independiente para este cliente"
                                >
                                    MODO INDEPENDIENTE
                                </button>
                            </div>
                        </div>

                        {/* Selectores de Múltiples Servidores (API Nodes + DuckDB Data Nodes) */}
                        <div className="flex flex-wrap items-center gap-3">
                            <div className="flex items-center gap-1.5">
                                <span className="text-[10px] text-neutral-500 uppercase">API Server:</span>
                                <select
                                    value={selectedApiNodeUrl}
                                    onChange={(e) => setSelectedApiNodeUrl(e.target.value)}
                                    className="bg-neutral-950 border border-neutral-700 rounded px-2 py-1 text-[11px] text-blue-300 font-semibold"
                                >
                                    {apiNodes.map(node => (
                                        <option key={node.id} value={node.baseUrl}>
                                            {node.label}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div className="flex items-center gap-1.5">
                                <span className="text-[10px] text-neutral-500 uppercase">DuckDB Node:</span>
                                <select
                                    value={selectedDataNode}
                                    onChange={(e) => setSelectedDataNode(e.target.value)}
                                    className="bg-neutral-950 border border-neutral-700 rounded px-2 py-1 text-[11px] text-cyan-300 font-semibold"
                                >
                                    {DATA_NODES.map(node => (
                                        <option key={node.id} value={node.id}>
                                            {node.label}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <span className="text-[10px] px-2 py-1 rounded bg-neutral-950 border border-neutral-800 text-neutral-400">
                                Atendido por: <strong className="text-blue-400">{tel.api_node_id || "api-node-1"}</strong> → <strong className="text-cyan-400">{tel.data_node_id || "data-node-1"}</strong>
                            </span>

                            <button
                                onClick={() => {
                                    handleRefreshCluster();
                                    setShowClusterModal(true);
                                }}
                                className="px-2.5 py-1 rounded text-[10px] font-bold bg-purple-500/15 hover:bg-purple-500/25 text-purple-300 border border-purple-500/30 transition cursor-pointer"
                            >
                                TOPOLOGÍA MC-MS
                            </button>
                        </div>
                    </div>

                    {/* CABECERA CON INFORMACIÓN DE SESIÓN MULTIMEDIA Y SVG DE LA MARCA */}
                    <header className="mb-6 bg-neutral-900 border border-neutral-800 rounded-lg p-5 flex flex-col xl:flex-row justify-between items-center gap-6 shadow-md">
                        
                        {/* Izquierda: Imagen WebP por Marca del Auto y Piloto */}
                        <div className="flex items-center gap-6 w-full xl:w-auto">
                            {/* Contenedor de la Imagen WebP de la Marca del Auto */}
                            <div className="w-44 h-20 bg-neutral-950 rounded-lg border border-neutral-800 flex items-center justify-center overflow-hidden shrink-0 p-1 shadow-inner">
                                <img 
                                    src={carBrandImageUrl} 
                                    alt={data.session.car_brand || data.session.car_name}
                                    className="w-full h-full object-contain transition-transform duration-300 hover:scale-105"
                                    onError={(e) => {
                                        e.currentTarget.src = '/cars/porsche.webp';
                                    }}
                                />
                            </div>

                            {/* Información Principal */}
                            <div>
                                <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-neutral-500 font-mono mb-1">
                                    <span>Piloto en Pista</span>
                                    <span>•</span>
                                    <span className="text-amber-400">{data.session.session_type || "Practice"}</span>
                                    {tel.session_time_s !== undefined && (
                                        <>
                                            <span>•</span>
                                            <span className="text-neutral-300 font-bold">
                                                T+{tel.session_time_s.toFixed(1)}s ({playbackMode === 'sync' ? 'SYNC' : 'IND'})
                                            </span>
                                        </>
                                    )}
                                </div>
                                <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-white uppercase leading-none">
                                    {data.session.driver_name || data.session.DriverName || "PILOTO DESCONOCIDO"}
                                </h1>
                                <div className="flex flex-wrap items-center gap-2 mt-3 text-[10px] font-mono">
                                    <span className="text-red-400 bg-red-500/10 border border-red-500/30 px-2 py-1 rounded font-bold uppercase">
                                        MARCA: {data.session.car_brand || "PORSCHE"}
                                    </span>

                                    <span className="text-blue-400 bg-blue-500/10 border border-blue-500/20 px-2 py-1 rounded">
                                        {data.session.car_name || data.session.CarName || "DESCONOCIDO"} 
                                        <span className="text-blue-500 ml-1">({data.session.car_class || data.session.CarClass || "N/A"})</span>
                                    </span>

                                    <span className="text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-1 rounded">
                                        TYRE: {tel.tyre_compound || "Medium"}
                                    </span>

                                    {tel.in_pits && (
                                        <span className="text-amber-300 bg-amber-500/20 border border-amber-500/40 px-2 py-1 rounded font-bold animate-pulse">
                                            PIT LANE
                                        </span>
                                    )}

                                    {tel.yellow_flag > 0 && (
                                        <span className="text-yellow-300 bg-yellow-500/20 border border-yellow-400 px-2 py-1 rounded font-bold animate-pulse">
                                            YELLOW FLAG
                                        </span>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Derecha: Controles, Clima, Temperaturas y Estado de Red */}
                        <div className="flex flex-wrap items-center gap-4 self-start xl:self-center bg-neutral-950 p-3 rounded-lg border border-neutral-800 w-full xl:w-auto justify-between">
                            {/* Selector de sesión si hay archivos .duckdb */}
                            {data.available_sessions?.length > 0 && (
                                <div className="flex flex-col">
                                    <span className="text-[9px] text-neutral-500 font-mono uppercase">Recurso .duckdb</span>
                                    <select
                                        value={data.active_session_file || ""}
                                        onChange={handleSessionChange}
                                        className="bg-neutral-900 border border-neutral-800 rounded px-2 py-1 text-[11px] font-mono text-neutral-200 max-w-[180px] truncate"
                                    >
                                        {data.available_sessions.map((file) => (
                                            <option key={file} value={file}>{file.replace('.duckdb', '')}</option>
                                        ))}
                                    </select>
                                </div>
                            )}

                            {/* Botones de Ingeniería (Setup + Controles de Playback) */}
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => setShowSetupModal(true)}
                                    className="px-2.5 py-1.5 rounded text-[10px] font-mono font-semibold bg-neutral-900 hover:bg-neutral-800 text-neutral-200 border border-neutral-700 transition cursor-pointer"
                                >
                                    SETUP ({Object.keys(data.setup || {}).length})
                                </button>
                                <button
                                    onClick={() => setIsPaused(p => !p)}
                                    className={`px-2.5 py-1.5 rounded text-[10px] font-mono font-semibold border transition cursor-pointer ${
                                        isPaused
                                            ? "bg-amber-500/20 text-amber-300 border-amber-500/40"
                                            : "bg-neutral-900 hover:bg-neutral-800 text-neutral-300 border-neutral-700"
                                    }`}
                                >
                                    {isPaused ? "REANUDAR" : "PAUSAR"}
                                </button>
                                <button
                                    onClick={handleResetPlayback}
                                    className="px-2.5 py-1.5 rounded text-[10px] font-mono font-semibold bg-neutral-900 hover:bg-neutral-800 text-neutral-300 border border-neutral-700 transition cursor-pointer"
                                    title={playbackMode === 'sync' ? "Reiniciar reloj sincronizado de la sala" : "Reiniciar únicamente mi cursor independiente"}
                                >
                                    REINICIAR {playbackMode === 'independent' ? '(MÍO)' : '(SALA)'}
                                </button>
                            </div>

                            <div className="h-8 w-px bg-neutral-800 hidden md:block"></div>

                            {/* Clima + Temperaturas de Pista y Ambiente */}
                            <div className="flex items-center gap-3">
                                <WeatherWidget condition={data.session.weather || data.session.WeatherConditions} />
                                <div className="flex flex-col justify-center">
                                    <span className="text-[10px] text-neutral-500 font-mono tracking-wider">
                                        {data.session.weather || data.session.WeatherConditions || "Óptimo"}
                                    </span>
                                    <div className="flex gap-2 text-xs font-mono text-neutral-300">
                                        <span>PISTA: <strong className="text-amber-400">{(tel.track_temp_c || 0).toFixed(1)}°C</strong></span>
                                        <span>AMB: <strong className="text-sky-400">{(tel.ambient_temp_c || 0).toFixed(1)}°C</strong></span>
                                    </div>
                                </div>
                            </div>

                            <div className="h-8 w-px bg-neutral-800 hidden md:block"></div>

                            <span className={`inline-flex items-center gap-2 py-1.5 px-3 rounded text-[10px] font-mono font-semibold border ${
                                isPaused
                                    ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
                                    : "bg-green-500/10 text-green-400 border-green-500/20"
                            }`}>
                                <span className={`w-1.5 h-1.5 rounded-full ${isPaused ? "bg-amber-400" : "bg-green-500 animate-ping"}`}></span>
                                {isPaused ? "EN PAUSA" : "TELEMETRÍA ACTIVA"}
                            </span>
                        </div>
                    </header>

                    {/* GRID PRINCIPAL DEL MURO DE BOXES (12 Columnas Balanceadas: 3 + 5 + 4 = 12) */}
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                        
                        {/* PANEL 1: UNIDAD DE POTENCIA, INPUTS, COMBUSTIBLE Y ELECTRÓNICA (3 Columnas) */}
                        <div className="bg-neutral-900 rounded-lg p-5 border border-neutral-800 shadow-lg lg:col-span-3 flex flex-col justify-between gap-5">
                            <div>
                                <div className="flex justify-between items-center border-b border-neutral-800 pb-2">
                                    <h2 className="text-xs uppercase tracking-widest text-neutral-400 font-mono">Unidad de Potencia</h2>
                                    <span className="text-[10px] font-mono text-neutral-500">LAP {tel.current_lap ?? 0}</span>
                                </div>

                                {/* Velocidad, RPM y Marcha */}
                                <div className="mt-4 flex justify-between items-end">
                                    <div>
                                        <div className="text-5xl font-mono font-bold text-blue-400 tracking-tighter">
                                            {(tel.speed_kmh || 0).toFixed(0)}
                                            <span className="text-base text-neutral-500 ml-1.5 font-normal">km/h</span>
                                        </div>
                                        <div className="mt-2 text-xl font-mono text-neutral-200">
                                            {(tel.rpm || 0).toFixed(0)} <span className="text-xs text-neutral-500">/ {maxRpm.toFixed(0)} RPM</span>
                                        </div>
                                    </div>
                                    <div className="flex flex-col items-end">
                                        <span className="text-[10px] font-mono uppercase text-neutral-500 mb-1">Marcha</span>
                                        <span className="text-3xl font-mono font-bold text-yellow-400 bg-yellow-400/10 px-3.5 py-1.5 rounded border border-yellow-400/20">
                                            {tel.gear === 0 ? 'N' : tel.gear === -1 ? 'R' : tel.gear}
                                        </span>
                                    </div>
                                </div>

                                {/* Barra de RPM Shift Light */}
                                <div className="mt-3 w-full h-2 bg-neutral-950 rounded-full overflow-hidden border border-neutral-800">
                                    <div
                                        className={`h-full transition-all duration-75 ${
                                            rpmPercent > 90 ? "bg-red-500" : rpmPercent > 75 ? "bg-purple-500" : "bg-blue-500"
                                        }`}
                                        style={{ width: `${rpmPercent}%` }}
                                    />
                                </div>
                            </div>

                            {/* Widget de Volante en Vivo + Pedales + Fuerzas G */}
                            <div className="bg-neutral-950 rounded border border-neutral-800 p-3">
                                <div className="flex justify-between items-center text-[10px] font-mono text-neutral-500 mb-2">
                                    <span>STEERING & PEDALS</span>
                                    <span className="text-neutral-300">{steeringDeg.toFixed(1)}°</span>
                                </div>

                                <div className="flex items-center justify-around gap-3">
                                    <div className="flex gap-2 items-end h-20">
                                        <div className="flex flex-col items-center gap-1 h-full">
                                            <div className="w-3 flex-1 bg-neutral-900 rounded overflow-hidden border border-neutral-800 flex items-end">
                                                <div
                                                    className="w-full bg-red-500 transition-all duration-75"
                                                    style={{ height: `${Math.min(100, Math.max(0, tel.brake_pos || 0))}%` }}
                                                />
                                            </div>
                                            <span className="text-[9px] font-mono text-red-400">BRK</span>
                                        </div>
                                        <div className="flex flex-col items-center gap-1 h-full">
                                            <div className="w-3 flex-1 bg-neutral-900 rounded overflow-hidden border border-neutral-800 flex items-end">
                                                <div
                                                    className="w-full bg-emerald-400 transition-all duration-75"
                                                    style={{ height: `${Math.min(100, Math.max(0, tel.throttle_pos || 0))}%` }}
                                                />
                                            </div>
                                            <span className="text-[9px] font-mono text-emerald-400">THR</span>
                                        </div>
                                    </div>

                                    <div className="w-16 h-16 flex items-center justify-center">
                                        <svg
                                            viewBox="0 0 64 64"
                                            className="w-16 h-16 text-neutral-200 transition-transform duration-75"
                                            style={{ transform: `rotate(${steeringDeg}deg)` }}
                                        >
                                            <circle cx="32" cy="32" r="26" fill="none" stroke="currentColor" strokeWidth="5" />
                                            <path d="M8 32 H56 M32 32 V56" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
                                            <rect x="29" y="3" width="6" height="6" rx="1" fill="#ef4444" />
                                            <circle cx="32" cy="32" r="6" fill="#262626" stroke="currentColor" strokeWidth="2" />
                                        </svg>
                                    </div>

                                    <div className="text-[10px] font-mono space-y-1 text-right">
                                        <div className="text-neutral-500">G-LAT</div>
                                        <div className="text-neutral-200 font-bold">{(tel.g_force_lat || 0).toFixed(2)}G</div>
                                        <div className="text-neutral-500">G-LON</div>
                                        <div className="text-neutral-200 font-bold">{(tel.g_force_long || 0).toFixed(2)}G</div>
                                    </div>
                                </div>
                            </div>

                            {/* Combustible, Energía Virtual y Temperaturas de Motor */}
                            <div className="grid grid-cols-2 gap-2.5 text-xs font-mono">
                                <div className="bg-neutral-950 rounded border border-neutral-800 p-2.5">
                                    <div className="text-[10px] text-neutral-500">FUEL LEVEL</div>
                                    <div className="text-lg font-bold text-amber-400 mt-0.5">
                                        {(tel.fuel_level_liters || 0).toFixed(2)} <span className="text-xs font-normal text-neutral-500">L</span>
                                    </div>
                                </div>
                                <div className="bg-neutral-950 rounded border border-neutral-800 p-2.5">
                                    <div className="text-[10px] text-neutral-500">VIRTUAL ENERGY</div>
                                    <div className="text-lg font-bold text-cyan-400 mt-0.5">
                                        {(tel.virtual_energy_pct || 0).toFixed(1)} <span className="text-xs font-normal text-neutral-500">%</span>
                                    </div>
                                </div>
                                <div className="bg-neutral-950 rounded border border-neutral-800 p-2.5">
                                    <div className="text-[10px] text-neutral-500">AGUA MOTOR</div>
                                    <div className="text-sm font-semibold text-neutral-200 mt-0.5">
                                        {(tel.water_temp_c || 0).toFixed(1)} °C
                                    </div>
                                </div>
                                <div className="bg-neutral-950 rounded border border-neutral-800 p-2.5">
                                    <div className="text-[10px] text-neutral-500">ACEITE MOTOR</div>
                                    <div className="text-sm font-semibold text-neutral-200 mt-0.5">
                                        {(tel.oil_temp_c || 0).toFixed(1)} °C
                                    </div>
                                </div>
                            </div>

                            {/* Electrónica del Vehículo (TC, ABS, Brake Bias) */}
                            <div className="pt-3 border-t border-neutral-800 grid grid-cols-3 gap-2 text-center font-mono">
                                <div className={`rounded p-2 border ${
                                    tel.tc_active
                                        ? "bg-amber-500/20 border-amber-400 text-amber-300"
                                        : "bg-neutral-950 border-neutral-800 text-neutral-400"
                                }`}>
                                    <div className="text-[9px] uppercase">TC (Lv.{tel.tc_level ?? 0})</div>
                                    <div className="text-xs font-bold mt-0.5">{tel.tc_active ? "ACTIVO" : "STBY"}</div>
                                </div>
                                <div className={`rounded p-2 border ${
                                    tel.abs_active
                                        ? "bg-red-500/20 border-red-400 text-red-300"
                                        : "bg-neutral-950 border-neutral-800 text-neutral-400"
                                }`}>
                                    <div className="text-[9px] uppercase">ABS (Lv.{tel.abs_level ?? 0})</div>
                                    <div className="text-xs font-bold mt-0.5">{tel.abs_active ? "ACTIVO" : "STBY"}</div>
                                </div>
                                <div className="rounded p-2 border bg-neutral-950 border-neutral-800 text-neutral-300">
                                    <div className="text-[9px] uppercase text-neutral-500">BB REAR</div>
                                    <div className="text-xs font-bold mt-0.5">{(tel.brake_bias_rear || 50).toFixed(1)}%</div>
                                </div>
                            </div>
                        </div>

                        {/* PANEL 2: ANÁLISIS DE TELEMETRÍA (Analysis Channels - 5 Columnas) */}
                        <div className="bg-neutral-900 rounded-lg p-5 border border-neutral-800 shadow-lg lg:col-span-5 flex flex-col">
                            <div className="flex justify-between items-center mb-4 border-b border-neutral-800 pb-2">
                                <h2 className="text-xs uppercase tracking-widest text-neutral-400 font-mono">
                                    Analysis Channels
                                </h2>
                                <span className="text-[10px] font-mono text-neutral-500">
                                    Ventana: {telemetryHistory.length} muestras (5 Hz)
                                </span>
                            </div>
                            
                            <div className="flex-1 flex flex-col justify-between space-y-4">
                                {/* GRÁFICA: ACELERADOR (Throttle) */}
                                <div className="h-24 relative">
                                    <div className="absolute top-0 left-0 text-[10px] text-neutral-500 font-mono z-10 flex justify-between w-full pr-2">
                                        <span>Throttle</span>
                                        <span className="text-emerald-400 font-bold">{(tel.throttle_pos || 0).toFixed(1)} %</span>
                                    </div>
                                    <ResponsiveContainer width="100%" height="100%">
                                        <LineChart data={telemetryHistory}>
                                            <YAxis domain={[0, 100]} hide />
                                            <Line type="monotone" dataKey="throttle_pos" stroke="#0efa35" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                                        </LineChart>
                                    </ResponsiveContainer>
                                </div>

                                {/* GRÁFICA: FRENO (Brake) */}
                                <div className="h-24 relative border-t border-neutral-800/50 pt-2">
                                    <div className="absolute top-2 left-0 text-[10px] text-neutral-500 font-mono z-10 flex justify-between w-full pr-2">
                                        <span>Brake</span>
                                        <span className="text-red-400 font-bold">{(tel.brake_pos || 0).toFixed(1)} %</span>
                                    </div>
                                    <ResponsiveContainer width="100%" height="100%">
                                        <LineChart data={telemetryHistory}>
                                            <YAxis domain={[0, 100]} hide />
                                            <Line type="monotone" dataKey="brake_pos" stroke="#fc0303" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                                        </LineChart>
                                    </ResponsiveContainer>
                                </div>

                                {/* GRÁFICA: RPM */}
                                <div className="h-24 relative border-t border-neutral-800/50 pt-2">
                                    <div className="absolute top-2 left-0 text-[10px] text-neutral-500 font-mono z-10 flex justify-between w-full pr-2">
                                        <span>RPM</span>
                                        <span className="text-purple-400 font-bold">{(tel.rpm || 0).toFixed(0)} rpm</span>
                                    </div>
                                    <ResponsiveContainer width="100%" height="100%">
                                        <LineChart data={telemetryHistory}>
                                            <YAxis domain={['auto', 'auto']} hide />
                                            <Line type="monotone" dataKey="rpm" stroke="#a855f7" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                                        </LineChart>
                                    </ResponsiveContainer>
                                </div>

                                {/* GRÁFICA: STEERING */}
                                <div className="h-24 relative border-t border-neutral-800/50 pt-2">
                                    <div className="absolute top-2 left-0 text-[10px] text-neutral-500 font-mono z-10 flex justify-between w-full pr-2">
                                        <span>Steering</span>
                                        <span className="text-neutral-200 font-bold">{(tel.steering_pos || 0).toFixed(1)} %</span>
                                    </div>
                                    <ResponsiveContainer width="100%" height="100%">
                                        <LineChart data={telemetryHistory}>
                                            <YAxis domain={['auto', 'auto']} hide />
                                            <Line type="monotone" dataKey="steering_pos" stroke="#ffffff" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                                        </LineChart>
                                    </ResponsiveContainer>
                                </div>

                                {/* GRÁFICA: GEAR (MARCHAS) */}
                                <div className="h-24 relative border-t border-neutral-800/50 pt-2">
                                    <div className="absolute top-2 left-0 text-[10px] text-neutral-500 font-mono z-10 flex justify-between w-full pr-2">
                                        <span>Gear</span>
                                        <span className="text-amber-400 font-bold">
                                            {tel.gear === 0 ? 'N' : tel.gear === -1 ? 'R' : `${tel.gear}ª`}
                                        </span>
                                    </div>
                                    <ResponsiveContainer width="100%" height="100%">
                                        <LineChart data={telemetryHistory}>
                                            <YAxis domain={[0, 8]} hide />
                                            <Line 
                                                type="stepAfter" 
                                                dataKey="gear" 
                                                stroke="#f5c540" 
                                                strokeWidth={1.5} 
                                                dot={false} 
                                                isAnimationActive={false} 
                                            />
                                        </LineChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>
                        </div>

                        {/* PANEL 3: MAPA DEL CIRCUITO + NEUMÁTICOS Y FRENOS (4 Columnas) */}
                        <div className="lg:col-span-4 flex flex-col gap-6">
                            {/* SUBPANEL 3A: MAPA GPS EN VIVO */}
                            <div className="bg-neutral-900 rounded-lg p-5 border border-neutral-800 shadow-lg flex flex-col justify-between">
                                <div className="flex justify-between items-center mb-2 gap-2">
                                    <h2 className="text-xs uppercase tracking-widest text-neutral-400 font-mono">Mapa GPS en Vivo</h2>
                                    <span className="text-xs font-mono text-purple-400 bg-purple-500/10 border border-purple-500/20 px-2 py-0.5 rounded truncate">
                                        {data.session.track_name || data.session.TrackName || "DESCONOCIDO"}
                                    </span>
                                </div>

                                <div className="bg-neutral-950 rounded border border-neutral-800 relative flex items-center justify-center h-[210px] p-2">
                                    {mapProjection ? (
                                        <svg viewBox="0 0 200 200" className="w-full h-full max-h-[195px]">
                                            <polyline
                                                fill="none"
                                                stroke="#404040"
                                                strokeWidth="4"
                                                strokeLinecap="round"
                                                strokeLinejoin="round"
                                                points={mapProjection.svgPoints}
                                            />
                                            <polyline
                                                fill="none"
                                                stroke="#a3a3a3"
                                                strokeWidth="1.5"
                                                strokeLinecap="round"
                                                strokeLinejoin="round"
                                                points={mapProjection.svgPoints}
                                            />
                                            {carPos && (
                                                <g>
                                                    <circle cx={carPos.x} cy={carPos.y} r="6" fill="#22c55e" fillOpacity="0.3" className="animate-ping" />
                                                    <circle cx={carPos.x} cy={carPos.y} r="4" fill="#22c55e" stroke="#ffffff" strokeWidth="1.5" />
                                                </g>
                                            )}
                                        </svg>
                                    ) : (
                                        <span className="text-xs font-mono text-neutral-600">Cargando geometría del circuito...</span>
                                    )}
                                </div>

                                <div className="mt-2.5 grid grid-cols-2 gap-2 text-xs font-mono text-neutral-500 pt-2 border-t border-neutral-800">
                                    <div>LAT: <span className="text-neutral-300">{currentLat.toFixed(5)}°</span></div>
                                    <div>LON: <span className="text-neutral-300">{currentLon.toFixed(5)}°</span></div>
                                </div>
                            </div>

                            {/* SUBPANEL 3B: TEMPERATURAS, PRESIONES Y DESGASTE DE LAS 4 RUEDAS */}
                            <div className="bg-neutral-900 rounded-lg p-5 border border-neutral-800 shadow-lg flex-1 flex flex-col justify-between">
                                <div className="flex justify-between items-center mb-3 border-b border-neutral-800 pb-2">
                                    <h2 className="text-xs uppercase tracking-widest text-neutral-400 font-mono">
                                        Neumáticos & Frenos
                                    </h2>
                                    <span className="text-[10px] font-mono text-emerald-400">
                                        Compuesto: {tel.tyre_compound || "Medium"}
                                    </span>
                                </div>

                                <div className="grid grid-cols-2 gap-3">
                                    <WheelCard
                                        label="FL (Del. Izq)"
                                        tyreTemp={tel.tyre_temps_c?.fl}
                                        brakeTemp={tel.brake_temps_c?.fl}
                                        wear={tel.tyre_wear_percent?.fl}
                                        pressure={tel.tyre_pressures_kpa?.fl}
                                    />
                                    <WheelCard
                                        label="FR (Del. Der)"
                                        tyreTemp={tel.tyre_temps_c?.fr}
                                        brakeTemp={tel.brake_temps_c?.fr}
                                        wear={tel.tyre_wear_percent?.fr}
                                        pressure={tel.tyre_pressures_kpa?.fr}
                                    />
                                    <WheelCard
                                        label="RL (Tras. Izq)"
                                        tyreTemp={tel.tyre_temps_c?.rl}
                                        brakeTemp={tel.brake_temps_c?.rl}
                                        wear={tel.tyre_wear_percent?.rl}
                                        pressure={tel.tyre_pressures_kpa?.rl}
                                    />
                                    <WheelCard
                                        label="RR (Tras. Der)"
                                        tyreTemp={tel.tyre_temps_c?.rr}
                                        brakeTemp={tel.brake_temps_c?.rr}
                                        wear={tel.tyre_wear_percent?.rr}
                                        pressure={tel.tyre_pressures_kpa?.rr}
                                    />
                                </div>
                            </div>
                        </div>
                        
                        {/* PANEL 4: CRONOMETRAJE Y SECTORES (12 Columnas) */}
                        <div className="bg-neutral-900 rounded-lg p-5 border border-neutral-800 shadow-lg lg:col-span-12 flex flex-col md:flex-row gap-6">
                            
                            {/* Tiempo Actual (En vivo) */}
                            <div className="flex-1 flex flex-col justify-center border-b md:border-b-0 md:border-r border-neutral-800 pb-4 md:pb-0 pr-0 md:pr-4">
                                <div className="flex justify-between items-center mb-2">
                                    <h2 className="text-xs uppercase tracking-widest text-neutral-400 font-mono">Vuelta Actual</h2>
                                    <span className="text-xs font-mono text-blue-400 bg-blue-500/10 border border-blue-500/20 px-2 py-0.5 rounded">
                                        VUELTA #{tel.current_lap ?? 0}
                                    </span>
                                </div>
                                <div className="text-5xl font-mono font-bold text-white tracking-tighter">
                                    {formatTime(tel.current_lap_time)}
                                </div>
                                <div className="text-xs font-mono text-neutral-500 mt-2 flex items-center gap-3">
                                    <span>SECTOR ACTIVO: <strong className="text-yellow-400">S{activeSector}</strong></span>
                                    <div className="flex gap-1">
                                        {[1, 2, 3].map(s => (
                                            <span
                                                key={s}
                                                className={`px-1.5 py-0.5 rounded text-[10px] ${
                                                    activeSector === s
                                                        ? "bg-yellow-400/20 text-yellow-300 border border-yellow-400/40 font-bold"
                                                        : "bg-neutral-950 text-neutral-600 border border-neutral-800"
                                                }`}
                                            >
                                                S{s}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            </div>

                            {/* Última Vuelta y sus Sectores */}
                            <div className="flex-1 flex flex-col justify-center border-b md:border-b-0 md:border-r border-neutral-800 pb-4 md:pb-0 px-0 md:px-4">
                                <div className="flex justify-between items-end mb-2">
                                    <h2 className="text-xs uppercase tracking-widest text-neutral-400 font-mono">Última Vuelta</h2>
                                    <span className="text-xl font-mono text-neutral-300">
                                        {formatTime(tel.last_lap_time)}
                                    </span>
                                </div>
                                <div className="grid grid-cols-3 gap-2">
                                    <div className="bg-neutral-950 rounded p-2 border border-neutral-800">
                                        <div className="text-[10px] text-neutral-500 font-mono mb-1">S1</div>
                                        <div className="font-mono text-sm text-neutral-300">
                                            {tel.last_sector_1 > 0 ? tel.last_sector_1.toFixed(3) : "0.000"}
                                        </div>
                                    </div>
                                    <div className="bg-neutral-950 rounded p-2 border border-neutral-800">
                                        <div className="text-[10px] text-neutral-500 font-mono mb-1">S2</div>
                                        <div className="font-mono text-sm text-neutral-300">
                                            {tel.last_sector_2 > 0 ? Math.max(0, tel.last_sector_2 - tel.last_sector_1).toFixed(3) : "0.000"}
                                        </div>
                                    </div>
                                    <div className="bg-neutral-950 rounded p-2 border border-neutral-800">
                                        <div className="text-[10px] text-neutral-500 font-mono mb-1">S3</div>
                                        <div className="font-mono text-sm text-neutral-300">
                                            {tel.last_lap_time > 0 && tel.last_sector_2 > 0 ? Math.max(0, tel.last_lap_time - tel.last_sector_2).toFixed(3) : "0.000"}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Mejor Vuelta y sus Sectores */}
                            <div className="flex-1 flex flex-col justify-center pl-0 md:pl-4">
                                <div className="flex justify-between items-end mb-2">
                                    <h2 className="text-xs uppercase tracking-widest text-neutral-400 font-mono">Mejor Vuelta</h2>
                                    <span className="text-xl font-mono text-purple-400 font-bold">
                                        {formatTime(tel.best_lap_time)}
                                    </span>
                                </div>
                                <div className="grid grid-cols-3 gap-2">
                                    <div className="bg-neutral-950 rounded p-2 border border-purple-500/30">
                                        <div className="text-[10px] text-purple-400/70 font-mono mb-1">S1</div>
                                        <div className="font-mono text-sm text-purple-300">
                                            {tel.best_sector_1 > 0 ? tel.best_sector_1.toFixed(3) : "0.000"}
                                        </div>
                                    </div>
                                    <div className="bg-neutral-950 rounded p-2 border border-purple-500/30">
                                        <div className="text-[10px] text-purple-400/70 font-mono mb-1">S2</div>
                                        <div className="font-mono text-sm text-purple-300">
                                            {tel.best_sector_2 > 0 ? Math.max(0, tel.best_sector_2 - tel.best_sector_1).toFixed(3) : "0.000"}
                                        </div>
                                    </div>
                                    <div className="bg-neutral-950 rounded p-2 border border-purple-500/30">
                                        <div className="text-[10px] text-purple-400/70 font-mono mb-1">S3</div>
                                        <div className="font-mono text-sm text-purple-300">
                                            {tel.best_lap_time > 0 && tel.best_sector_2 > 0 ? Math.max(0, tel.best_lap_time - tel.best_sector_2).toFixed(3) : "0.000"}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>        
                    </div>
                </>
            )}
        </div>
    );
}
