import { useState, useEffect } from 'react';
import { fetchDashboardData } from '../services/api';

export default function Dashboard() {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [connectionError, setConnectionError] = useState(false);

    useEffect(() => {
        let isMounted = true;

        const loadTelemetry = async () => {
            const result = await fetchDashboardData();
            if (isMounted) {
                if (result) {
                    setData(result);
                    setConnectionError(false);
                } else {
                    setConnectionError(true);
                }
                setLoading(false);
            }
        };

        // Carga inicial
        loadTelemetry();

        // Implementación del patrón de Polling (Sondeo)
        // El cliente consulta a la API REST cada 1 segundo (1000 ms)
        const pollInterval = setInterval(() => {
            loadTelemetry();
        }, 1000);

        // Cleanup function: Destruye el intervalo si el usuario cierra el componente
        return () => {
            isMounted = false;
            clearInterval(pollInterval);
        };
    }, []);

    if (loading) return <div className="text-white p-8 font-mono animate-pulse">Sincronizando telemetría...</div>;
    
    return (
        <div className="min-h-screen bg-neutral-900 text-neutral-100 p-8 font-sans">
            {connectionError && (
                <div className="bg-red-500/20 border border-red-500 text-red-400 p-2 mb-4 rounded text-sm font-mono animate-pulse">
                    ALERTA: Pérdida de paquetes con el backend.
                </div>
            )}
            
            {data && (
                <>
                    <header className="mb-8 border-b border-neutral-700 pb-4 flex justify-between items-end">
                        <div>
                            <h1 className="text-3xl font-bold tracking-tight text-white">Race Control | {data.session.car_name}</h1>
                            <p className="text-neutral-400 mt-1">{data.session.track_name} - {data.session.weather}</p>
                        </div>
                        <div className="text-right">
                            <span className="inline-flex items-center gap-1.5 py-1 px-3 rounded-full text-xs font-medium bg-green-500/10 text-green-400 border border-green-500/20">
                                <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span>
                                LIVE
                            </span>
                        </div>
                    </header>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        {/* Unidad de Potencia */}
                        <div className="bg-neutral-800 rounded-lg p-6 border border-neutral-700 shadow-lg flex flex-col justify-between">
                            <h2 className="text-xs uppercase tracking-widest text-neutral-400 mb-4">Unidad de Potencia</h2>
                            <div>
                                <div className="text-5xl font-mono font-bold text-blue-400">{data.current_telemetry.speed_kmh.toFixed(0)} <span className="text-lg text-neutral-500">km/h</span></div>
                                <div className="mt-4 text-2xl font-mono">{data.current_telemetry.rpm.toFixed(0)} <span className="text-sm text-neutral-500">RPM</span></div>
                            </div>
                            <div className="mt-6 pt-4 border-t border-neutral-700 flex justify-between">
                                <span className="text-sm text-neutral-400">Marcha Actual</span>
                                <span className="text-xl font-mono font-bold text-yellow-400">{data.current_telemetry.gear === 0 ? 'N' : data.current_telemetry.gear}</span>
                            </div>
                        </div>

                        {/* Temperatura de Neumáticos (Superficie) */}
                        <div className="bg-neutral-800 rounded-lg p-6 border border-neutral-700 shadow-lg">
                            <h2 className="text-xs uppercase tracking-widest text-neutral-400 mb-4">Temperaturas (Superficie)</h2>
                            <div className="grid grid-cols-2 gap-4 h-full content-center">
                                <div className="flex flex-col items-center p-3 bg-neutral-900 rounded border border-neutral-700">
                                    <span className="text-xs text-neutral-500 mb-1">FL</span>
                                    <span className="font-mono text-xl">{data.current_telemetry.tyre_temps_c.fl.toFixed(1)}°</span>
                                </div>
                                <div className="flex flex-col items-center p-3 bg-neutral-900 rounded border border-neutral-700">
                                    <span className="text-xs text-neutral-500 mb-1">FR</span>
                                    <span className="font-mono text-xl">{data.current_telemetry.tyre_temps_c.fr.toFixed(1)}°</span>
                                </div>
                                <div className="flex flex-col items-center p-3 bg-neutral-900 rounded border border-neutral-700">
                                    <span className="text-xs text-neutral-500 mb-1">RL</span>
                                    <span className="font-mono text-xl">{data.current_telemetry.tyre_temps_c.rl.toFixed(1)}°</span>
                                </div>
                                <div className="flex flex-col items-center p-3 bg-neutral-900 rounded border border-neutral-700">
                                    <span className="text-xs text-neutral-500 mb-1">RR</span>
                                    <span className="font-mono text-xl">{data.current_telemetry.tyre_temps_c.rr.toFixed(1)}°</span>
                                </div>
                            </div>
                        </div>

                        {/* Telemetría Dinámica */}
                        <div className="bg-neutral-800 rounded-lg p-6 border border-neutral-700 shadow-lg flex flex-col justify-between">
                            <h2 className="text-xs uppercase tracking-widest text-neutral-400 mb-4">Inputs del Piloto</h2>
                            <div className="space-y-4">
                                <div>
                                    <div className="flex justify-between text-xs mb-1">
                                        <span className="text-neutral-400">Acelerador</span>
                                        <span className="font-mono text-green-400">{(data.current_telemetry.throttle_pos).toFixed(0)}%</span>
                                    </div>
                                    <div className="w-full bg-neutral-900 rounded-full h-2.5 border border-neutral-700">
                                        <div className="bg-green-500 h-2.5 rounded-full transition-all duration-100" style={{ width: `${data.current_telemetry.throttle_pos}%` }}></div>
                                    </div>
                                </div>
                                <div>
                                    <div className="flex justify-between text-xs mb-1">
                                        <span className="text-neutral-400">Freno</span>
                                        <span className="font-mono text-red-400">{(data.current_telemetry.brake_pos).toFixed(0)}%</span>
                                    </div>
                                    <div className="w-full bg-neutral-900 rounded-full h-2.5 border border-neutral-700">
                                        <div className="bg-red-500 h-2.5 rounded-full transition-all duration-100" style={{ width: `${data.current_telemetry.brake_pos}%` }}></div>
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