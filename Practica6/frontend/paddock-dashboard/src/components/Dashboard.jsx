import { useState, useEffect, useRef, useCallback } from 'react';
import {
    getApiNodes,
    DATA_NODES,
    getClientId,
    generateNewClientId,
    fetchClusterStatus,
    fetchMicroservicesStatus,
    resetPlayback,
    switchSession,
    getCarImageUrl,
    registerTelemetryServiceWorker,
    loadInitialSessionPackFast,
    fetchRemoteSessionPack,
    registerSessionPackOnServer,
    uploadRawDuckdbFileToServer,
    syncClientStateWithServer,
} from '../services/api';
import { TelemetryClientEngine } from '../services/telemetryEngine';
import { parseDuckdbFileInBrowser } from '../services/duckdbClientReader';
import { LineChart, Line, YAxis, ResponsiveContainer } from 'recharts';

import ErrorBoundary from './widgets/ErrorBoundary';
import TrackMapWidget from './widgets/TrackMapWidget';
import SetupModal from './widgets/SetupModal';
import MicroservicesModal from './widgets/MicroservicesModal';
import ClusterModal from './widgets/ClusterModal';
import WheelCard from './widgets/WheelCard';
import WeatherWidget from './widgets/WeatherWidget';

const formatTime = (timeInSeconds) => {
    if (!timeInSeconds || timeInSeconds <= 0) return '00:00.000';
    const minutes = Math.floor(timeInSeconds / 60);
    const seconds = timeInSeconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${seconds.toFixed(3).padStart(6, '0')}`;
};

export default function Dashboard() {
    const [apiNodes] = useState(() => getApiNodes());
    const [clientId, setClientId] = useState(() => getClientId());
    const [playbackMode, setPlaybackMode] = useState('sync'); // 'sync' | 'independent'
    const [selectedApiNodeUrl, setSelectedApiNodeUrl] = useState(() => getApiNodes()[0].baseUrl);
    const [selectedDataNode, setSelectedDataNode] = useState('auto');

    const [data, setData] = useState(null);
    const [trackCoords, setTrackCoords] = useState([]);
    const [clusterStatus, setClusterStatus] = useState(null);
    const [loading, setLoading] = useState(true);
    const [connectionError, setConnectionError] = useState(false);
    const [backendOnline, setBackendOnline] = useState(false);
    const [activeClientsCount, setActiveClientsCount] = useState(1);
    const [roomSyncTimeDisplay, setRoomSyncTimeDisplay] = useState(15.0);
    const [telemetryHistory, setTelemetryHistory] = useState([]);
    const [isPaused, setIsPaused] = useState(false);
    const [showSetupModal, setShowSetupModal] = useState(false);
    const [showClusterModal, setShowClusterModal] = useState(false);
    const [showMicroservicesModal, setShowMicroservicesModal] = useState(false);
    const [duckdbUploadStatus, setDuckdbUploadStatus] = useState('');
    const [msRefreshToken, setMsRefreshToken] = useState(0);
    const [msHealthMap, setMsHealthMap] = useState({
        'ms-track-map': true,
        'ms-car-setup': true,
        'ms-session-catalog': true,
        'ms-telemetry-pack': true,
        'ms-room-sync': true,
    });

    // Referencias separadas: Reloj Maestro Sincronizado de la Sala (sync) vs Reloj Independiente del Cliente (independent)
    const engineRef = useRef(null);
    const syncCursorRef = useRef(15.0);
    const indCursorRef = useRef(15.0);
    const lastServerResetTsRef = useRef(0.0);
    const broadcastChannelRef = useRef(null);
    const localPeersRef = useRef({});
    const serverClientsRef = useRef([]);
    const loadedPacksRef = useRef({});
    const activeSessionNameRef = useRef('');
    const fileInputRef = useRef(null);

    const syncMetaRef = useRef({
        api_node_id: 'api-node-1',
        data_node_id: 'data-node-1',
        active_clients_count: 1,
        playback_mode: 'sync',
    });

    const handleMicroserviceStatusChange = useCallback((msId, isOnline) => {
        setMsHealthMap((prev) => {
            if (prev[msId] === isOnline) return prev;
            return { ...prev, [msId]: isOnline };
        });
    }, []);

    const handleServiceToggledFromModal = useCallback((msId, isOnline) => {
        setMsHealthMap((prev) => ({ ...prev, [msId]: isOnline }));
        setMsRefreshToken((n) => n + 1);
    }, []);

    const getActiveCursor = (mode = playbackMode) => {
        return mode === 'sync' ? syncCursorRef.current : indCursorRef.current;
    };

    const recomputeConnectedClients = () => {
        const now = Date.now();
        const peers = localPeersRef.current;
        for (const pid of Object.keys(peers)) {
            if (now - peers[pid].lastSeen > 3500) {
                delete peers[pid];
            }
        }

        const currentNodeObj = apiNodes.find((n) => n.baseUrl === selectedApiNodeUrl);
        const selfEntry = {
            client_id: clientId,
            mode: playbackMode,
            cursor_s: Number(getActiveCursor().toFixed(1)),
            api_node: syncMetaRef.current.api_node_id || currentNodeObj?.id || 'api-node-1',
            data_node:
                syncMetaRef.current.data_node_id ||
                (selectedDataNode === 'auto' ? 'data-node-1' : selectedDataNode),
        };

        const mergedMap = new Map();
        for (const sc of serverClientsRef.current) {
            if (sc && sc.client_id) {
                mergedMap.set(sc.client_id, sc);
            }
        }
        for (const [pid, pinfo] of Object.entries(peers)) {
            mergedMap.set(pid, {
                client_id: pid,
                mode: pinfo.mode || 'sync',
                cursor_s: Number((pinfo.cursor_s ?? 15.0).toFixed(1)),
                api_node: pinfo.api_node || 'api-node-1',
                data_node: pinfo.data_node || 'data-node-1',
            });
        }
        mergedMap.set(clientId, selfEntry);

        const mergedList = Array.from(mergedMap.values());
        const totalCount = Math.max(1, mergedList.length);

        syncMetaRef.current.active_clients_count = totalCount;
        setActiveClientsCount(totalCount);

        setClusterStatus((prev) => ({
            ...(prev || {
                current_api_node: selfEntry.api_node,
                state_backend: backendOnline ? 'ipc_shared_store' : 'browser_broadcast_mesh',
                api_nodes: [
                    { node_id: 'api-node-1', role: 'api', url: apiNodes[0]?.baseUrl || '', status: 'online' },
                    { node_id: 'api-node-2', role: 'api', url: apiNodes[1]?.baseUrl || '', status: 'online' },
                ],
                data_nodes: [
                    { node_id: 'data-node-1', role: 'data', url: 'internal://data-node-1', status: 'online' },
                    { node_id: 'data-node-2', role: 'data', url: 'internal://data-node-2', status: 'online' },
                ],
            }),
            sync_cursor_s: Number(syncCursorRef.current.toFixed(1)),
            connected_clients: mergedList,
        }));
    };

    const applyPackPayload = (packPayload, mode) => {
        const actualPayload = packPayload?.packData ? packPayload.packData : packPayload;
        if (!actualPayload || !actualPayload.telemetry_pack) return false;

        const engine = new TelemetryClientEngine(actualPayload.telemetry_pack);
        engineRef.current = engine;

        syncCursorRef.current = engine.clampCursor(syncCursorRef.current);
        indCursorRef.current = engine.clampCursor(indCursorRef.current);

        const resolvedApiNode =
            actualPayload.api_node_id ||
            actualPayload.cluster?.current_api_node ||
            syncMetaRef.current.api_node_id;
        const resolvedDataNode = actualPayload.data_node_id || syncMetaRef.current.data_node_id;

        syncMetaRef.current = {
            ...syncMetaRef.current,
            api_node_id: resolvedApiNode,
            data_node_id: resolvedDataNode,
            playback_mode: mode,
        };

        const activeCur = mode === 'sync' ? syncCursorRef.current : indCursorRef.current;
        const initialSnapshot = engine.computeSnapshotAt(activeCur, syncMetaRef.current);

        setTrackCoords(actualPayload.track_map || []);
        if (actualPayload.cluster) {
            setClusterStatus(actualPayload.cluster);
        }

        const sessionFilename =
            actualPayload.active_session_file ||
            'Sebring International Raceway_P_2026-10-18T21_03_43Z.duckdb';
        activeSessionNameRef.current = sessionFilename;
        loadedPacksRef.current[sessionFilename] = actualPayload;

        const knownSessions = Array.from(
            new Set([
                ...(actualPayload.available_sessions || []),
                ...Object.keys(loadedPacksRef.current),
                sessionFilename,
            ])
        );

        setData({
            status: 'Session Pack Loaded (20 Hz Client Engine)',
            session: actualPayload.session || {},
            setup: actualPayload.setup || {},
            available_sessions: knownSessions,
            active_session_file: sessionFilename,
            current_telemetry: initialSnapshot,
        });
        setTelemetryHistory((preset) =>
            preset && preset.length > 0 ? preset : initialSnapshot ? [initialSnapshot] : []
        );
        return true;
    };

    // 1. Registro del Service Worker y carga instantánea del Session Pack a 20 Hz
    useEffect(() => {
        let isMounted = true;
        registerTelemetryServiceWorker();

        const initializePitWall = async () => {
            const packPayload = await loadInitialSessionPackFast(selectedApiNodeUrl, selectedDataNode);
            if (!isMounted) return;

            if (packPayload && applyPackPayload(packPayload, playbackMode)) {
                setLoading(false);
            } else {
                setConnectionError(true);
                setLoading(false);
            }

            // Revalidación silenciosa con el microservicio ms-telemetry-pack una vez que despierte
            fetchRemoteSessionPack(selectedApiNodeUrl, selectedDataNode).then((remotePack) => {
                if (isMounted && remotePack && remotePack.telemetry_pack) {
                    setBackendOnline(true);
                    setConnectionError(false);
                    applyPackPayload(remotePack, playbackMode);
                }
            });

            fetchMicroservicesStatus(selectedApiNodeUrl).then((msSummary) => {
                if (isMounted && msSummary && Array.isArray(msSummary.microservices)) {
                    const nextMap = {};
                    for (const item of msSummary.microservices) {
                        nextMap[item.ms_id] = Boolean(item.enabled);
                    }
                    setMsHealthMap((prev) => ({ ...prev, ...nextMap }));
                }
            });
        };

        initializePitWall();

        return () => {
            isMounted = false;
        };
    }, []);

    // 2. Malla Local Multi-Pestaña (BroadcastChannel) para detección instantánea de clientes y reloj compartido (<10 ms)
    useEffect(() => {
        if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return;

        const instanceUuid = Math.random().toString(36).slice(2);
        const bc = new BroadcastChannel('lmu_paddock_room_sync');
        broadcastChannelRef.current = bc;

        const sendLocalHeartbeat = () => {
            const currentNodeObj = apiNodes.find((n) => n.baseUrl === selectedApiNodeUrl);
            bc.postMessage({
                type: 'HEARTBEAT',
                instanceUuid,
                clientId,
                mode: playbackMode,
                cursor_s: getActiveCursor(),
                syncCursor_s: syncCursorRef.current,
                api_node: syncMetaRef.current.api_node_id || currentNodeObj?.id || 'api-node-1',
                data_node:
                    syncMetaRef.current.data_node_id ||
                    (selectedDataNode === 'auto' ? 'data-node-1' : selectedDataNode),
                ts: Date.now(),
            });
        };

        bc.onmessage = (ev) => {
            const msg = ev.data;
            if (!msg || msg.instanceUuid === instanceUuid) return;

            if (msg.clientId === clientId) {
                const newCid = generateNewClientId();
                setClientId(newCid);
                return;
            }

            if (msg.type === 'HEARTBEAT') {
                localPeersRef.current[msg.clientId] = {
                    client_id: msg.clientId,
                    mode: msg.mode,
                    cursor_s: msg.cursor_s,
                    api_node: msg.api_node,
                    data_node: msg.data_node,
                    lastSeen: Date.now(),
                };

                if (!backendOnline && msg.mode === 'sync' && typeof msg.syncCursor_s === 'number') {
                    if (msg.syncCursor_s > syncCursorRef.current + 0.3) {
                        syncCursorRef.current = msg.syncCursor_s;
                    }
                }
                recomputeConnectedClients();
            } else if (msg.type === 'RESET_SYNC') {
                syncCursorRef.current = typeof msg.cursor_s === 'number' ? msg.cursor_s : 15.0;
                if (playbackMode === 'sync') {
                    setTelemetryHistory([]);
                }
                recomputeConnectedClients();
            } else if (msg.type === 'SESSION_SWITCH' && msg.packPayload) {
                syncCursorRef.current = 15.0;
                indCursorRef.current = 15.0;
                setTelemetryHistory([]);
                applyPackPayload(msg.packPayload, playbackMode);
                setMsRefreshToken((n) => n + 1);
            } else if (msg.type === 'LEAVE') {
                delete localPeersRef.current[msg.clientId];
                recomputeConnectedClients();
            }
        };

        sendLocalHeartbeat();
        const hbInterval = setInterval(() => {
            sendLocalHeartbeat();
            recomputeConnectedClients();
        }, 700);

        const handleUnload = () => {
            try {
                bc.postMessage({ type: 'LEAVE', instanceUuid, clientId });
            } catch {}
        };
        window.addEventListener('beforeunload', handleUnload);

        return () => {
            clearInterval(hbInterval);
            window.removeEventListener('beforeunload', handleUnload);
            handleUnload();
            bc.close();
        };
    }, [clientId, playbackMode, selectedApiNodeUrl, selectedDataNode, backendOnline]);

    // 3. Motor de Telemetría en el Cliente a 20 Hz (50 ms) con Delta-Time Real (1.0x exacto)
    useEffect(() => {
        if (loading) return;

        let lastPerfNow = performance.now();

        const tickInterval = setInterval(() => {
            const now = performance.now();
            const dt = Math.min(0.25, Math.max(0.001, (now - lastPerfNow) / 1000.0));
            lastPerfNow = now;

            const engine = engineRef.current;
            if (!engine) return;

            syncCursorRef.current = engine.advanceCursor(syncCursorRef.current, dt);
            setRoomSyncTimeDisplay(syncCursorRef.current);

            if (isPaused) return;

            if (playbackMode === 'independent') {
                indCursorRef.current = engine.advanceCursor(indCursorRef.current, dt);
            }

            const activeCursor = playbackMode === 'sync' ? syncCursorRef.current : indCursorRef.current;
            const liveTelemetry = engine.computeSnapshotAt(activeCursor, {
                ...syncMetaRef.current,
                playback_mode: playbackMode,
            });

            if (liveTelemetry) {
                setData((prevData) =>
                    prevData
                        ? {
                              ...prevData,
                              current_telemetry: liveTelemetry,
                          }
                        : prevData
                );

                setTelemetryHistory((prevHistory) => {
                    const nextHistory = [...prevHistory, liveTelemetry];
                    return nextHistory.slice(-160);
                });
            }
        }, 50);

        return () => clearInterval(tickInterval);
    }, [loading, isPaused, playbackMode]);

    // 4. Sincronización ultraligera con el microservicio ms-room-sync cada 1.5s
    useEffect(() => {
        if (loading) return;
        let isMounted = true;

        const syncWithBackend = async () => {
            const engine = engineRef.current;
            const durationSec = engine ? engine.durationSec : 649.5;
            const activeCursor = playbackMode === 'sync' ? syncCursorRef.current : indCursorRef.current;

            const syncResp = await syncClientStateWithServer(
                selectedApiNodeUrl,
                clientId,
                playbackMode,
                activeCursor,
                selectedDataNode,
                durationSec
            );

            if (!isMounted) return;

            // Si ms-room-sync está en fallo 503 aislado, conmutamos al bus local sin detener la página
            if (syncResp && syncResp.__ms_offline) {
                handleMicroserviceStatusChange('ms-room-sync', false);
                recomputeConnectedClients();
                return;
            }

            if (syncResp) {
                handleMicroserviceStatusChange('ms-room-sync', true);
                setBackendOnline(true);
                setConnectionError(false);

                if (
                    typeof syncResp.sync_reset_ts === 'number' &&
                    syncResp.sync_reset_ts > lastServerResetTsRef.current &&
                    lastServerResetTsRef.current > 0
                ) {
                    syncCursorRef.current = 15.0;
                    if (playbackMode === 'sync') {
                        setTelemetryHistory([]);
                    }
                }
                if (typeof syncResp.sync_reset_ts === 'number') {
                    lastServerResetTsRef.current = syncResp.sync_reset_ts;
                }

                if (typeof syncResp.sync_cursor_s === 'number') {
                    const drift = Math.abs(syncCursorRef.current - syncResp.sync_cursor_s);
                    if (drift > 0.45) {
                        syncCursorRef.current = syncResp.sync_cursor_s;
                    }
                }

                if (Array.isArray(syncResp.connected_clients)) {
                    serverClientsRef.current = syncResp.connected_clients;
                }

                if (
                    syncResp.active_session_file &&
                    activeSessionNameRef.current &&
                    syncResp.active_session_file !== activeSessionNameRef.current
                ) {
                    activeSessionNameRef.current = syncResp.active_session_file;
                    if (loadedPacksRef.current[syncResp.active_session_file]) {
                        applyPackPayload(loadedPacksRef.current[syncResp.active_session_file], playbackMode);
                        setMsRefreshToken((n) => n + 1);
                    } else {
                        fetchRemoteSessionPack(
                            selectedApiNodeUrl,
                            selectedDataNode,
                            syncResp.active_session_file
                        ).then((newPack) => {
                            if (isMounted && newPack && newPack.telemetry_pack) {
                                syncCursorRef.current = 15.0;
                                setTelemetryHistory([]);
                                applyPackPayload(newPack, playbackMode);
                                setMsRefreshToken((n) => n + 1);
                            }
                        });
                    }
                } else if (Array.isArray(syncResp.available_sessions) && syncResp.available_sessions.length > 0) {
                    setData((prev) => {
                        if (!prev) return prev;
                        const merged = Array.from(
                            new Set([
                                ...(prev.available_sessions || []),
                                ...syncResp.available_sessions,
                                ...Object.keys(loadedPacksRef.current),
                            ])
                        );
                        if (merged.length === (prev.available_sessions || []).length) return prev;
                        return { ...prev, available_sessions: merged };
                    });
                }

                syncMetaRef.current = {
                    ...syncMetaRef.current,
                    api_node_id: syncResp.api_node_id || 'api-node-1',
                    data_node_id:
                        syncResp.data_node_id ||
                        (selectedDataNode === 'auto' ? 'data-node-1' : selectedDataNode),
                    playback_mode: playbackMode,
                };
                recomputeConnectedClients();
            } else {
                setBackendOnline(false);
                const currentNodeObj = apiNodes.find((n) => n.baseUrl === selectedApiNodeUrl);
                syncMetaRef.current = {
                    ...syncMetaRef.current,
                    api_node_id: currentNodeObj?.id || 'api-node-1',
                    data_node_id: selectedDataNode === 'auto' ? 'data-node-1' : selectedDataNode,
                    playback_mode: playbackMode,
                };
                recomputeConnectedClients();

                const fallbackNode = apiNodes.find((n) => n.baseUrl !== selectedApiNodeUrl);
                if (fallbackNode) {
                    setSelectedApiNodeUrl(fallbackNode.baseUrl);
                }
            }
        };

        syncWithBackend();
        const syncTimer = setInterval(syncWithBackend, 1500);

        return () => {
            isMounted = false;
            clearInterval(syncTimer);
        };
    }, [loading, selectedApiNodeUrl, clientId, playbackMode, selectedDataNode, handleMicroserviceStatusChange]);

    const handleRefreshCluster = async () => {
        const status = await fetchClusterStatus(selectedApiNodeUrl);
        if (status) {
            if (Array.isArray(status.connected_clients)) {
                serverClientsRef.current = status.connected_clients;
            }
            setBackendOnline(true);
            recomputeConnectedClients();
        } else {
            recomputeConnectedClients();
        }
    };

    const handleResetPlayback = async () => {
        const engine = engineRef.current;
        const startSec = engine ? engine.getStartTime() : 15.0;

        if (playbackMode === 'sync') {
            syncCursorRef.current = startSec;
            if (broadcastChannelRef.current) {
                try {
                    broadcastChannelRef.current.postMessage({
                        type: 'RESET_SYNC',
                        clientId,
                        cursor_s: startSec,
                    });
                } catch {}
            }
        } else {
            indCursorRef.current = startSec;
        }

        setTelemetryHistory([]);
        await resetPlayback(selectedApiNodeUrl, clientId, playbackMode);
    };

    const handleToggleMode = (newMode) => {
        if (newMode === playbackMode) return;
        if (newMode === 'independent' && playbackMode === 'sync') {
            indCursorRef.current = syncCursorRef.current;
        }

        setPlaybackMode(newMode);
        syncMetaRef.current = {
            ...syncMetaRef.current,
            playback_mode: newMode,
        };
        setTelemetryHistory([]);

        const engine = engineRef.current;
        if (engine) {
            const targetCursor = newMode === 'sync' ? syncCursorRef.current : indCursorRef.current;
            const snap = engine.computeSnapshotAt(targetCursor, {
                ...syncMetaRef.current,
                playback_mode: newMode,
            });
            setData((prev) => (prev ? { ...prev, current_telemetry: snap } : prev));
        }
    };

    const handleScrubIndependentTime = (newTimeSec) => {
        const numericSec = Number(newTimeSec);
        if (!Number.isFinite(numericSec)) return;
        if (playbackMode !== 'independent') {
            setPlaybackMode('independent');
            syncMetaRef.current.playback_mode = 'independent';
        }
        indCursorRef.current = numericSec;
        const engine = engineRef.current;
        if (engine) {
            const snap = engine.computeSnapshotAt(numericSec, {
                ...syncMetaRef.current,
                playback_mode: 'independent',
            });
            setData((prev) => (prev ? { ...prev, current_telemetry: snap } : prev));
        }
    };

    const handleSessionChange = async (e) => {
        const newSession = e.target.value;
        if (!newSession || newSession === activeSessionNameRef.current) return;

        syncCursorRef.current = 15.0;
        indCursorRef.current = 15.0;
        setTelemetryHistory([]);

        if (loadedPacksRef.current[newSession]) {
            const cachedPack = loadedPacksRef.current[newSession];
            applyPackPayload(cachedPack, playbackMode);
            setMsRefreshToken((n) => n + 1);
            if (broadcastChannelRef.current) {
                try {
                    broadcastChannelRef.current.postMessage({
                        type: 'SESSION_SWITCH',
                        clientId,
                        packPayload: cachedPack,
                    });
                } catch {}
            }
            switchSession(newSession, selectedApiNodeUrl).catch(() => {});
            return;
        }

        setDuckdbUploadStatus(`Cambiando a sesión ${newSession}...`);
        await switchSession(newSession, selectedApiNodeUrl);
        const remotePack = await fetchRemoteSessionPack(selectedApiNodeUrl, selectedDataNode, newSession);
        if (remotePack) {
            applyPackPayload(remotePack, playbackMode);
            setMsRefreshToken((n) => n + 1);
            if (broadcastChannelRef.current) {
                try {
                    broadcastChannelRef.current.postMessage({
                        type: 'SESSION_SWITCH',
                        clientId,
                        packPayload: remotePack,
                    });
                } catch {}
            }
        }
        setDuckdbUploadStatus('');
    };

    const handleUploadDuckdbFile = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        e.target.value = '';

        try {
            const localPackPayload = await parseDuckdbFileInBrowser(file, 20, (msg) => {
                setDuckdbUploadStatus(msg);
            });

            syncCursorRef.current = 15.0;
            indCursorRef.current = 15.0;
            setTelemetryHistory([]);
            applyPackPayload(localPackPayload, playbackMode);

            if (broadcastChannelRef.current) {
                try {
                    broadcastChannelRef.current.postMessage({
                        type: 'SESSION_SWITCH',
                        clientId,
                        packPayload: localPackPayload,
                    });
                } catch {}
            }

            setDuckdbUploadStatus('Sincronizando sesión con el microservicio ms-session-catalog...');
            await registerSessionPackOnServer(file.name, localPackPayload, selectedApiNodeUrl);
            setMsRefreshToken((n) => n + 1);
            setDuckdbUploadStatus('');
        } catch (wasmErr) {
            console.warn('Fallback a subida directa al microservicio ms-session-catalog:', wasmErr);
            setDuckdbUploadStatus(`Subiendo ${file.name} al microservicio ms-session-catalog...`);
            const uploadedPack = await uploadRawDuckdbFileToServer(file, selectedApiNodeUrl);
            if (uploadedPack && uploadedPack.telemetry_pack) {
                syncCursorRef.current = 15.0;
                indCursorRef.current = 15.0;
                setTelemetryHistory([]);
                applyPackPayload(uploadedPack, playbackMode);
                setMsRefreshToken((n) => n + 1);
                if (broadcastChannelRef.current) {
                    try {
                        broadcastChannelRef.current.postMessage({
                            type: 'SESSION_SWITCH',
                            clientId,
                            packPayload: uploadedPack,
                        });
                    } catch {}
                }
            }
            setDuckdbUploadStatus('');
        }
    };

    if (loading) {
        return (
            <div className="text-white p-8 font-mono animate-pulse">
                Sincronizando telemetría con Clúster de Microservicios Paddock...
            </div>
        );
    }

    const tel = data?.current_telemetry || {};
    const rawSteering = tel.steering_pos || 0;
    const normalizedSteering = Math.abs(rawSteering) <= 1.0 ? rawSteering * 100 : rawSteering;
    const steeringDeg = (normalizedSteering / 100) * 270;

    const maxRpm = tel.max_rpm > 0 ? tel.max_rpm : 9500;
    const rpmPercent = Math.min(100, Math.max(0, ((tel.rpm || 0) / maxRpm) * 100));

    const currentLat = tel.gps_lat || 0;
    const currentLon = tel.gps_lon || 0;
    const activeSector = tel.current_sector === 0 ? 3 : tel.current_sector || 1;
    const carBrandImageUrl = getCarImageUrl(
        data?.session?.car_name,
        data?.session?.car_brand,
        data?.session?.car_class
    );

    const activeMsCount = Object.values(msHealthMap).filter(Boolean).length;
    const totalMsCount = Object.keys(msHealthMap).length;

    return (
        <div className="min-h-screen bg-neutral-950 text-neutral-100 p-6 font-sans">
            {duckdbUploadStatus && (
                <div className="bg-cyan-500/20 border border-cyan-500 text-cyan-200 p-2.5 mb-4 rounded text-xs font-mono animate-pulse flex justify-between items-center">
                    <span>DUCKDB-WASM CLIENT ENGINE: {duckdbUploadStatus}</span>
                    <span>ms-session-catalog • 20 Hz</span>
                </div>
            )}

            {connectionError && (
                <div className="bg-amber-500/20 border border-amber-500 text-amber-300 p-2 mb-4 rounded text-xs font-mono animate-pulse flex justify-between items-center">
                    <span>
                        CONMUTACIÓN DE NODO: Reconectando flujo de telemetría con otro servidor activo del clúster...
                    </span>
                    <span>CLIENT: {clientId}</span>
                </div>
            )}

            {showSetupModal && data && (
                <ErrorBoundary serviceName="ms-car-setup Modal">
                    <SetupModal
                        apiBaseUrl={selectedApiNodeUrl}
                        fallbackSetup={data.setup}
                        carName={data.session?.car_name}
                        onClose={() => setShowSetupModal(false)}
                        onMicroserviceStatusChange={handleMicroserviceStatusChange}
                    />
                </ErrorBoundary>
            )}

            {showClusterModal && (
                <ErrorBoundary serviceName="Topología MC-MS Modal">
                    <ClusterModal
                        clusterInfo={clusterStatus}
                        currentClientId={clientId}
                        onRefresh={handleRefreshCluster}
                        onClose={() => setShowClusterModal(false)}
                    />
                </ErrorBoundary>
            )}

            {showMicroservicesModal && (
                <ErrorBoundary serviceName="Orquestador de Microservicios">
                    <MicroservicesModal
                        apiBaseUrl={selectedApiNodeUrl}
                        onServiceToggled={handleServiceToggledFromModal}
                        onClose={() => setShowMicroservicesModal(false)}
                    />
                </ErrorBoundary>
            )}

            {data && (
                <>
                    {/* BARRA SUPERIOR DE ARQUITECTURA DISTRIBUIDA Y MICROSERVICIOS */}
                    <div className="mb-3 bg-neutral-900/90 border border-neutral-800 rounded-lg px-4 py-2.5 flex flex-wrap justify-between items-center gap-3 text-xs font-mono">
                        <div className="flex flex-wrap items-center gap-3">
                            <span className="px-2 py-1 rounded bg-blue-500/10 border border-blue-500/30 text-blue-300 font-bold">
                                CLIENTE: {clientId}
                            </span>

                            <span className="px-2 py-1 rounded bg-emerald-500/10 border border-emerald-500/30 text-emerald-300">
                                CLIENTES EN SALA:{' '}
                                <strong>{Math.max(activeClientsCount, tel.active_clients_count || 1)}</strong>
                            </span>

                            <span
                                className={`px-2 py-1 rounded border text-[10px] font-bold ${
                                    msHealthMap['ms-room-sync'] === false
                                        ? 'bg-red-500/15 border-red-500/40 text-red-300'
                                        : backendOnline
                                        ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-300'
                                        : 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                                }`}
                                title="Estado del microservicio ms-room-sync y el motor local a 20 Hz"
                            >
                                {msHealthMap['ms-room-sync'] === false
                                    ? 'ms-room-sync OFFLINE (FALLBACK LOCAL ACTIVO)'
                                    : backendOnline
                                    ? '20Hz SW + MICROSERVICES ONLINE'
                                    : '20Hz SW EDGE (LOCAL MESH)'}
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

                            {/* Control de Línea de Tiempo y Comparador de Relojes (Sala vs Cliente) */}
                            <div className="flex items-center gap-2 bg-neutral-950 border border-neutral-800 rounded px-2.5 py-1">
                                <span className="text-[10px] text-neutral-400">
                                    SALA: <strong className="text-emerald-400">T+{roomSyncTimeDisplay.toFixed(1)}s</strong>
                                </span>
                                {playbackMode === 'independent' && (
                                    <>
                                        <span className="text-neutral-600">|</span>
                                        <span className="text-[10px] text-purple-300">
                                            MÍO: <strong>T+{(tel.session_time_s ?? 15.0).toFixed(1)}s</strong>
                                        </span>
                                        <input
                                            type="range"
                                            min="15"
                                            max={Math.floor(engineRef.current?.durationSec || 649)}
                                            step="0.5"
                                            value={tel.session_time_s ?? 15}
                                            onChange={(e) => handleScrubIndependentTime(e.target.value)}
                                            className="w-24 accent-purple-500 cursor-pointer"
                                            title="Desplazar libremente mi línea de tiempo independiente sin afectar a la sala"
                                        />
                                    </>
                                )}
                            </div>
                        </div>

                        {/* Selectores de Múltiples Servidores + Panel de Microservicios */}
                        <div className="flex flex-wrap items-center gap-3">
                            <div className="flex items-center gap-1.5">
                                <span className="text-[10px] text-neutral-500 uppercase">API Server:</span>
                                <select
                                    value={selectedApiNodeUrl}
                                    onChange={(e) => setSelectedApiNodeUrl(e.target.value)}
                                    className="bg-neutral-950 border border-neutral-700 rounded px-2 py-1 text-[11px] text-blue-300 font-semibold"
                                >
                                    {apiNodes.map((node) => (
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
                                    {DATA_NODES.map((node) => (
                                        <option key={node.id} value={node.id}>
                                            {node.label}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <button
                                onClick={() => setShowMicroservicesModal(true)}
                                className={`px-2.5 py-1 rounded text-[10px] font-bold border transition cursor-pointer ${
                                    activeMsCount < totalMsCount
                                        ? 'bg-red-500/20 hover:bg-red-500/30 text-red-300 border-red-500/40 animate-pulse'
                                        : 'bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border-emerald-500/30'
                                }`}
                                title="Inspeccionar y simular caídas individuales en los 5 Microservicios Atómicos"
                            >
                                MICROSERVICIOS ({activeMsCount}/{totalMsCount})
                            </button>

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

                    {/* CABECERA CON INFORMACIÓN DE SESIÓN MULTIMEDIA Y CATÁLOGO .DUCKDB (ms-session-catalog) */}
                    <ErrorBoundary serviceName="ms-session-catalog Header">
                        <header className="mb-6 bg-neutral-900 border border-neutral-800 rounded-lg p-5 flex flex-col xl:flex-row justify-between items-center gap-6 shadow-md">
                            <div className="flex items-center gap-6 w-full xl:w-auto">
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

                                <div>
                                    <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-neutral-500 font-mono mb-1">
                                        <span>Piloto en Pista</span>
                                        <span>•</span>
                                        <span className="text-amber-400">
                                            {data.session.session_type || 'Practice'}
                                        </span>
                                        {tel.session_time_s !== undefined && (
                                            <>
                                                <span>•</span>
                                                <span className="text-neutral-300 font-bold">
                                                    T+{tel.session_time_s.toFixed(1)}s (
                                                    {playbackMode === 'sync' ? 'SYNC' : 'IND'})
                                                </span>
                                            </>
                                        )}
                                    </div>
                                    <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-white uppercase leading-none">
                                        {data.session.driver_name ||
                                            data.session.DriverName ||
                                            'PILOTO DESCONOCIDO'}
                                    </h1>
                                    <div className="flex flex-wrap items-center gap-2 mt-3 text-[10px] font-mono">
                                        <span className="text-red-400 bg-red-500/10 border border-red-500/30 px-2 py-1 rounded font-bold uppercase">
                                            MARCA: {data.session.car_brand || 'PORSCHE'}
                                        </span>

                                        <span className="text-blue-400 bg-blue-500/10 border border-blue-500/20 px-2 py-1 rounded">
                                            {data.session.car_name || data.session.CarName || 'DESCONOCIDO'}
                                            <span className="text-blue-500 ml-1">
                                                ({data.session.car_class || data.session.CarClass || 'N/A'})
                                            </span>
                                        </span>

                                        <span className="text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-1 rounded">
                                            TYRE: {tel.tyre_compound || 'Medium'}
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

                            <div className="flex flex-wrap items-center gap-4 self-start xl:self-center bg-neutral-950 p-3 rounded-lg border border-neutral-800 w-full xl:w-auto justify-between">
                                <div className="flex items-end gap-2">
                                    <div className="flex flex-col">
                                        <span className="text-[9px] text-neutral-500 font-mono uppercase">
                                            Sesión Telemetría (.duckdb) • ms-session-catalog
                                        </span>
                                        <select
                                            value={data.active_session_file || ''}
                                            onChange={handleSessionChange}
                                            className="bg-neutral-900 border border-neutral-800 rounded px-2 py-1.5 text-[11px] font-mono text-cyan-300 font-semibold max-w-[210px] truncate cursor-pointer"
                                            title={data.active_session_file || 'Seleccionar archivo .duckdb'}
                                        >
                                            {(
                                                data.available_sessions || [
                                                    data.active_session_file || 'sebring_session.duckdb',
                                                ]
                                            ).map((file) => (
                                                <option key={file} value={file}>
                                                    {file.replace(/\.duckdb$/i, '')}
                                                </option>
                                            ))}
                                        </select>
                                    </div>

                                    <input
                                        ref={fileInputRef}
                                        type="file"
                                        accept=".duckdb,.db"
                                        onChange={handleUploadDuckdbFile}
                                        className="hidden"
                                    />
                                    <button
                                        onClick={() => fileInputRef.current?.click()}
                                        disabled={Boolean(duckdbUploadStatus)}
                                        className="px-2.5 py-1.5 rounded text-[10px] font-mono font-bold bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-300 border border-cyan-500/40 transition cursor-pointer disabled:opacity-50"
                                        title="Seleccionar cualquier archivo .duckdb grabado por Le Mans Ultimate desde tu equipo (procesado con DuckDB-Wasm)"
                                    >
                                        {duckdbUploadStatus ? 'PROCESANDO...' : '+ CARGAR .DUCKDB'}
                                    </button>
                                </div>

                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={() => setShowSetupModal(true)}
                                        className={`px-2.5 py-1.5 rounded text-[10px] font-mono font-semibold border transition cursor-pointer ${
                                            msHealthMap['ms-car-setup'] === false
                                                ? 'bg-red-500/15 text-red-300 border-red-500/40'
                                                : 'bg-neutral-900 hover:bg-neutral-800 text-neutral-200 border-neutral-700'
                                        }`}
                                        title="Consultar microservicio atómico ms-car-setup"
                                    >
                                        {msHealthMap['ms-car-setup'] === false
                                            ? 'SETUP (OFFLINE 503)'
                                            : `SETUP (${Object.keys(data.setup || {}).length})`}
                                    </button>
                                    <button
                                        onClick={() => setIsPaused((p) => !p)}
                                        className={`px-2.5 py-1.5 rounded text-[10px] font-mono font-semibold border transition cursor-pointer ${
                                            isPaused
                                                ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                                                : 'bg-neutral-900 hover:bg-neutral-800 text-neutral-300 border-neutral-700'
                                        }`}
                                    >
                                        {isPaused ? 'REANUDAR' : 'PAUSAR'}
                                    </button>
                                    <button
                                        onClick={handleResetPlayback}
                                        className="px-2.5 py-1.5 rounded text-[10px] font-mono font-semibold bg-neutral-900 hover:bg-neutral-800 text-neutral-300 border border-neutral-700 transition cursor-pointer"
                                        title={
                                            playbackMode === 'sync'
                                                ? 'Reiniciar reloj sincronizado de la sala'
                                                : 'Reiniciar únicamente mi cursor independiente'
                                        }
                                    >
                                        REINICIAR {playbackMode === 'independent' ? '(MÍO)' : '(SALA)'}
                                    </button>
                                </div>

                                <div className="h-8 w-px bg-neutral-800 hidden md:block"></div>

                                <div className="flex items-center gap-3">
                                    <WeatherWidget
                                        condition={data.session.weather || data.session.WeatherConditions}
                                    />
                                    <div className="flex flex-col justify-center">
                                        <span className="text-[10px] text-neutral-500 font-mono tracking-wider">
                                            {data.session.weather || data.session.WeatherConditions || 'Óptimo'}
                                        </span>
                                        <div className="flex gap-2 text-xs font-mono text-neutral-300">
                                            <span>
                                                PISTA:{' '}
                                                <strong className="text-amber-400">
                                                    {(tel.track_temp_c || 0).toFixed(1)}°C
                                                </strong>
                                            </span>
                                            <span>
                                                AMB:{' '}
                                                <strong className="text-sky-400">
                                                    {(tel.ambient_temp_c || 0).toFixed(1)}°C
                                                </strong>
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                <div className="h-8 w-px bg-neutral-800 hidden md:block"></div>

                                <span
                                    className={`inline-flex items-center gap-2 py-1.5 px-3 rounded text-[10px] font-mono font-semibold border ${
                                        isPaused
                                            ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                                            : 'bg-green-500/10 text-green-400 border-green-500/20'
                                    }`}
                                >
                                    <span
                                        className={`w-1.5 h-1.5 rounded-full ${
                                            isPaused ? 'bg-amber-400' : 'bg-green-500 animate-ping'
                                        }`}
                                    ></span>
                                    {isPaused ? 'EN PAUSA' : 'TELEMETRÍA ACTIVA'}
                                </span>
                            </div>
                        </header>
                    </ErrorBoundary>

                    {/* GRID PRINCIPAL DEL MURO DE BOXES (12 Columnas Balanceadas: 3 + 5 + 4 = 12) */}
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                        {/* PANEL 1: UNIDAD DE POTENCIA, INPUTS, COMBUSTIBLE Y ELECTRÓNICA (3 Columnas) */}
                        <div className="lg:col-span-3">
                            <ErrorBoundary serviceName="Unidad de Potencia (ms-telemetry-pack)">
                                <div className="bg-neutral-900 rounded-lg p-5 border border-neutral-800 shadow-lg h-full flex flex-col justify-between gap-5">
                                    <div>
                                        <div className="flex justify-between items-center border-b border-neutral-800 pb-2">
                                            <h2 className="text-xs uppercase tracking-widest text-neutral-400 font-mono">
                                                Unidad de Potencia
                                            </h2>
                                            <span className="text-[10px] font-mono text-neutral-500">
                                                LAP {tel.current_lap ?? 0}
                                            </span>
                                        </div>

                                        <div className="mt-4 flex justify-between items-end">
                                            <div>
                                                <div className="text-5xl font-mono font-bold text-blue-400 tracking-tighter">
                                                    {(tel.speed_kmh || 0).toFixed(0)}
                                                    <span className="text-base text-neutral-500 ml-1.5 font-normal">
                                                        km/h
                                                    </span>
                                                </div>
                                                <div className="mt-2 text-xl font-mono text-neutral-200">
                                                    {(tel.rpm || 0).toFixed(0)}{' '}
                                                    <span className="text-xs text-neutral-500">
                                                        / {maxRpm.toFixed(0)} RPM
                                                    </span>
                                                </div>
                                            </div>
                                            <div className="flex flex-col items-end">
                                                <span className="text-[10px] font-mono uppercase text-neutral-500 mb-1">
                                                    Marcha
                                                </span>
                                                <span className="text-3xl font-mono font-bold text-yellow-400 bg-yellow-400/10 px-3.5 py-1.5 rounded border border-yellow-400/20">
                                                    {tel.gear === 0 ? 'N' : tel.gear === -1 ? 'R' : tel.gear}
                                                </span>
                                            </div>
                                        </div>

                                        <div className="mt-3 w-full h-2 bg-neutral-950 rounded-full overflow-hidden border border-neutral-800">
                                            <div
                                                className={`h-full transition-all duration-75 ${
                                                    rpmPercent > 90
                                                        ? 'bg-red-500'
                                                        : rpmPercent > 75
                                                        ? 'bg-purple-500'
                                                        : 'bg-blue-500'
                                                }`}
                                                style={{ width: `${rpmPercent}%` }}
                                            />
                                        </div>
                                    </div>

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
                                                            style={{
                                                                height: `${Math.min(100, Math.max(0, tel.brake_pos || 0))}%`,
                                                            }}
                                                        />
                                                    </div>
                                                    <span className="text-[9px] font-mono text-red-400">BRK</span>
                                                </div>
                                                <div className="flex flex-col items-center gap-1 h-full">
                                                    <div className="w-3 flex-1 bg-neutral-900 rounded overflow-hidden border border-neutral-800 flex items-end">
                                                        <div
                                                            className="w-full bg-emerald-400 transition-all duration-75"
                                                            style={{
                                                                height: `${Math.min(100, Math.max(0, tel.throttle_pos || 0))}%`,
                                                            }}
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
                                                    <circle
                                                        cx="32"
                                                        cy="32"
                                                        r="26"
                                                        fill="none"
                                                        stroke="currentColor"
                                                        strokeWidth="5"
                                                    />
                                                    <path
                                                        d="M8 32 H56 M32 32 V56"
                                                        stroke="currentColor"
                                                        strokeWidth="4"
                                                        strokeLinecap="round"
                                                    />
                                                    <rect x="29" y="3" width="6" height="6" rx="1" fill="#ef4444" />
                                                    <circle
                                                        cx="32"
                                                        cy="32"
                                                        r="6"
                                                        fill="#262626"
                                                        stroke="currentColor"
                                                        strokeWidth="2"
                                                    />
                                                </svg>
                                            </div>

                                            <div className="text-[10px] font-mono space-y-1 text-right">
                                                <div className="text-neutral-500">G-LAT</div>
                                                <div className="text-neutral-200 font-bold">
                                                    {(tel.g_force_lat || 0).toFixed(2)}G
                                                </div>
                                                <div className="text-neutral-500">G-LON</div>
                                                <div className="text-neutral-200 font-bold">
                                                    {(tel.g_force_long || 0).toFixed(2)}G
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-2 gap-2.5 text-xs font-mono">
                                        <div className="bg-neutral-950 rounded border border-neutral-800 p-2.5">
                                            <div className="text-[10px] text-neutral-500">FUEL LEVEL</div>
                                            <div className="text-lg font-bold text-amber-400 mt-0.5">
                                                {(tel.fuel_level_liters || 0).toFixed(2)}{' '}
                                                <span className="text-xs font-normal text-neutral-500">L</span>
                                            </div>
                                        </div>
                                        <div className="bg-neutral-950 rounded border border-neutral-800 p-2.5">
                                            <div className="text-[10px] text-neutral-500">VIRTUAL ENERGY</div>
                                            <div className="text-lg font-bold text-cyan-400 mt-0.5">
                                                {(tel.virtual_energy_pct || 0).toFixed(1)}{' '}
                                                <span className="text-xs font-normal text-neutral-500">%</span>
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

                                    <div className="pt-3 border-t border-neutral-800 grid grid-cols-3 gap-2 text-center font-mono">
                                        <div
                                            className={`rounded p-2 border ${
                                                tel.tc_active
                                                    ? 'bg-amber-500/20 border-amber-400 text-amber-300'
                                                    : 'bg-neutral-950 border-neutral-800 text-neutral-400'
                                            }`}
                                        >
                                            <div className="text-[9px] uppercase">TC (Lv.{tel.tc_level ?? 0})</div>
                                            <div className="text-xs font-bold mt-0.5">
                                                {tel.tc_active ? 'ACTIVO' : 'STBY'}
                                            </div>
                                        </div>
                                        <div
                                            className={`rounded p-2 border ${
                                                tel.abs_active
                                                    ? 'bg-red-500/20 border-red-400 text-red-300'
                                                    : 'bg-neutral-950 border-neutral-800 text-neutral-400'
                                            }`}
                                        >
                                            <div className="text-[9px] uppercase">ABS (Lv.{tel.abs_level ?? 0})</div>
                                            <div className="text-xs font-bold mt-0.5">
                                                {tel.abs_active ? 'ACTIVO' : 'STBY'}
                                            </div>
                                        </div>
                                        <div className="rounded p-2 border bg-neutral-950 border-neutral-800 text-neutral-300">
                                            <div className="text-[9px] uppercase text-neutral-500">BB REAR</div>
                                            <div className="text-xs font-bold mt-0.5">
                                                {(tel.brake_bias_rear || 50).toFixed(1)}%
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </ErrorBoundary>
                        </div>

                        {/* PANEL 2: ANÁLISIS DE TELEMETRÍA (Analysis Channels - 5 Columnas) */}
                        <div className="lg:col-span-5">
                            <ErrorBoundary serviceName="Analysis Channels (ms-telemetry-pack)">
                                <div className="bg-neutral-900 rounded-lg p-5 border border-neutral-800 shadow-lg h-full flex flex-col">
                                    <div className="flex justify-between items-center mb-4 border-b border-neutral-800 pb-2">
                                        <h2 className="text-xs uppercase tracking-widest text-neutral-400 font-mono">
                                            Analysis Channels
                                        </h2>
                                        <span className="text-[10px] font-mono text-neutral-500">
                                            Ventana: {telemetryHistory.length} muestras (20 Hz • 50 ms)
                                        </span>
                                    </div>

                                    <div className="flex-1 flex flex-col justify-between space-y-4">
                                        <div className="h-24 relative">
                                            <div className="absolute top-0 left-0 text-[10px] text-neutral-500 font-mono z-10 flex justify-between w-full pr-2">
                                                <span>Throttle</span>
                                                <span className="text-emerald-400 font-bold">
                                                    {(tel.throttle_pos || 0).toFixed(1)} %
                                                </span>
                                            </div>
                                            <ResponsiveContainer width="100%" height="100%">
                                                <LineChart data={telemetryHistory}>
                                                    <YAxis domain={[0, 100]} hide />
                                                    <Line
                                                        type="monotone"
                                                        dataKey="throttle_pos"
                                                        stroke="#0efa35"
                                                        strokeWidth={1.5}
                                                        dot={false}
                                                        isAnimationActive={false}
                                                    />
                                                </LineChart>
                                            </ResponsiveContainer>
                                        </div>

                                        <div className="h-24 relative border-t border-neutral-800/50 pt-2">
                                            <div className="absolute top-2 left-0 text-[10px] text-neutral-500 font-mono z-10 flex justify-between w-full pr-2">
                                                <span>Brake</span>
                                                <span className="text-red-400 font-bold">
                                                    {(tel.brake_pos || 0).toFixed(1)} %
                                                </span>
                                            </div>
                                            <ResponsiveContainer width="100%" height="100%">
                                                <LineChart data={telemetryHistory}>
                                                    <YAxis domain={[0, 100]} hide />
                                                    <Line
                                                        type="monotone"
                                                        dataKey="brake_pos"
                                                        stroke="#fc0303"
                                                        strokeWidth={1.5}
                                                        dot={false}
                                                        isAnimationActive={false}
                                                    />
                                                </LineChart>
                                            </ResponsiveContainer>
                                        </div>

                                        <div className="h-24 relative border-t border-neutral-800/50 pt-2">
                                            <div className="absolute top-2 left-0 text-[10px] text-neutral-500 font-mono z-10 flex justify-between w-full pr-2">
                                                <span>RPM</span>
                                                <span className="text-purple-400 font-bold">
                                                    {(tel.rpm || 0).toFixed(0)} rpm
                                                </span>
                                            </div>
                                            <ResponsiveContainer width="100%" height="100%">
                                                <LineChart data={telemetryHistory}>
                                                    <YAxis domain={['auto', 'auto']} hide />
                                                    <Line
                                                        type="monotone"
                                                        dataKey="rpm"
                                                        stroke="#a855f7"
                                                        strokeWidth={1.5}
                                                        dot={false}
                                                        isAnimationActive={false}
                                                    />
                                                </LineChart>
                                            </ResponsiveContainer>
                                        </div>

                                        <div className="h-24 relative border-t border-neutral-800/50 pt-2">
                                            <div className="absolute top-2 left-0 text-[10px] text-neutral-500 font-mono z-10 flex justify-between w-full pr-2">
                                                <span>Steering</span>
                                                <span className="text-neutral-200 font-bold">
                                                    {(tel.steering_pos || 0).toFixed(1)} %
                                                </span>
                                            </div>
                                            <ResponsiveContainer width="100%" height="100%">
                                                <LineChart data={telemetryHistory}>
                                                    <YAxis domain={['auto', 'auto']} hide />
                                                    <Line
                                                        type="monotone"
                                                        dataKey="steering_pos"
                                                        stroke="#ffffff"
                                                        strokeWidth={1.5}
                                                        dot={false}
                                                        isAnimationActive={false}
                                                    />
                                                </LineChart>
                                            </ResponsiveContainer>
                                        </div>

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
                            </ErrorBoundary>
                        </div>

                        {/* PANEL 3: MAPA DEL CIRCUITO (ms-track-map) + NEUMÁTICOS Y FRENOS (4 Columnas) */}
                        <div className="lg:col-span-4 flex flex-col gap-6">
                            {/* SUBPANEL 3A: MICROSERVICIO ATÓMICO DE MAPA GPS (ms-track-map) */}
                            <ErrorBoundary serviceName="ms-track-map Widget">
                                <TrackMapWidget
                                    apiBaseUrl={selectedApiNodeUrl}
                                    activeSessionFile={data.active_session_file}
                                    trackName={data.session.track_name || data.session.TrackName}
                                    currentLat={currentLat}
                                    currentLon={currentLon}
                                    fallbackCoords={trackCoords}
                                    msRefreshToken={msRefreshToken}
                                    onMicroserviceStatusChange={handleMicroserviceStatusChange}
                                />
                            </ErrorBoundary>

                            {/* SUBPANEL 3B: TEMPERATURAS, PRESIONES Y DESGASTE DE LAS 4 RUEDAS */}
                            <ErrorBoundary serviceName="Neumáticos & Frenos Widget">
                                <div className="bg-neutral-900 rounded-lg p-5 border border-neutral-800 shadow-lg flex-1 flex flex-col justify-between">
                                    <div className="flex justify-between items-center mb-3 border-b border-neutral-800 pb-2">
                                        <h2 className="text-xs uppercase tracking-widest text-neutral-400 font-mono">
                                            Neumáticos & Frenos
                                        </h2>
                                        <span className="text-[10px] font-mono text-emerald-400">
                                            Compuesto: {tel.tyre_compound || 'Medium'}
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
                            </ErrorBoundary>
                        </div>

                        {/* PANEL 4: CRONOMETRAJE Y SECTORES (12 Columnas) */}
                        <div className="lg:col-span-12">
                            <ErrorBoundary serviceName="Cronometraje y Sectores">
                                <div className="bg-neutral-900 rounded-lg p-5 border border-neutral-800 shadow-lg flex flex-col md:flex-row gap-6">
                                    <div className="flex-1 flex flex-col justify-center border-b md:border-b-0 md:border-r border-neutral-800 pb-4 md:pb-0 pr-0 md:pr-4">
                                        <div className="flex justify-between items-center mb-2">
                                            <h2 className="text-xs uppercase tracking-widest text-neutral-400 font-mono">
                                                Vuelta Actual
                                            </h2>
                                            <span className="text-xs font-mono text-blue-400 bg-blue-500/10 border border-blue-500/20 px-2 py-0.5 rounded">
                                                VUELTA #{tel.current_lap ?? 0}
                                            </span>
                                        </div>
                                        <div className="text-5xl font-mono font-bold text-white tracking-tighter">
                                            {formatTime(tel.current_lap_time)}
                                        </div>
                                        <div className="text-xs font-mono text-neutral-500 mt-2 flex items-center gap-3">
                                            <span>
                                                SECTOR ACTIVO:{' '}
                                                <strong className="text-yellow-400">S{activeSector}</strong>
                                            </span>
                                            <div className="flex gap-1">
                                                {[1, 2, 3].map((s) => (
                                                    <span
                                                        key={s}
                                                        className={`px-1.5 py-0.5 rounded text-[10px] ${
                                                            activeSector === s
                                                                ? 'bg-yellow-400/20 text-yellow-300 border border-yellow-400/40 font-bold'
                                                                : 'bg-neutral-950 text-neutral-600 border border-neutral-800'
                                                        }`}
                                                    >
                                                        S{s}
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                    </div>

                                    <div className="flex-1 flex flex-col justify-center border-b md:border-b-0 md:border-r border-neutral-800 pb-4 md:pb-0 px-0 md:px-4">
                                        <div className="flex justify-between items-end mb-2">
                                            <h2 className="text-xs uppercase tracking-widest text-neutral-400 font-mono">
                                                Última Vuelta
                                            </h2>
                                            <span className="text-xl font-mono text-neutral-300">
                                                {formatTime(tel.last_lap_time)}
                                            </span>
                                        </div>
                                        <div className="grid grid-cols-3 gap-2">
                                            <div className="bg-neutral-950 rounded p-2 border border-neutral-800">
                                                <div className="text-[10px] text-neutral-500 font-mono mb-1">S1</div>
                                                <div className="font-mono text-sm text-neutral-300">
                                                    {tel.last_sector_1 > 0 ? tel.last_sector_1.toFixed(3) : '0.000'}
                                                </div>
                                            </div>
                                            <div className="bg-neutral-950 rounded p-2 border border-neutral-800">
                                                <div className="text-[10px] text-neutral-500 font-mono mb-1">S2</div>
                                                <div className="font-mono text-sm text-neutral-300">
                                                    {tel.last_sector_2 > 0
                                                        ? Math.max(0, tel.last_sector_2 - tel.last_sector_1).toFixed(3)
                                                        : '0.000'}
                                                </div>
                                            </div>
                                            <div className="bg-neutral-950 rounded p-2 border border-neutral-800">
                                                <div className="text-[10px] text-neutral-500 font-mono mb-1">S3</div>
                                                <div className="font-mono text-sm text-neutral-300">
                                                    {tel.last_lap_time > 0 && tel.last_sector_2 > 0
                                                        ? Math.max(0, tel.last_lap_time - tel.last_sector_2).toFixed(3)
                                                        : '0.000'}
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="flex-1 flex flex-col justify-center pl-0 md:pl-4">
                                        <div className="flex justify-between items-end mb-2">
                                            <h2 className="text-xs uppercase tracking-widest text-neutral-400 font-mono">
                                                Mejor Vuelta
                                            </h2>
                                            <span className="text-xl font-mono text-purple-400 font-bold">
                                                {formatTime(tel.best_lap_time)}
                                            </span>
                                        </div>
                                        <div className="grid grid-cols-3 gap-2">
                                            <div className="bg-neutral-950 rounded p-2 border border-purple-500/30">
                                                <div className="text-[10px] text-purple-400/70 font-mono mb-1">S1</div>
                                                <div className="font-mono text-sm text-purple-300">
                                                    {tel.best_sector_1 > 0 ? tel.best_sector_1.toFixed(3) : '0.000'}
                                                </div>
                                            </div>
                                            <div className="bg-neutral-950 rounded p-2 border border-purple-500/30">
                                                <div className="text-[10px] text-purple-400/70 font-mono mb-1">S2</div>
                                                <div className="font-mono text-sm text-purple-300">
                                                    {tel.best_sector_2 > 0
                                                        ? Math.max(0, tel.best_sector_2 - tel.best_sector_1).toFixed(3)
                                                        : '0.000'}
                                                </div>
                                            </div>
                                            <div className="bg-neutral-950 rounded p-2 border border-purple-500/30">
                                                <div className="text-[10px] text-purple-400/70 font-mono mb-1">S3</div>
                                                <div className="font-mono text-sm text-purple-300">
                                                    {tel.best_lap_time > 0 && tel.best_sector_2 > 0
                                                        ? Math.max(0, tel.best_lap_time - tel.best_sector_2).toFixed(3)
                                                        : '0.000'}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </ErrorBoundary>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}
