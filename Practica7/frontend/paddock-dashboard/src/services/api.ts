const resolveDefaultBaseUrl = (
    port: number,
    gatewayPrefix: 'node1' | 'node2',
    envUrl?: string
): string => {
    if (envUrl && envUrl.trim() !== '') {
        return envUrl.replace(/\/+$/, '');
    }
    if (typeof window !== 'undefined' && window.location) {
        // Si entramos desde una URL web pública (HTTPS, Render, Railway, Túnel) o desde el Gateway (:8080),
        // enrutamos sobre el mismo origen (/node1/api/v1 y /node2/api/v1) sin depender de puertos externos
        if (window.location.port !== '4321') {
            return `${window.location.origin}/${gatewayPrefix}/api/v1`;
        }
        return `${window.location.protocol}//${window.location.hostname}:${port}/api/v1`;
    }
    return `http://localhost:${port}/api/v1`;
};

export const getApiNodes = () => [
    {
        id: 'api-node-1',
        label: 'API Node 1 (:8000)',
        baseUrl: resolveDefaultBaseUrl(8000, 'node1', import.meta.env.PUBLIC_API_NODE_1_URL),
    },
    {
        id: 'api-node-2',
        label: 'API Node 2 (:8001)',
        baseUrl: resolveDefaultBaseUrl(8001, 'node2', import.meta.env.PUBLIC_API_NODE_2_URL),
    },
];

export const API_NODES = getApiNodes();

export const DATA_NODES = [
    { id: 'auto', label: 'Auto Balance (Round-Robin)' },
    { id: 'data-node-1', label: 'DuckDB Node 1 (:8011)' },
    { id: 'data-node-2', label: 'DuckDB Node 2 (:8012)' },
];

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

    // Mapeo exacto a los archivos .webp disponibles en public/cars/ según clase (GT3 vs Hypercar)
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

export const buildStreamUrl = (
    apiBaseUrl: string,
    clientId: string,
    mode: 'sync' | 'independent',
    dataNode: string = 'auto'
): string => {
    const params = new URLSearchParams({
        client_id: clientId,
        mode,
        data_node: dataNode,
    });
    return `${apiBaseUrl}/stream?${params.toString()}`;
};

async function fetchWithFailover(
    path: string,
    preferredBaseUrl: string,
    options?: RequestInit
): Promise<{ data: any; activeBaseUrl: string } | null> {
    const dynamicNodes = getApiNodes();
    const candidates = [
        preferredBaseUrl,
        ...dynamicNodes.map(n => n.baseUrl).filter(u => u !== preferredBaseUrl),
    ];

    for (const baseUrl of candidates) {
        try {
            const response = await fetch(`${baseUrl}${path}`, options);
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

export const fetchDashboardData = async (
    apiBaseUrl: string = API_NODES[0].baseUrl,
    clientId: string = 'default-client',
    mode: 'sync' | 'independent' = 'sync',
    dataNode: string = 'auto'
) => {
    const params = new URLSearchParams({
        client_id: clientId,
        mode,
        data_node: dataNode,
    });
    const res = await fetchWithFailover(`/dashboard?${params.toString()}`, apiBaseUrl);
    return res ? res.data : null;
};

export const fetchTrackMap = async (apiBaseUrl: string = API_NODES[0].baseUrl) => {
    const res = await fetchWithFailover('/track-map', apiBaseUrl);
    return res ? res.data : [];
};

export const fetchClusterStatus = async (apiBaseUrl: string = API_NODES[0].baseUrl) => {
    const res = await fetchWithFailover('/cluster/status', apiBaseUrl);
    return res ? res.data : null;
};

export const resetPlayback = async (
    apiBaseUrl: string = API_NODES[0].baseUrl,
    clientId: string = 'default-client',
    mode: 'sync' | 'independent' = 'sync'
) => {
    const params = new URLSearchParams({ client_id: clientId, mode });
    const res = await fetchWithFailover(`/playback/reset?${params.toString()}`, apiBaseUrl, {
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
        { method: 'POST' }
    );
    return res ? res.data : null;
};
