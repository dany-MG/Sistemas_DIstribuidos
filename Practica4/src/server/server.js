import { WebSocketServer } from 'ws';
import { createClient } from 'redis';

const port = parseInt(process.argv[2] || 8081);
const wss = new WebSocketServer({ port: port });
const localSockets = new Map();

// Cliente 1: Para escribir en la base de datos Redis y que todos los nodos puedan ver el estado global de los coches
const redisDb = createClient();
redisDb.on('error', (err) => console.log(`[Redis DB] Error: ${err.message}`));
await redisDb.connect();

// Cliente 2: Dedicado al patrón Pub/Sub, para recibir las órdenes de radio del ingeniero y enviarlas a los coches conectados a este nodo
const redisSub = createClient();
redisSub.on('error', (err) => console.log(`[Redis Sub] Error: ${err.message}`));
await redisSub.connect();

console.log(`---- Servidor de Telemetría (Nodo :${port}) ----`);

// NUEVO: Suscripción al canal de radio global
await redisSub.subscribe('radio_comms', (message) => {
    const command = JSON.parse(message);
    
    // Si este nodo específico tiene el cable físico de red de este auto, actúa.
    if (localSockets.has(command.targetId)) {
        console.log(`\n[Nodo ${port}]Ejecutando orden global para ${command.targetId}`);
        const car = localSockets.get(command.targetId);
        
        car.socket.send(JSON.stringify({targetId: command.targetId, type: 'ENGINEER_COMMAND', message: command.instruction }));
        
        // Simulamos la duración de la instrucción por radio antes de cortar
        setTimeout(() => car.socket.close(), 2500);
    }
});

wss.on('connection', (ws) => {
    let id = 'Vehiculo desconocido';
    
    ws.on('message', async (buffer) => {
        const data = JSON.parse(buffer.toString());
        
        if (data.type === 'SESSION_INIT') {
            id = `#${data.car_number}`;
            localSockets.set(id, { socket: ws, last_clk: 0 });

            await redisDb.sAdd('global_active_cars', id);
            await redisDb.rPush('global_radio_queue', id);

            const queueLength = await redisDb.lLen('global_radio_queue');
            console.log(`[Nodo ${port}] Vehículo ${id} conectado. Cola global de radio: ${queueLength}/3`);
            
        } else if (data.type === 'TELEMETRY_TICK') {
            if (!localSockets.has(id)) return;
            let carState = localSockets.get(id);

            if (data.clk <= carState.last_clk) return;
            carState.last_clk = data.clk;
        }
    });
    
    ws.on('close', async () => {
        if (localSockets.has(id)) {
            localSockets.delete(id);
            await redisDb.sRem('global_active_cars', id);
            console.log(`[Nodo ${port}] Competidor ${id} desconectado.`);
        }
    });
});