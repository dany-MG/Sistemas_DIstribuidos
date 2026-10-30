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

export const getClientId = (): string => {
    if (typeof window === 'undefined') return 'ssr-client';
    let cid = window.sessionStorage.getItem('lmu_paddock_client_id');
    if (!cid) {
        const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
        cid = `PIT-${rand}`;
        window.sessionStorage.setItem('lmu_paddock_client_id', cid);
    }
    return cid;
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
): Promise<{ packData: any; source: 'sw_local_edge' | 'remote_server' }> => {
    // 1. Carga inmediata desde el Service Worker / Edge CDN de Vercel (0 espera de cold start)
    try {
        const localResp = await fetch('/data/sebring_session_pack.json');
        if (localResp.ok) {
            const packData = await localResp.json();
            // Despertamos a Render en segundo plano sin bloquear la UI
            fetchWithFailover(`/health`, preferredBaseUrl, 15000).catch(() => {});
            return { packData, source: 'sw_local_edge' };
        }
    } catch {
        // Si no existe localmente, consultamos al servidor remoto
    }

    // 2. Consulta al servidor remoto
    const params = new URLSearchParams({ step_hz: '5', data_node: dataNode });
    const remoteRes = await fetchWithFailover(`/session-pack?${params.toString()}`, preferredBaseUrl, 8000);
    if (remoteRes?.data) {
        return { packData: remoteRes.data, source: 'remote_server' };
    }

    return { packData: null, source: 'sw_local_edge' };
};

export const fetchRemoteSessionPack = async (
    preferredBaseUrl: string = API_NODES[0].baseUrl,
    dataNode: string = 'auto'
) => {
    const params = new URLSearchParams({ step_hz: '5', data_node: dataNode });
    const res = await fetchWithFailover(`/session-pack?${params.toString()}`, preferredBaseUrl, 10000);
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
    durationSec: number,
    dataNode: string = 'auto'
) => {
    const params = new URLSearchParams({
        client_id: clientId,
        mode,
        cursor_s: cursorSec.toFixed(2),
        duration_s: durationSec.toFixed(2),
        data_node: dataNode,
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
