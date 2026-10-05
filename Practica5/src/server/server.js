import { WebSocketServer } from 'ws';
import { createClient } from 'redis';
import { randomUUID } from 'crypto';

const port = parseInt(process.argv[2] || 8081);
const wss = new WebSocketServer({ port: port });
const localSockets = new Map();

const redisDb = createClient();
const redisSub = createClient();
await redisDb.connect();
await redisSub.connect();

const pendingRmiCalls = new Map();
const RMI_TIMEOUT_MS = 2000; // Límite estricto de espera: 2 segundos

await redisSub.subscribe('rmi_response_channel', (message) => {
    const response = JSON.parse(message);
    
    if (pendingRmiCalls.has(response.correlationId)) {
        // Extraemos la promesa y su temporizador de seguridad
        const { resolve, reject, timeoutTimer } = pendingRmiCalls.get(response.correlationId);
        
        // Cancelamos la bomba de tiempo y limpiamos la RAM
        clearTimeout(timeoutTimer);
        pendingRmiCalls.delete(response.correlationId);

        if (response.status === 'SUCCESS') {
            resolve(response.returnValue);
        } else {
            reject(new Error(`RemoteExecutionException: ${response.error}`));
        }
    }
});

// Generador de Dynamic Stubs usando Metaprogramación (ES6 Proxy)
function createDynamicRmiStub(channelName, timeoutMs) {
    return new Proxy({}, {
        // 'get' intercepta cualquier propiedad o método que intentes invocar en el Stub
        get(target, methodName) {
            return (...args) => {
                return new Promise(async (resolve, reject) => {
                    const correlationId = randomUUID();

                    // Mecanismo de Timeout: Si el Skeleton muere, abortamos y liberamos memoria
                    const timeoutTimer = setTimeout(() => {
                        if (pendingRmiCalls.has(correlationId)) {
                            pendingRmiCalls.delete(correlationId);
                            reject(new Error(`RemoteTimeoutException: El servicio remoto no respondió al método '${String(methodName)}' tras ${timeoutMs}ms (Posible caída de nodo).`));
                        }
                    }, timeoutMs);

                    // Guardamos la referencia junto con el timer
                    pendingRmiCalls.set(correlationId, { resolve, reject, timeoutTimer });

                    const rmiPacket = {
                        correlationId: correlationId,
                        methodName: String(methodName), // Interceptado dinámicamente
                        args: args
                    };

                    try {
                        await redisDb.publish(channelName, JSON.stringify(rmiPacket));
                    } catch (err) {
                        clearTimeout(timeoutTimer);
                        pendingRmiCalls.delete(correlationId);
                        reject(err);
                    }
                });
            };
        }
    });
}

// Instanciamos el Stub dinámico
const engineerStub = createDynamicRmiStub('rmi_request_channel', RMI_TIMEOUT_MS);
// ============================================================================

console.log(`---- Servidor de Telemetría Resiliente con RMI (Nodo :${port}) ----`);

wss.on('connection', (ws) => {
    let id = 'Vehiculo desconocido';

    ws.on('message', async (buffer) => {
        let data = JSON.parse(buffer.toString());

        if (data.type === 'SESSION_INIT') {
            id = `#${data.car_number}`;
            localSockets.set(id, { socket: ws, last_clk: 0 });
            console.log(`[Nodo ${port}] Vehículo ${id} registrado en pista.`);

        } else if (data.type === 'TELEMETRY_TICK') {
            if (!localSockets.has(id)) return;
            let carState = localSockets.get(id);

            // Timestamp Ordering
            if (data.clk <= carState.last_clk) {
                console.log(`[Race Control] Telemetria desactualizada de ${id}. Ignorando...`);
                return;
            }
            carState.last_clk = data.clk;

            if (data.clk % 5 === 0) {
                console.log(`[Nodo ${port}] Invocando método remoto 'analyzeCarStatus' para ${id} (Vuelta ${data.lap})...`);
                
                try {
                    // Invocación transparente interceptada por el Proxy
                    let diagnosis = await engineerStub.analyzeCarStatus(id, data);
                    
                    ws.send(JSON.stringify({
                        type: 'ENGINEER_COMMAND',
                        targetId: id,
                        lap: diagnosis.lap,
                        boxNow: diagnosis.boxNow,
                        warnings: diagnosis.warnings,
                        message: diagnosis.command
                    }));

                    if (diagnosis.boxNow && !diagnosis.retireCar) {
                        console.log(`[Nodo ${port}] Pit Stop solicitado vía RMI para ${id}. El auto continúa en sesión.`);
                    }

                    if (diagnosis.retireCar) {
                        console.log(`[Nodo ${port}] Retiro confirmado vía RMI para ${id}. Cerrando canal.`);
                        setTimeout(() => ws.close(), 1500);
                    }

                } catch (rmiError) {
                    console.error(`[Nodo ${port}] Alerta de Infraestructura: ${rmiError.message}`);
                    console.log(`[Nodo ${port}] Activando telemetría de respaldo local (Fallback) para ${id}...`);

                    // El servidor de telemetría calcula una alerta básica de emergencia para no dejar ciego al piloto
                    const emergencyWarnings = [
                        `[MODO EMERGENCIA - SIN CONEXIÓN CON MURO DE BOXES]`,
                        `Mantén ritmo conservador. Combustible actual: ${data.fuel_level.toFixed(1)}L | Temp Motor: ${data.engine_temperature}°C.`
                    ];

                    ws.send(JSON.stringify({
                        type: 'ENGINEER_COMMAND',
                        targetId: id,
                        lap: data.lap,
                        boxNow: false,
                        warnings: emergencyWarnings,
                        message: emergencyWarnings.join(' | ')
                    }));
                }
            }
        }
    });

    ws.on('close', () => {
        if (localSockets.has(id)) {
            localSockets.delete(id);
            console.log(`[Nodo ${port}] Vehículo ${id} desconectado de pista.`);
        }
    });
});