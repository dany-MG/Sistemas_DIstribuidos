import { useState, useEffect, useMemo, useCallback } from 'react';
import { fetchCarSetupFromMs, toggleMicroserviceState } from '../../services/api';

export default function SetupModal({
    apiBaseUrl,
    fallbackSetup,
    carName,
    onClose,
    onMicroserviceStatusChange,
}) {
    const [filter, setFilter] = useState('');
    const [setupState, setSetupState] = useState({
        loading: true,
        offline503: false,
        errorMsg: null,
        setupData: fallbackSetup || {},
    });

    const loadSetupFromMicroservice = useCallback(async () => {
        setSetupState((prev) => ({ ...prev, loading: true }));
        const res = await fetchCarSetupFromMs(apiBaseUrl);

        if (res.ok && res.data?.setup) {
            setSetupState({
                loading: false,
                offline503: false,
                errorMsg: null,
                setupData: res.data.setup,
            });
            onMicroserviceStatusChange?.('ms-car-setup', true);
            return;
        }

        if (res.status === 503) {
            setSetupState({
                loading: false,
                offline503: true,
                errorMsg:
                    res.error ||
                    'El microservicio ms-car-setup se encuentra fuera de línea (503 Service Unavailable).',
                setupData: {},
            });
            onMicroserviceStatusChange?.('ms-car-setup', false);
            return;
        }

        setSetupState({
            loading: false,
            offline503: false,
            errorMsg: null,
            setupData: fallbackSetup || {},
        });
    }, [apiBaseUrl, fallbackSetup, onMicroserviceStatusChange]);

    useEffect(() => {
        loadSetupFromMicroservice();
    }, [loadSetupFromMicroservice]);

    const handleReactivateSetupMs = async () => {
        await toggleMicroserviceState('ms-car-setup', true, apiBaseUrl);
        await loadSetupFromMicroservice();
    };

    const entries = useMemo(() => {
        if (!setupState.setupData) return [];
        return Object.entries(setupState.setupData).filter(([key, item]) => {
            if (!filter.trim()) return true;
            const q = filter.toLowerCase();
            return (
                key.toLowerCase().includes(q) ||
                (item.caption && item.caption.toLowerCase().includes(q)) ||
                (item.string_value && String(item.string_value).toLowerCase().includes(q))
            );
        });
    }, [setupState.setupData, filter]);

    return (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4">
            <div className="bg-neutral-900 border border-neutral-700 rounded-lg max-w-4xl w-full max-h-[92vh] sm:max-h-[82vh] flex flex-col shadow-2xl overflow-hidden">
                <div className="p-3 sm:p-4 border-b border-neutral-800 flex flex-wrap justify-between items-center gap-2 sm:gap-4">
                    <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 text-[10px] font-mono uppercase tracking-widest text-neutral-400">
                            <span>Ingeniería de Pista</span>
                            <span>•</span>
                            <span
                                className={
                                    setupState.offline503
                                        ? 'text-red-400 font-bold'
                                        : 'text-emerald-400 font-bold'
                                }
                            >
                                {setupState.offline503 ? 'ms-car-setup OFFLINE (503)' : 'ms-car-setup ONLINE'}
                            </span>
                        </div>
                        <h3 className="text-sm sm:text-lg font-bold text-white font-mono break-words mt-0.5">
                            CAR SETUP — {carName || 'VEHÍCULO'} ({entries.length} parámetros)
                        </h3>
                    </div>
                    <button
                        onClick={onClose}
                        className="px-3 py-1.5 sm:py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-xs font-mono border border-neutral-700 cursor-pointer shrink-0"
                    >
                        CERRAR [ESC]
                    </button>
                </div>

                <div className="p-3 border-b border-neutral-800 bg-neutral-950">
                    <input
                        type="text"
                        value={filter}
                        onChange={(e) => setFilter(e.target.value)}
                        disabled={setupState.offline503}
                        placeholder="Filtrar parámetro (ej. BRAKE, WING, SPRING, CAMBER, PRESSURE)..."
                        className="w-full bg-neutral-900 border border-neutral-800 rounded px-3 py-1.5 text-xs font-mono text-white placeholder-neutral-500 focus:outline-none focus:border-blue-500 disabled:opacity-50"
                    />
                </div>

                {setupState.offline503 ? (
                    <div className="p-8 text-center font-mono space-y-4">
                        <div className="inline-block px-3 py-1 rounded bg-red-500/15 border border-red-500/30 text-red-400 text-xs font-bold">
                            AISLAMIENTO DE FALLOS • MICROSERVICIO ms-car-setup FUERA DE LÍNEA (503)
                        </div>
                        <p className="text-xs text-neutral-300 max-w-lg mx-auto leading-relaxed">
                            {setupState.errorMsg} El resto del Dashboard de Telemetría continúa ejecutándose sin
                            interrupciones.
                        </p>
                        <div className="flex justify-center gap-3">
                            <button
                                onClick={loadSetupFromMicroservice}
                                className="px-3 py-1.5 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-xs border border-neutral-700 cursor-pointer"
                            >
                                REINTENTAR CONEXIÓN
                            </button>
                            <button
                                onClick={handleReactivateSetupMs}
                                className="px-3 py-1.5 rounded bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 text-xs font-bold border border-emerald-500/40 cursor-pointer"
                            >
                                REACTIVAR ms-car-setup
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className="p-4 overflow-y-auto grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5 text-xs font-mono">
                        {entries.map(([key, item]) => (
                            <div
                                key={key}
                                className="bg-neutral-950 border border-neutral-800 rounded p-2.5 flex flex-col justify-between"
                            >
                                <div className="text-[10px] text-neutral-500 truncate" title={key}>
                                    {item.caption || key.replace(/^(VM_|WM_)/, '')}
                                </div>
                                <div className="mt-1 flex justify-between items-baseline gap-2">
                                    <span className="text-sm font-bold text-blue-400 truncate">
                                        {item.string_value || String(item.value ?? 'N/A')}
                                    </span>
                                    {item.last_saved && item.last_saved !== item.string_value && (
                                        <span
                                            className="text-[10px] text-neutral-500 truncate"
                                            title={`Guardado: ${item.last_saved}`}
                                        >
                                            Base: {item.last_saved}
                                        </span>
                                    )}
                                </div>
                            </div>
                        ))}
                        {entries.length === 0 && (
                            <div className="col-span-full text-center py-8 text-neutral-500 font-mono">
                                {setupState.loading
                                    ? 'Consultando microservicio ms-car-setup...'
                                    : `No se encontraron parámetros que coincidan con "${filter}".`}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
