export default function ClusterModal({ clusterInfo, currentClientId, onRefresh, onClose }) {
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
                                Servidores de API / Orquestadores
                            </div>
                            <div className="space-y-2">
                                {(clusterInfo?.api_nodes || []).map((n) => (
                                    <div
                                        key={n.node_id}
                                        className="flex justify-between items-center bg-neutral-900 px-3 py-2 rounded border border-neutral-800"
                                    >
                                        <div>
                                            <div className="font-bold text-neutral-200">{n.node_id}</div>
                                            <div className="text-[10px] text-neutral-500">{n.url}</div>
                                        </div>
                                        <span
                                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                                n.status === 'online'
                                                    ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                                                    : 'bg-red-500/15 text-red-400 border border-red-500/30'
                                            }`}
                                        >
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
                                    <div
                                        key={n.node_id}
                                        className="flex justify-between items-center bg-neutral-900 px-3 py-2 rounded border border-neutral-800"
                                    >
                                        <div>
                                            <div className="font-bold text-cyan-300">{n.node_id}</div>
                                            <div className="text-[10px] text-neutral-500">{n.url}</div>
                                        </div>
                                        <span
                                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                                n.status === 'online'
                                                    ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                                                    : 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                                            }`}
                                        >
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
                                Reloj Maestro Sincronizado:{' '}
                                <strong className="text-emerald-400">{clusterInfo?.sync_cursor_s ?? 0}s</strong>
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
                                        <tr
                                            key={c.client_id}
                                            className="border-b border-neutral-900 hover:bg-neutral-900/50"
                                        >
                                            <td className="py-2 px-2 font-bold text-white">
                                                {c.client_id}
                                                {c.client_id === currentClientId && (
                                                    <span className="ml-2 text-[9px] bg-blue-500/20 text-blue-300 border border-blue-500/30 px-1.5 py-0.5 rounded">
                                                        TÚ
                                                    </span>
                                                )}
                                            </td>
                                            <td className="py-2 px-2">
                                                <span
                                                    className={`px-2 py-0.5 rounded text-[10px] ${
                                                        c.mode === 'sync'
                                                            ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                                                            : 'bg-purple-500/15 text-purple-300 border border-purple-500/30'
                                                    }`}
                                                >
                                                    {c.mode === 'sync' ? 'SINCRONIZADO' : 'INDEPENDIENTE'}
                                                </span>
                                            </td>
                                            <td className="py-2 px-2 text-amber-300 font-semibold">
                                                {c.cursor_s.toFixed(1)}s
                                            </td>
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
}
