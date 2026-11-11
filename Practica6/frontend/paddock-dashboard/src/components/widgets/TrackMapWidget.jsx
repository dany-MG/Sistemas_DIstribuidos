import { useState, useEffect, useMemo, useCallback } from 'react';
import { fetchTrackMapFromMs, toggleMicroserviceState } from '../../services/api';

export default function TrackMapWidget({
    apiBaseUrl,
    activeSessionFile,
    trackName,
    currentLat = 0,
    currentLon = 0,
    fallbackCoords = [],
    msRefreshToken = 0,
    onMicroserviceStatusChange,
}) {
    const [mapState, setMapState] = useState({
        loading: true,
        offline503: false,
        errorMsg: null,
        coordinates: fallbackCoords || [],
        svgPoints: '',
        bounds: null,
        source: 'initial',
    });

    const loadTrackGeometry = useCallback(async () => {
        setMapState((prev) => ({
            ...prev,
            loading: prev.coordinates.length === 0 && (!fallbackCoords || fallbackCoords.length === 0),
        }));
        const res = await fetchTrackMapFromMs(apiBaseUrl);

        // Si el microservicio ms-track-map devolvió HTTP 503 (caída simulada o real),
        // aislamos el fallo en este widget para demostrar el patrón Bulkhead.
        if (res.status === 503) {
            setMapState({
                loading: false,
                offline503: true,
                errorMsg:
                    res.error ||
                    'El microservicio ms-track-map devolvió 503 Service Unavailable.',
                coordinates: [],
                svgPoints: '',
                bounds: null,
                source: 'isolated-fallback',
            });
            onMicroserviceStatusChange?.('ms-track-map', false);
            return;
        }

        if (res.ok && res.data) {
            const remoteCoords = res.data.coordinates || [];
            const remoteMatchesActiveSession =
                !activeSessionFile ||
                !res.data.active_session_file ||
                res.data.active_session_file === activeSessionFile;

            if (remoteCoords.length > 0 && remoteMatchesActiveSession) {
                setMapState({
                    loading: false,
                    offline503: false,
                    errorMsg: null,
                    coordinates: remoteCoords,
                    svgPoints: res.data.svg_points || '',
                    bounds: res.data.bounds || null,
                    source: 'ms-track-map',
                });
                onMicroserviceStatusChange?.('ms-track-map', true);
                return;
            }
        }

        // Si el usuario acaba de abrir un archivo .duckdb con DuckDB-Wasm en el navegador
        // (o si el servidor remoto aún está sincronizando), usamos la geometría extraída localmente.
        if (fallbackCoords && fallbackCoords.length > 0) {
            setMapState({
                loading: false,
                offline503: false,
                errorMsg: null,
                coordinates: fallbackCoords,
                svgPoints: '',
                bounds: null,
                source: 'wasm-client-fallback',
            });
            onMicroserviceStatusChange?.('ms-track-map', true);
            return;
        }

        setMapState({
            loading: false,
            offline503: false,
            errorMsg: res.error || null,
            coordinates: [],
            svgPoints: '',
            bounds: null,
            source: 'empty',
        });
    }, [apiBaseUrl, activeSessionFile, fallbackCoords, onMicroserviceStatusChange]);

    useEffect(() => {
        loadTrackGeometry();
    }, [loadTrackGeometry, msRefreshToken]);

    const handleReactivateMicroservice = async () => {
        await toggleMicroserviceState('ms-track-map', true, apiBaseUrl);
        await loadTrackGeometry();
    };

    const handleSimulateFailure = async () => {
        await toggleMicroserviceState('ms-track-map', false, apiBaseUrl);
        await loadTrackGeometry();
    };

    const mapProjection = useMemo(() => {
        if (mapState.offline503) return null;

        if (mapState.bounds && mapState.svgPoints) {
            const { min_lat, max_lat, min_lon, max_lon, size = 200, padding = 15 } = mapState.bounds;
            const latRange = max_lat - min_lat || 1;
            const lonRange = max_lon - min_lon || 1;
            const usable = size - padding * 2;

            const project = (lat, lon) => ({
                x: padding + ((lon - min_lon) / lonRange) * usable,
                y: size - padding - ((lat - min_lat) / latRange) * usable,
            });
            return { svgPoints: mapState.svgPoints, project };
        }

        const coords = mapState.coordinates;
        if (!coords || coords.length === 0) return null;

        const lats = coords.map((p) => p.lat);
        const lons = coords.map((p) => p.lon);
        const minLat = Math.min(...lats);
        const maxLat = Math.max(...lats);
        const minLon = Math.min(...lons);
        const maxLon = Math.max(...lons);

        const latRange = maxLat - minLat || 1;
        const lonRange = maxLon - minLon || 1;
        const padding = 15;
        const size = 200;

        const project = (lat, lon) => ({
            x: padding + ((lon - minLon) / lonRange) * (size - padding * 2),
            y: size - padding - ((lat - minLat) / latRange) * (size - padding * 2),
        });

        const svgPoints = coords
            .map((p) => {
                const { x, y } = project(p.lat, p.lon);
                return `${x.toFixed(1)},${y.toFixed(1)}`;
            })
            .join(' ');

        return { svgPoints, project };
    }, [mapState]);

    const carPos =
        mapProjection && currentLat !== 0 && currentLon !== 0
            ? mapProjection.project(currentLat, currentLon)
            : null;

    return (
        <div className="bg-neutral-900 rounded-lg p-5 border border-neutral-800 shadow-lg flex flex-col justify-between">
            <div className="flex justify-between items-center mb-2 gap-2">
                <div className="flex items-center gap-2">
                    <h2 className="text-xs uppercase tracking-widest text-neutral-400 font-mono">
                        Mapa GPS en Vivo
                    </h2>
                    <span
                        className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${
                            mapState.offline503
                                ? 'bg-red-500/15 text-red-400 border-red-500/30 font-bold'
                                : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                        }`}
                        title="Microservicio Atómico Independiente: ms-track-map"
                    >
                        {mapState.offline503 ? 'ms-track-map: OFFLINE' : 'ms-track-map'}
                    </span>
                </div>

                <div className="flex items-center gap-1.5">
                    <span className="text-xs font-mono text-purple-400 bg-purple-500/10 border border-purple-500/20 px-2 py-0.5 rounded truncate max-w-[145px]">
                        {trackName || 'DESCONOCIDO'}
                    </span>
                    {!mapState.offline503 && (
                        <button
                            onClick={handleSimulateFailure}
                            className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-neutral-950 hover:bg-red-500/20 text-neutral-500 hover:text-red-300 border border-neutral-800 hover:border-red-500/40 transition cursor-pointer"
                            title="Simular caída HTTP 503 del microservicio ms-track-map para verificar que la PWA no deja de funcionar"
                        >
                            SIMULAR FALLO
                        </button>
                    )}
                </div>
            </div>

            <div className="bg-neutral-950 rounded border border-neutral-800 relative flex items-center justify-center h-[210px] p-2">
                {mapState.offline503 ? (
                    <div className="flex flex-col items-center justify-center text-center px-3 space-y-2.5 font-mono">
                        <div className="px-2.5 py-0.5 rounded bg-red-500/15 border border-red-500/30 text-red-400 text-[10px] font-bold">
                            HTTP 503 • SERVICIO AISLADO (BULKHEAD)
                        </div>
                        <p className="text-[11px] text-neutral-300 max-w-xs leading-relaxed">
                            El microservicio <strong className="text-amber-300">ms-track-map</strong> no se encuentra
                            disponible. La telemetría a 20 Hz, gráficas y tiempos continúan operando sin afectación.
                        </p>
                        <div className="flex flex-wrap justify-center gap-2 pt-1">
                            <button
                                onClick={loadTrackGeometry}
                                className="px-2.5 py-1 rounded bg-neutral-900 hover:bg-neutral-800 text-neutral-300 border border-neutral-700 text-[10px] cursor-pointer"
                            >
                                REINTENTAR
                            </button>
                            <button
                                onClick={handleReactivateMicroservice}
                                className="px-2.5 py-1 rounded bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 text-[10px] font-bold cursor-pointer"
                            >
                                REACTIVAR ms-track-map
                            </button>
                        </div>
                    </div>
                ) : mapProjection ? (
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
                                <circle cx={carPos.x} cy={carPos.y} r="6" fill="#22c55e" fillOpacity="0.3" />
                                <circle
                                    cx={carPos.x}
                                    cy={carPos.y}
                                    r="4"
                                    fill="#22c55e"
                                    stroke="#ffffff"
                                    strokeWidth="1.5"
                                />
                            </g>
                        )}
                    </svg>
                ) : (
                    <span className="text-xs font-mono text-neutral-500 animate-pulse">
                        {mapState.loading
                            ? 'Consultando microservicio ms-track-map...'
                            : 'Geometría GPS no disponible para esta sesión'}
                    </span>
                )}
            </div>

            <div className="mt-2.5 grid grid-cols-2 gap-2 text-xs font-mono text-neutral-500 pt-2 border-t border-neutral-800">
                <div>
                    LAT: <span className="text-neutral-300">{currentLat.toFixed(5)}°</span>
                </div>
                <div>
                    LON: <span className="text-neutral-300">{currentLon.toFixed(5)}°</span>
                </div>
            </div>
        </div>
    );
}
