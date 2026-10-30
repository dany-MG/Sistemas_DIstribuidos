// Carga perezosa (code-splitting) de @duckdb/duckdb-wasm solo cuando el usuario selecciona un archivo .duckdb

const BRAND_RULES: Array<[string, string]> = [
    ['porsche', 'Porsche'],
    ['proton', 'Porsche'],
    ['manthey', 'Porsche'],
    ['penske', 'Porsche'],
    ['jota', 'Porsche'],
    ['iron dames', 'Porsche'],
    ['ferrari', 'Ferrari'],
    ['af corse', 'Ferrari'],
    ['vista', 'Ferrari'],
    ['bmw', 'BMW'],
    ['wrt', 'BMW'],
    ['corvette', 'Corvette'],
    ['tf sport', 'Corvette'],
    ['mclaren', 'McLaren'],
    ['united autosports', 'McLaren'],
    ['aston', 'Aston Martin'],
    ['heart of racing', 'Aston Martin'],
    ["d'station", 'Aston Martin'],
    ['lamborghini', 'Lamborghini'],
    ['iron lynx', 'Lamborghini'],
    ['toyota', 'Toyota'],
    ['gazoo', 'Toyota'],
    ['cadillac', 'Cadillac'],
    ['ganassi', 'Cadillac'],
    ['peugeot', 'Peugeot'],
    ['alpine', 'Alpine'],
    ['ford', 'Ford'],
    ['mustang', 'Ford'],
    ['mercedes', 'Mercedes-AMG'],
    ['amg', 'Mercedes-AMG'],
    ['genesis', 'Genesis'],
    ['lexus', 'Lexus'],
    ['akkodis', 'Lexus'],
    ['oreca', 'Oreca'],
    ['lmp2', 'Oreca'],
];

function inferCarBrand(carName: string, explicitBrand?: string): string {
    if (explicitBrand && explicitBrand.trim() && explicitBrand !== 'Unknown') {
        return explicitBrand.trim();
    }
    const lower = (carName || '').toLowerCase();
    for (const [kw, brand] of BRAND_RULES) {
        if (lower.includes(kw)) return brand;
    }
    return 'Porsche';
}

function flattenCarSetup(rawJsonStr: string): Record<string, any> {
    try {
        const parsed = JSON.parse(rawJsonStr || '{}');
        const flat: Record<string, any> = {};
        for (const [k, v] of Object.entries<any>(parsed)) {
            if (v && typeof v === 'object' && ('Value' in v || 'StringValue' in v || 'value' in v)) {
                flat[k] = {
                    key: k,
                    caption: v.Caption ?? v.caption ?? null,
                    value: v.Value ?? v.value ?? 0,
                    string_value: String(v.StringValue ?? v.string_value ?? v.Value ?? v.value ?? 'N/A'),
                    last_saved: v.LastSavedStringValue ?? v.last_saved ?? null,
                    min_value: v.MinValue ?? v.min_value ?? 0,
                    max_value: v.MaxValue ?? v.max_value ?? 1,
                    available: Boolean(v.Available ?? v.available ?? true),
                    is_free_setting: Boolean(v.IsFreeSetting ?? v.is_free_setting ?? true),
                };
            } else if (v && typeof v === 'object') {
                for (const [subKey, subVal] of Object.entries<any>(v)) {
                    if (subVal && typeof subVal === 'object') {
                        flat[subKey] = {
                            key: subKey,
                            caption: subVal.Caption ?? subVal.caption ?? null,
                            value: subVal.Value ?? subVal.value ?? 0,
                            string_value: String(subVal.StringValue ?? subVal.string_value ?? subVal.Value ?? subVal.value ?? 'N/A'),
                            last_saved: subVal.LastSavedStringValue ?? subVal.last_saved ?? null,
                            min_value: subVal.MinValue ?? subVal.min_value ?? 0,
                            max_value: subVal.MaxValue ?? subVal.max_value ?? 1,
                            available: Boolean(subVal.Available ?? subVal.available ?? true),
                            is_free_setting: Boolean(subVal.IsFreeSetting ?? subVal.is_free_setting ?? true),
                        };
                    }
                }
            }
        }
        return flat;
    } catch {
        return {};
    }
}

/**
 * Procesa cualquier archivo .duckdb grabado por Le Mans Ultimate directamente en el navegador
 * usando WebAssembly (@duckdb/duckdb-wasm) y genera un Session Pack completo a 20 Hz.
 */
export async function parseDuckdbFileInBrowser(
    file: File,
    stepHz: number = 20,
    onProgress?: (statusText: string) => void
): Promise<any> {
    onProgress?.('Inicializando motor DuckDB-Wasm en el navegador...');
    const duckdb = await import('@duckdb/duckdb-wasm');

    const JSDELIVR_BUNDLES = duckdb.getJsDelivrBundles();
    const bundle = await duckdb.selectBundle(JSDELIVR_BUNDLES);

    const workerUrl = URL.createObjectURL(
        new Blob([`importScripts("${bundle.mainWorker!}");`], { type: 'text/javascript' })
    );

    const worker = new Worker(workerUrl);
    const logger = new duckdb.VoidLogger();
    const db = new duckdb.AsyncDuckDB(logger, worker);

    try {
        await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
        URL.revokeObjectURL(workerUrl);

        onProgress?.(`Montando archivo ${file.name} (${(file.size / (1024 * 1024)).toFixed(1)} MB)...`);
        await db.registerFileHandle(
            file.name,
            file,
            duckdb.DuckDBDataProtocol.BROWSER_FILEREADER,
            true
        );

        await db.open({
            path: file.name,
            accessMode: duckdb.DuckDBAccessMode.READ_ONLY,
        });

        const conn = await db.connect();

        try {
            onProgress?.('Descubriendo esquema y tablas de telemetría LMU...');
            const tablesRes = await conn.query(`SELECT table_name FROM information_schema.tables`);
            const availableTables = new Set<string>();
            for (const row of tablesRes.toArray()) {
                availableTables.add(String(row.table_name));
            }

            let tablePrefix = '';
            for (const tname of availableTables) {
                if (tname.toLowerCase().endsWith('metadata')) {
                    tablePrefix = tname.slice(0, tname.length - 'metadata'.length);
                    break;
                }
            }

            const resolveChannel = (candidates: string[]): string | null => {
                for (const cand of candidates) {
                    if (availableTables.has(`${tablePrefix}${cand}`)) {
                        return cand;
                    }
                }
                return null;
            };

            // 1. Metadata & CarSetup
            const metaMap: Record<string, string> = {};
            if (availableTables.has(`${tablePrefix}metadata`)) {
                const metaRes = await conn.query(`SELECT key, value FROM "${tablePrefix}metadata"`);
                for (const row of metaRes.toArray()) {
                    metaMap[String(row.key)] = String(row.value ?? '');
                }
            }

            const carName = metaMap.CarName || metaMap.car_name || 'LMU Vehicle';
            const sessionMetadata = {
                driver_name: metaMap.DriverName || metaMap.driver_name || 'Piloto LMU',
                track_name: metaMap.TrackName || metaMap.track_name || file.name.replace(/\.duckdb$/i, ''),
                track_layout: metaMap.TrackCourse || metaMap.TrackName || 'Full Circuit',
                session_type: metaMap.Session || metaMap.session_type || 'Practice',
                session_time: metaMap.SessionTime || '00:00:00',
                weather: metaMap.WeatherConditions || 'Clear',
                car_name: carName,
                car_class: metaMap.CarClass || 'GT3',
                car_brand: inferCarBrand(carName, metaMap.CarBrand),
                recording_time: metaMap.RecordingTime || new Date().toISOString(),
            };

            const setupDict = flattenCarSetup(metaMap.CarSetup || '{}');

            // 2. Frecuencias de canales
            const frequencies: Record<string, number> = {};
            if (availableTables.has(`${tablePrefix}channelsList`)) {
                try {
                    const freqRes = await conn.query(
                        `SELECT channelName, frequency FROM "${tablePrefix}channelsList"`
                    );
                    for (const row of freqRes.toArray()) {
                        frequencies[String(row.channelName)] = Number(row.frequency || 20);
                    }
                } catch {}
            }

            // 3. Mapa GPS del circuito
            onProgress?.('Extrayendo geometría GPS del circuito...');
            const trackMap: Array<{ lat: number; lon: number }> = [];
            const latCh = resolveChannel(['GPS Latitude']);
            const lonCh = resolveChannel(['GPS Longitude']);
            if (latCh && lonCh) {
                try {
                    const mapQuery = `
                        SELECT CAST(lat.value AS DOUBLE) AS lat, CAST(lon.value AS DOUBLE) AS lon
                        FROM "${tablePrefix}${latCh}" lat
                        JOIN "${tablePrefix}${lonCh}" lon ON lat.rowid = lon.rowid
                        WHERE lat.rowid % 5 = 0
                          AND ABS(CAST(lat.value AS DOUBLE)) > 0.1
                          AND ABS(CAST(lon.value AS DOUBLE)) > 0.1
                        ORDER BY lat.rowid ASC
                    `;
                    const mapRes = await conn.query(mapQuery);
                    for (const row of mapRes.toArray()) {
                        trackMap.push({
                            lat: Number(Number(row.lat).toFixed(6)),
                            lon: Number(Number(row.lon).toFixed(6)),
                        });
                    }
                } catch {}
            }

            // 4. Series continuas a 20 Hz
            onProgress?.(`Vectorizando canales de telemetría a ${stepHz} Hz...`);
            const continuousChannels: Record<string, [string[], number]> = {
                gps_time: [['GPS Time'], 100],
                rpm: [['Engine RPM'], 100],
                speed_kmh: [['Ground Speed'], 100],
                fuel_level_liters: [['Fuel Level'], 20],
                virtual_energy_pct: [['Virtual Energy'], 20],
                water_temp_c: [['Engine Water Temp'], 7],
                oil_temp_c: [['Engine Oil Temp'], 7],
                throttle_pos: [['Throttle Pos Unfiltered', 'Throttle Pos'], 50],
                brake_pos: [['Brake Pos Unfiltered', 'Brake Pos'], 50],
                steering_pos: [['Steering Pos', 'Steering Pos Unfiltered'], 100],
                g_force_lat: [['G Force Lat'], 10],
                g_force_long: [['G Force Long'], 10],
                tc_active: [['TC', 'TC Active'], 100],
                gps_lat: [['GPS Latitude'], 10],
                gps_lon: [['GPS Longitude'], 10],
                track_temp_c: [['Track Temperature'], 1],
                ambient_temp_c: [['Ambient Temperature'], 1],
            };

            const continuousData: Record<string, number[]> = {};
            for (const [key, [candidates, defFreq]] of Object.entries(continuousChannels)) {
                const chName = resolveChannel(candidates);
                if (!chName) {
                    continuousData[key] = [];
                    continue;
                }
                const freq = frequencies[chName] || defFreq;
                const step = Math.max(1, Math.round(freq / stepHz));
                const decimals = key === 'gps_lat' || key === 'gps_lon' ? 6 : 2;
                try {
                    const q =
                        key === 'tc_active'
                            ? `SELECT CAST(value AS INT) AS v FROM "${tablePrefix}${chName}" WHERE rowid % ${step} = 0 ORDER BY rowid ASC`
                            : `SELECT ROUND(CAST(value AS DOUBLE), ${decimals}) AS v FROM "${tablePrefix}${chName}" WHERE rowid % ${step} = 0 ORDER BY rowid ASC`;
                    const res = await conn.query(q);
                    continuousData[key] = res.toArray().map((r: any) => Number(r.v ?? 0));
                } catch {
                    continuousData[key] = [];
                }
            }

            // 5. Canales de las 4 ruedas (FL, FR, RL, RR)
            onProgress?.('Extrayendo telemetría de neumáticos y frenos...');
            const wheelChannels: Record<string, [string[], number]> = {
                tyre_temps_c: [['TyresTempCentre', 'Tyres Temp Centre'], 100],
                brake_temps_c: [['Brakes Temp', 'BrakesTemp'], 50],
                tyre_wear_percent: [['Tyres Wear', 'TyresWear'], 10],
                tyre_pressures_kpa: [['TyresPressure', 'Tyres Pressure'], 10],
            };

            const wheelsData: Record<string, number[][]> = {};
            for (const [key, [candidates, defFreq]] of Object.entries(wheelChannels)) {
                const chName = resolveChannel(candidates);
                if (!chName) {
                    wheelsData[key] = [];
                    continue;
                }
                const freq = frequencies[chName] || defFreq;
                const step = Math.max(1, Math.round(freq / stepHz));
                try {
                    const q = `
                        SELECT ROUND(CAST(value1 AS DOUBLE), 1) AS v1,
                               ROUND(CAST(value2 AS DOUBLE), 1) AS v2,
                               ROUND(CAST(value3 AS DOUBLE), 1) AS v3,
                               ROUND(CAST(value4 AS DOUBLE), 1) AS v4
                        FROM "${tablePrefix}${chName}"
                        WHERE rowid % ${step} = 0
                        ORDER BY rowid ASC
                    `;
                    const res = await conn.query(q);
                    wheelsData[key] = res
                        .toArray()
                        .map((r: any) => [
                            Number(r.v1 ?? 0),
                            Number(r.v2 ?? 0),
                            Number(r.v3 ?? 0),
                            Number(r.v4 ?? 0),
                        ]);
                } catch {
                    wheelsData[key] = [];
                }
            }

            // 6. Tablas de eventos
            onProgress?.('Extrayendo tablas de vueltas, sectores y eventos...');
            const eventChannels: Record<string, string> = {
                max_rpm: 'Engine Max RPM',
                tc_level: 'TCLevel',
                abs_active: 'ABS',
                abs_level: 'ABSLevel',
                brake_bias_rear: 'Brake Bias Rear',
                in_pits: 'In Pits',
                yellow_flag: 'Yellow Flag State',
                gear: 'Gear',
                current_lap_time_event: 'Current LapTime',
                best_lap_time: 'Best LapTime',
                last_lap_time: 'Lap Time',
                best_sector_1: 'Best Sector1',
                best_sector_2: 'Best Sector2',
                last_sector_1: 'Last Sector1',
                last_sector_2: 'Last Sector2',
                raw_sector: 'Current Sector',
                lap: 'Lap',
            };

            const eventsData: Record<string, Array<[number, any]>> = {};
            for (const [key, evName] of Object.entries(eventChannels)) {
                const fullTable = `${tablePrefix}${evName}`;
                if (!availableTables.has(fullTable)) {
                    eventsData[key] = [];
                    continue;
                }
                try {
                    const q = `SELECT ROUND(CAST(ts AS DOUBLE), 4) AS t, value AS v FROM "${fullTable}" ORDER BY ts ASC`;
                    const res = await conn.query(q);
                    eventsData[key] = res.toArray().map((r: any) => [
                        Number(r.t ?? 0),
                        typeof r.v === 'number' ? Number(Number(r.v).toFixed(4)) : Number(r.v ?? 0),
                    ]);
                } catch {
                    eventsData[key] = [];
                }
            }

            let compoundIdx = 0;
            if (availableTables.has(`${tablePrefix}TyresCompound`)) {
                try {
                    const cRes = await conn.query(
                        `SELECT value1 FROM "${tablePrefix}TyresCompound" ORDER BY ts DESC LIMIT 1`
                    );
                    const arr = cRes.toArray();
                    if (arr.length > 0) {
                        compoundIdx = Number(arr[0].value1 ?? 0);
                    }
                } catch {}
            }

            const totalTicks = Math.max(
                1,
                continuousData.rpm?.length || 0,
                continuousData.speed_kmh?.length || 0,
                continuousData.gps_time?.length || 0
            );
            const durationSec = Number((totalTicks / stepHz).toFixed(2));

            return {
                api_node_id: 'duckdb-wasm-client',
                data_node_id: 'local-duckdb-wasm',
                active_session_file: file.name,
                session: sessionMetadata,
                setup: setupDict,
                track_map: trackMap,
                telemetry_pack: {
                    step_hz: stepHz,
                    total_ticks: totalTicks,
                    duration_sec: durationSec,
                    compound_idx: compoundIdx,
                    continuous: continuousData,
                    wheels: wheelsData,
                    events: eventsData,
                },
            };
        } finally {
            await conn.close();
        }
    } finally {
        await db.terminate();
    }
}
