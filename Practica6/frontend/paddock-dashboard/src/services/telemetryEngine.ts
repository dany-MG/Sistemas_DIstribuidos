const COMPOUND_MAP: Record<number, string> = {
    0: 'Medium',
    1: 'Soft',
    2: 'Hard',
    3: 'Wet',
};

export interface WheelValues {
    fl: number;
    fr: number;
    rl: number;
    rr: number;
}

/**
 * Búsqueda binaria O(log N) sobre una tabla de eventos ordenada por timestamp [ts, value].
 * Devuelve el último evento ocurrido en o antes de targetGpsTime.
 */
function findLatestEventValue<T>(
    events: Array<[number, T]> | undefined,
    targetGpsTime: number,
    defaultValue: T
): T {
    if (!events || events.length === 0) return defaultValue;

    let low = 0;
    let high = events.length - 1;
    let bestIdx = -1;

    while (low <= high) {
        const mid = (low + high) >>> 1;
        if (events[mid][0] <= targetGpsTime) {
            bestIdx = mid;
            low = mid + 1;
        } else {
            high = mid - 1;
        }
    }

    return bestIdx >= 0 ? events[bestIdx][1] : defaultValue;
}

function findLatestEventPair(
    events: Array<[number, number]> | undefined,
    targetGpsTime: number
): [number, number] {
    if (!events || events.length === 0) return [0.0, 0];

    let low = 0;
    let high = events.length - 1;
    let bestIdx = -1;

    while (low <= high) {
        const mid = (low + high) >>> 1;
        if (events[mid][0] <= targetGpsTime) {
            bestIdx = mid;
            low = mid + 1;
        } else {
            high = mid - 1;
        }
    }

    return bestIdx >= 0 ? [Number(events[bestIdx][0]), Number(events[bestIdx][1])] : [0.0, 0];
}

export class TelemetryClientEngine {
    private pack: any;
    public readonly stepHz: number;
    public readonly totalTicks: number;
    public readonly durationSec: number;

    constructor(telemetryPack: any) {
        this.pack = telemetryPack || {};
        this.stepHz = Number(this.pack.step_hz || 5);
        this.totalTicks = Number(this.pack.total_ticks || 1);
        this.durationSec = Number(this.pack.duration_sec || 649.5);
    }

    public getStartTime(): number {
        return 15.0;
    }

    public clampCursor(cursorSec: number): number {
        if (!Number.isFinite(cursorSec) || cursorSec < 0) return 15.0;
        if (this.durationSec > 0 && cursorSec >= this.durationSec) {
            return cursorSec % this.durationSec;
        }
        return cursorSec;
    }

    public advanceCursor(cursorSec: number, stepSec: number = 0.2): number {
        const next = cursorSec + stepSec;
        if (this.durationSec > 0 && next >= this.durationSec) {
            return 15.0;
        }
        return Number(next.toFixed(2));
    }

    private readScalar(channelKey: string, tickIdx: number, defaultVal: number = 0.0): number {
        const arr = this.pack?.continuous?.[channelKey];
        if (!arr || arr.length === 0) return defaultVal;
        const scaledIdx =
            arr.length === this.totalTicks
                ? tickIdx
                : Math.min(arr.length - 1, Math.floor((tickIdx / this.totalTicks) * arr.length));
        const val = arr[Math.max(0, Math.min(arr.length - 1, scaledIdx))];
        return val !== undefined && val !== null ? Number(val) : defaultVal;
    }

    private readWheel(channelKey: string, tickIdx: number): WheelValues {
        const arr = this.pack?.wheels?.[channelKey];
        if (!arr || arr.length === 0) {
            return { fl: 0, fr: 0, rl: 0, rr: 0 };
        }
        const scaledIdx =
            arr.length === this.totalTicks
                ? tickIdx
                : Math.min(arr.length - 1, Math.floor((tickIdx / this.totalTicks) * arr.length));
        const row = arr[Math.max(0, Math.min(arr.length - 1, scaledIdx))];
        if (!row || row.length < 4) {
            return { fl: 0, fr: 0, rl: 0, rr: 0 };
        }
        return {
            fl: Number(row[0] ?? 0),
            fr: Number(row[1] ?? 0),
            rl: Number(row[2] ?? 0),
            rr: Number(row[3] ?? 0),
        };
    }

    /**
     * Calcula en el navegador del cliente el TelemetrySnapshot completo para cualquier
     * instante cursorSec de la sesión en < 0.1 ms, liberando por completo al servidor.
     */
    public computeSnapshotAt(
        cursorSec: number,
        metaOverrides?: {
            apiNodeId?: string;
            dataNodeId?: string;
            playbackMode?: string;
            activeClientsCount?: number;
            api_node_id?: string;
            data_node_id?: string;
            playback_mode?: string;
            active_clients_count?: number;
        }
    ) {
        const normalizedSec =
            this.durationSec > 0 ? ((cursorSec % this.durationSec) + this.durationSec) % this.durationSec : 0;
        const tickIdx = Math.min(
            this.totalTicks - 1,
            Math.max(0, Math.floor(normalizedSec * this.stepHz))
        );

        const sessionGpsTime = this.readScalar('gps_time', tickIdx, normalizedSec);
        const ev = this.pack?.events || {};

        const [lapStartTs, currentLap] = findLatestEventPair(ev.lap, sessionGpsTime);
        const currentLapTimeEvent = Number(
            findLatestEventValue(ev.current_lap_time_event, sessionGpsTime, 0.0)
        );
        const liveLapTime =
            lapStartTs > 0 && sessionGpsTime >= lapStartTs
                ? sessionGpsTime - lapStartTs
                : currentLapTimeEvent;

        const rawSector = Number(findLatestEventValue(ev.raw_sector, sessionGpsTime, 1));
        const normalizedSector = rawSector === 0 ? 3 : rawSector;

        const compoundIdx = Number(this.pack?.compound_idx ?? 0);
        const tyreCompound = COMPOUND_MAP[compoundIdx] || `Spec-${compoundIdx}`;

        const rawBb = Number(findLatestEventValue(ev.brake_bias_rear, sessionGpsTime, 0.5));
        const brakeBiasRear = rawBb <= 1.0 ? rawBb * 100.0 : rawBb;

        return {
            api_node_id: metaOverrides?.api_node_id || metaOverrides?.apiNodeId || 'api-node-1',
            data_node_id: metaOverrides?.data_node_id || metaOverrides?.dataNodeId || 'data-node-1',
            playback_mode: metaOverrides?.playback_mode || metaOverrides?.playbackMode || 'sync',
            active_clients_count: metaOverrides?.active_clients_count || metaOverrides?.activeClientsCount || 1,
            session_time_s: Number(normalizedSec.toFixed(2)),

            rpm: this.readScalar('rpm', tickIdx, 0),
            max_rpm: Number(findLatestEventValue(ev.max_rpm, sessionGpsTime, 9500.0)),
            gear: Number(findLatestEventValue(ev.gear, sessionGpsTime, 0)),
            speed_kmh: this.readScalar('speed_kmh', tickIdx, 0),
            fuel_level_liters: this.readScalar('fuel_level_liters', tickIdx, 0),
            virtual_energy_pct: this.readScalar('virtual_energy_pct', tickIdx, 0),
            water_temp_c: this.readScalar('water_temp_c', tickIdx, 0),
            oil_temp_c: this.readScalar('oil_temp_c', tickIdx, 0),

            throttle_pos: this.readScalar('throttle_pos', tickIdx, 0),
            brake_pos: this.readScalar('brake_pos', tickIdx, 0),
            steering_pos: this.readScalar('steering_pos', tickIdx, 0),
            g_force_lat: this.readScalar('g_force_lat', tickIdx, 0),
            g_force_long: this.readScalar('g_force_long', tickIdx, 0),

            tc_active: Boolean(this.readScalar('tc_active', tickIdx, 0)),
            tc_level: Number(findLatestEventValue(ev.tc_level, sessionGpsTime, 0)),
            abs_active: Boolean(findLatestEventValue(ev.abs_active, sessionGpsTime, false)),
            abs_level: Number(findLatestEventValue(ev.abs_level, sessionGpsTime, 0)),
            brake_bias_rear: Number(brakeBiasRear.toFixed(1)),

            gps_lat: this.readScalar('gps_lat', tickIdx, 0),
            gps_lon: this.readScalar('gps_lon', tickIdx, 0),
            in_pits: Boolean(findLatestEventValue(ev.in_pits, sessionGpsTime, false)),
            yellow_flag: Number(findLatestEventValue(ev.yellow_flag, sessionGpsTime, 0)),
            track_temp_c: this.readScalar('track_temp_c', tickIdx, 0),
            ambient_temp_c: this.readScalar('ambient_temp_c', tickIdx, 0),

            tyre_temps_c: this.readWheel('tyre_temps_c', tickIdx),
            brake_temps_c: this.readWheel('brake_temps_c', tickIdx),
            tyre_wear_percent: this.readWheel('tyre_wear_percent', tickIdx),
            tyre_pressures_kpa: this.readWheel('tyre_pressures_kpa', tickIdx),
            tyre_compound: tyreCompound,

            current_lap: currentLap,
            current_lap_time: Number(liveLapTime.toFixed(3)),
            best_lap_time: Number(findLatestEventValue(ev.best_lap_time, sessionGpsTime, 0.0)),
            last_lap_time: Number(findLatestEventValue(ev.last_lap_time, sessionGpsTime, 0.0)),
            best_sector_1: Number(findLatestEventValue(ev.best_sector_1, sessionGpsTime, 0.0)),
            best_sector_2: Number(findLatestEventValue(ev.best_sector_2, sessionGpsTime, 0.0)),
            last_sector_1: Number(findLatestEventValue(ev.last_sector_1, sessionGpsTime, 0.0)),
            last_sector_2: Number(findLatestEventValue(ev.last_sector_2, sessionGpsTime, 0.0)),
            current_sector: normalizedSector,
        };
    }
}
