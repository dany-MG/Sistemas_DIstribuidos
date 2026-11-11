export const DEFAULT_BACKEND_ORIGIN = (
    import.meta.env.PUBLIC_BACKEND_URL || 'https://lmu-paddock-dashboard.onrender.com'
).replace(/\/+$/, '');

const resolveDefaultBaseUrl = (
    port: number,
    gatewayPrefix: 'node1' | 'node2',
    envNodeUrl?: string
): string => {
    if (envNodeUrl && envNodeUrl.trim() !== '') {
        return envNodeUrl.replace(/\/+$/, '');
    }
    if (import.meta.env.PUBLIC_BACKEND_URL && import.meta.env.PUBLIC_BACKEND_URL.trim() !== '') {
        return `${DEFAULT_BACKEND_ORIGIN}/${gatewayPrefix}/api/v1`;
    }
    if (typeof window !== 'undefined' && window.location) {
        const host = window.location.hostname;
        const isLocal = host === 'localhost' || host === '127.0.0.1';
        if (isLocal && window.location.port === '4321') {
            return `http://${host}:${port}/api/v1`;
        }
        if (isLocal && window.location.port === '8080') {
            return `${window.location.origin}/${gatewayPrefix}/api/v1`;
        }
        // En Vercel o cualquier dominio público, apuntamos al backend de Render
        return `${DEFAULT_BACKEND_ORIGIN}/${gatewayPrefix}/api/v1`;
    }
    return `${DEFAULT_BACKEND_ORIGIN}/${gatewayPrefix}/api/v1`;
};

export const getApiNodes = () => [
    {
        id: 'api-node-1',
        label: 'API Node 1 (Primary)',
        baseUrl: resolveDefaultBaseUrl(8000, 'node1', import.meta.env.PUBLIC_API_NODE_1_URL),
    },
    {
        id: 'api-node-2',
        label: 'API Node 2 (Replica)',
        baseUrl: resolveDefaultBaseUrl(8001, 'node2', import.meta.env.PUBLIC_API_NODE_2_URL),
    },
];

export const API_NODES = getApiNodes();

export const DATA_NODES = [
    { id: 'auto', label: 'Auto Balance (Round-Robin)' },
    { id: 'data-node-1', label: 'DuckDB Node 1 (:8011)' },
    { id: 'data-node-2', label: 'DuckDB Node 2 (:8012)' },
];

export const registerTelemetryServiceWorker = async (): Promise<boolean> => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
        return false;
    }
    try {
        const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
        return Boolean(reg);
    } catch (err) {
        console.warn('Service Worker no pudo registrarse:', err);
        return false;
    }
};

let _inMemoryClientId: string | null = null;

export const getClientId = (): string => {
    if (typeof window === 'undefined') return 'ssr-client';
    if (_inMemoryClientId) return _inMemoryClientId;

    // Usamos window.name para que al recargar la misma pestaña conserve su ID,
    // pero si el usuario duplica la pestaña o abre una nueva, reciba un ID único garantizado.
    if (window.name && /^PIT-[A-Z0-9]{4}$/.test(window.name)) {
        _inMemoryClientId = window.name;
    } else {
        const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
        _inMemoryClientId = `PIT-${rand}`;
        try {
            window.name = _inMemoryClientId;
        } catch {
            // Ignoramos si el navegador restringe window.name
        }
    }
    return _inMemoryClientId;
};

export const generateNewClientId = (): string => {
    const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
    _inMemoryClientId = `PIT-${rand}`;
    if (typeof window !== 'undefined') {
        try {
            window.name = _inMemoryClientId;
        } catch {}
    }
    return _inMemoryClientId;
};

const BRAND_SLUG_RULES: Array<[string, string]> = [
    ['porsche', 'porsche'],
    ['proton', 'porsche'],
    ['manthey', 'porsche'],
    ['penske', 'porsche'],
    ['jota', 'porsche'],
    ['iron dames', 'porsche'],
    ['ferrari', 'ferrari'],
    ['af corse', 'ferrari'],
    ['vista', 'ferrari'],
    ['bmw', 'bmw'],
    ['wrt', 'bmw'],
    ['corvette', 'corvette'],
    ['tf sport', 'corvette'],
    ['mclaren', 'mclaren'],
    ['united autosports', 'mclaren'],
    ['aston', 'aston_martin'],
    ['heart of racing', 'aston_martin'],
    ["d'station", 'aston_martin'],
    ['lamborghini', 'lamborghini'],
    ['iron lynx', 'lamborghini'],
    ['toyota', 'toyota'],
    ['gazoo', 'toyota'],
    ['cadillac', 'cadillac'],
    ['ganassi', 'cadillac'],
    ['peugeot', 'peugeot'],
    ['alpine', 'alpine'],
    ['ford', 'ford'],
    ['mustang', 'ford'],
    ['mercedes', 'mercedes'],
    ['amg', 'mercedes'],
    ['genesis', 'genesis'],
    ['lexus', 'lexus'],
    ['akkodis', 'lexus'],
    ['lmp2', 'lmp2'],
    ['oreca', 'lmp2'],
];

export const detectCarBrandSlug = (
    carName?: string,
    carBrand?: string,
    carClass?: string
): string => {
    const classLower = (carClass || '').toLowerCase();
    const isHypercar =
        classLower.includes('hyp') ||
        classLower.includes('lmh') ||
        classLower.includes('lmdh') ||
        classLower.includes('gtp');

    if (classLower.includes('lmp2')) {
        return 'lmp2';
    }

    const haystack = `${carBrand || ''} ${carName || ''}`.toLowerCase();
    let baseSlug = 'porsche';
    for (const [keyword, slug] of BRAND_SLUG_RULES) {
        if (haystack.includes(keyword)) {
            baseSlug = slug;
            break;
        }
    }

    if (baseSlug === 'ferrari') {
        return isHypercar ? 'ferrari_hyp' : 'ferrari_gt3';
    }
    if (baseSlug === 'bmw') {
        return isHypercar ? 'bmw_hyp' : 'bmw_gt3';
    }
    if (baseSlug === 'aston_martin') {
        return isHypercar ? 'aston_martin_hyp' : 'aston_martin';
    }
    if (baseSlug === 'genesis') {
        return 'genesis_hyp';
    }
    if (baseSlug === 'lamborghini') {
        return 'porsche';
    }

    return baseSlug;
};

export const getCarImageUrl = (
    carName?: string,
    carBrand?: string,
    carClass?: string
): string => {
    const slug = detectCarBrandSlug(carName, carBrand, carClass);
    return `/cars/${slug}.webp`;
};

/**
 * Normaliza la categoría oficial de Le Mans Ultimate (WEC / ELMS):
 * Devuelve siempre una de: 'LMGT3' | 'GTE' | 'LMP2' | 'LMP2 ELMS' | 'LMP3' | 'HY'
 */
export const resolveCarCategory = (carClass?: string, carName?: string): string => {
    const cls = (carClass || '').trim().toUpperCase();
    const name = (carName || '').trim().toUpperCase();
    const combined = `${cls} ${name}`;

    if (
        cls.includes('LMP3') ||
        name.includes('LMP3') ||
        name.includes('P320') ||
        name.includes('DUQUEINE') ||
        name.includes('GINETTA G61')
    ) {
        return 'LMP3';
    }

    if (cls.includes('LMP2') || name.includes('ORECA 07') || name.includes('LMP2')) {
        if (cls.includes('ELMS') || name.includes(':ELMS') || name.includes(' ELMS')) {
            return 'LMP2 ELMS';
        }
        return 'LMP2';
    }

    if (cls.includes('GTE') || name.includes('GTE') || name.includes('RSR-19')) {
        return 'GTE';
    }

    if (
        cls === 'HY' ||
        cls.includes('HYPER') ||
        cls.includes('LMH') ||
        cls.includes('LMDH') ||
        cls.includes('GTP') ||
        combined.includes('499P') ||
        combined.includes('963') ||
        combined.includes('GR010') ||
        combined.includes('9X8') ||
        combined.includes('V-SERIES') ||
        combined.includes('A424') ||
        combined.includes('SC63') ||
        combined.includes('M HYBRID') ||
        combined.includes('VALKYRIE') ||
        combined.includes('GMR-001')
    ) {
        return 'HY';
    }

    if (cls.includes('GT3') || cls.includes('LMGT3')) {
        return 'LMGT3';
    }

    return 'LMGT3';
};

async function fetchWithTimeout(url: string, timeoutMs: number = 2500, options?: RequestInit) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const resp = await fetch(url, { ...options, signal: controller.signal });
        clearTimeout(id);
        return resp;
    } catch (err) {
        clearTimeout(id);
        throw err;
    }
}

async function fetchWithFailover(
    path: string,
    preferredBaseUrl: string,
    timeoutMs: number = 2500,
    options?: RequestInit
): Promise<{ data: any; activeBaseUrl: string } | null> {
    const dynamicNodes = getApiNodes();
    const candidates = [
        preferredBaseUrl,
        ...dynamicNodes.map(n => n.baseUrl).filter(u => u !== preferredBaseUrl),
    ];

    for (const baseUrl of candidates) {
        try {
            const response = await fetchWithTimeout(`${baseUrl}${path}`, timeoutMs, options);
            if (response.ok) {
                const data = await response.json();
                return { data, activeBaseUrl: baseUrl };
            }
        } catch {
            // Intentamos con el siguiente servidor del clúster
        }
    }
    return null;
}

export interface MicroserviceResponse<T = any> {
    ok: boolean;
    status: number;
    data: T | null;
    error: string | null;
    msId: string;
}

/**
 * Cliente HTTP con aislamiento de fallos (Circuit Breaker / Bulkhead) para Microservicios:
 * - Si un microservicio responde HTTP 503 (caída simulada o real), detiene inmediatamente
 *   los reintentos y retorna { ok: false, status: 503 } sin afectar a los demás microservicios.
 */
async function fetchMicroserviceIsolated<T = any>(
    msId: string,
    msSubPath: string,
    preferredBaseUrl: string = API_NODES[0].baseUrl,
    timeoutMs: number = 3000,
    options?: RequestInit
): Promise<MicroserviceResponse<T>> {
    const dynamicNodes = getApiNodes();
    const candidates = [
        preferredBaseUrl,
        ...dynamicNodes.map(n => n.baseUrl).filter(u => u !== preferredBaseUrl),
    ];

    let lastStatus = 0;
    let lastError = `Sin respuesta del microservicio ${msId}`;

    for (const baseUrl of candidates) {
        try {
            const response = await fetchWithTimeout(`${baseUrl}/ms/${msId.replace(/^ms-/, '')}${msSubPath}`, timeoutMs, options);
            lastStatus = response.status;

            if (response.status === 503) {
                let errDetail = `Microservicio ${msId} fuera de línea (503 Service Unavailable)`;
                try {
                    const errBody = await response.json();
                    if (errBody?.detail?.message) {
                        errDetail = errBody.detail.message;
                    }
                } catch {}
                return {
                    ok: false,
                    status: 503,
                    data: null,
                    error: errDetail,
                    msId,
                };
            }

            if (response.ok) {
                const data = (await response.json()) as T;
                return {
                    ok: true,
                    status: response.status,
                    data,
                    error: null,
                    msId,
                };
            }
        } catch (err: any) {
            lastError = err?.message || `Timeout contactando ${msId}`;
        }
    }

    return {
        ok: false,
        status: lastStatus || 0,
        data: null,
        error: lastError,
        msId,
    };
}

/**
 * Microservicio 1: ms-track-map (Cartografía GPS y Proyección SVG)
 */
export const fetchTrackMapFromMs = async (
    apiBaseUrl: string = API_NODES[0].baseUrl
): Promise<MicroserviceResponse<any>> => {
    return fetchMicroserviceIsolated('ms-track-map', '/map', apiBaseUrl, 3500);
};

/**
 * Microservicio 2: ms-car-setup (Ingeniería Mecánica y Parámetros de Setup)
 */
export const fetchCarSetupFromMs = async (
    apiBaseUrl: string = API_NODES[0].baseUrl,
    searchQuery: string = ''
): Promise<MicroserviceResponse<any>> => {
    const qs = searchQuery ? `?search=${encodeURIComponent(searchQuery)}` : '';
    return fetchMicroserviceIsolated('ms-car-setup', `/setup${qs}`, apiBaseUrl, 3500);
};

/**
 * Microservicio 3: ms-session-catalog (Catálogo de Sesiones .duckdb y Metadatos)
 */
export const fetchSessionMetadataFromMs = async (
    apiBaseUrl: string = API_NODES[0].baseUrl
): Promise<MicroserviceResponse<any>> => {
    return fetchMicroserviceIsolated('ms-session-catalog', '/metadata', apiBaseUrl, 3500);
};

/**
 * Estado global y control de fallos de los 5 Microservicios Atómicos
 */
export const fetchMicroservicesStatus = async (
    apiBaseUrl: string = API_NODES[0].baseUrl
) => {
    const res = await fetchWithFailover('/microservices/status', apiBaseUrl, 3000);
    return res ? res.data : null;
};

export const toggleMicroserviceState = async (
    msId: string,
    enabled?: boolean,
    apiBaseUrl: string = API_NODES[0].baseUrl
) => {
    const qs = typeof enabled === 'boolean' ? `?enabled=${enabled}` : '';
    const res = await fetchWithFailover(
        `/microservices/${encodeURIComponent(msId)}/toggle${qs}`,
        apiBaseUrl,
        3000,
        { method: 'POST' }
    );
    return res ? res.data : null;
};

/**
 * Carga el paquete vectorizado de la sesión:
 * 1. Primero carga instantáneamente desde el paquete local/Service Worker (/data/sebring_session_pack.json)
 *    para que el Dashboard en Vercel se renderice en < 50 ms sin esperar a que Render despierte.
 * 2. En segundo plano, despierta al servidor de Render y sincroniza si hay otra sesión seleccionada.
 */
export const loadInitialSessionPackFast = async (
    preferredBaseUrl: string = API_NODES[0].baseUrl,
    dataNode: string = 'auto'
): Promise<any> => {
    // 1. Carga inmediata desde el Service Worker / Edge CDN de Vercel (0 espera de cold start)
    try {
        const localResp = await fetch('/data/sebring_session_pack.json');
        if (localResp.ok) {
            const packData = await localResp.json();
            // Despertamos a Render en segundo plano sin bloquear la UI
            fetchWithFailover(`/health`, preferredBaseUrl, 15000).catch(() => {});
            return { ...packData, _source: 'sw_local_edge' };
        }
    } catch {
        // Si no existe localmente, consultamos al microservicio remoto
    }

    // 2. Consulta al microservicio ms-telemetry-pack a 20 Hz
    const params = new URLSearchParams({ step_hz: '20', data_node: dataNode });
    const msRes = await fetchMicroserviceIsolated(
        'ms-telemetry-pack',
        `/pack?${params.toString()}`,
        preferredBaseUrl,
        8000
    );
    if (msRes.ok && msRes.data) {
        return { ...msRes.data, _source: 'remote_server' };
    }

    return null;
};

export const fetchRemoteSessionPack = async (
    preferredBaseUrl: string = API_NODES[0].baseUrl,
    dataNode: string = 'auto',
    sessionName: string = ''
) => {
    const params = new URLSearchParams({ step_hz: '20', data_node: dataNode });
    if (sessionName) {
        params.set('session', sessionName);
    }
    const msRes = await fetchMicroserviceIsolated(
        'ms-telemetry-pack',
        `/pack?${params.toString()}`,
        preferredBaseUrl,
        10000
    );
    return msRes.ok ? msRes.data : null;
};

export const registerSessionPackOnServer = async (
    filename: string,
    packPayload: any,
    apiBaseUrl: string = API_NODES[0].baseUrl
) => {
    const msRes = await fetchMicroserviceIsolated(
        'ms-session-catalog',
        '/register-pack',
        apiBaseUrl,
        8000,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                filename,
                pack_payload: packPayload,
            }),
        }
    );
    return msRes.ok ? msRes.data : null;
};

export const uploadRawDuckdbFileToServer = async (
    file: File,
    apiBaseUrl: string = API_NODES[0].baseUrl
) => {
    const params = new URLSearchParams({ filename: file.name });
    const msRes = await fetchMicroserviceIsolated(
        'ms-session-catalog',
        `/upload?${params.toString()}`,
        apiBaseUrl,
        25000,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/octet-stream' },
            body: file,
        }
    );
    return msRes.ok ? msRes.data : null;
};

/**
 * Sincronización ultraligera con el microservicio ms-room-sync (~150 bytes, 0% uso de DuckDB).
 * Si ms-room-sync cae (503) o Render sigue despertando, devuelve { __ms_offline: true } o null
 * sin afectar el procesamiento de telemetría a 20 Hz en el cliente.
 */
export const syncClientStateWithServer = async (
    apiBaseUrl: string,
    clientId: string,
    mode: 'sync' | 'independent',
    cursorSec: number,
    dataNodeOrDuration: string | number = 'auto',
    durationSec: number = 649.5
) => {
    const resolvedDataNode =
        typeof dataNodeOrDuration === 'string' ? dataNodeOrDuration : 'auto';
    const resolvedDuration =
        typeof dataNodeOrDuration === 'number' ? dataNodeOrDuration : durationSec;

    const params = new URLSearchParams({
        client_id: clientId,
        mode,
        cursor_s: Number(cursorSec || 15.0).toFixed(2),
        duration_s: Number(resolvedDuration || 649.5).toFixed(2),
        data_node: resolvedDataNode,
    });
    const msRes = await fetchMicroserviceIsolated(
        'ms-room-sync',
        `/state?${params.toString()}`,
        apiBaseUrl,
        2200,
        { method: 'POST' }
    );
    if (msRes.status === 503) {
        return { __ms_offline: true, ms_id: 'ms-room-sync', error: msRes.error };
    }
    return msRes.ok ? msRes.data : null;
};

export const fetchClusterStatus = async (apiBaseUrl: string = API_NODES[0].baseUrl) => {
    const res = await fetchWithFailover('/cluster/status', apiBaseUrl, 3000);
    return res ? res.data : null;
};

export const resetPlayback = async (
    apiBaseUrl: string = API_NODES[0].baseUrl,
    clientId: string = 'default-client',
    mode: 'sync' | 'independent' = 'sync'
) => {
    const params = new URLSearchParams({ client_id: clientId, mode });
    const msRes = await fetchMicroserviceIsolated(
        'ms-room-sync',
        `/reset?${params.toString()}`,
        apiBaseUrl,
        2500,
        { method: 'POST' }
    );
    return msRes.ok ? msRes.data : null;
};

export const switchSession = async (
    filename: string,
    apiBaseUrl: string = API_NODES[0].baseUrl
) => {
    const msRes = await fetchMicroserviceIsolated(
        'ms-session-catalog',
        `/switch/${encodeURIComponent(filename)}`,
        apiBaseUrl,
        4000,
        { method: 'POST' }
    );
    return msRes.ok ? msRes.data : null;
};
