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
        // Si no existe localmente, consultamos al servidor remoto
    }

    // 2. Consulta al servidor remoto a 20 Hz
    const params = new URLSearchParams({ step_hz: '20', data_node: dataNode });
    const remoteRes = await fetchWithFailover(`/session-pack?${params.toString()}`, preferredBaseUrl, 8000);
    if (remoteRes?.data) {
        return { ...remoteRes.data, _source: 'remote_server' };
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
    const res = await fetchWithFailover(`/session-pack?${params.toString()}`, preferredBaseUrl, 10000);
    return res ? res.data : null;
};

export const registerSessionPackOnServer = async (
    filename: string,
    packPayload: any,
    apiBaseUrl: string = API_NODES[0].baseUrl
) => {
    const res = await fetchWithFailover(`/sessions/register-pack`, apiBaseUrl, 8000, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            filename,
            pack_payload: packPayload,
        }),
    });
    return res ? res.data : null;
};

export const uploadRawDuckdbFileToServer = async (
    file: File,
    apiBaseUrl: string = API_NODES[0].baseUrl
) => {
    const params = new URLSearchParams({ filename: file.name });
    const res = await fetchWithFailover(`/sessions/upload?${params.toString()}`, apiBaseUrl, 25000, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: file,
    });
    return res ? res.data : null;
};

/**
 * Sincronización ultraligera con el servidor en Render (~150 bytes, 0% uso de DuckDB).
 * Si Render sigue despertando (cold start), devuelve null sin afectar el procesamiento en el cliente.
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
    const res = await fetchWithFailover(`/sync-state?${params.toString()}`, apiBaseUrl, 2200, {
        method: 'POST',
    });
    return res ? res.data : null;
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
    const res = await fetchWithFailover(`/playback/reset?${params.toString()}`, apiBaseUrl, 2500, {
        method: 'POST',
    });
    return res ? res.data : null;
};

export const switchSession = async (
    filename: string,
    apiBaseUrl: string = API_NODES[0].baseUrl
) => {
    const res = await fetchWithFailover(
        `/sessions/${encodeURIComponent(filename)}`,
        apiBaseUrl,
        4000,
        { method: 'POST' }
    );
    return res ? res.data : null;
};
