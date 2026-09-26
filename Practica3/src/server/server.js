import {WebSocketServer} from 'ws';

const wss = new WebSocketServer({port : 8080});
const activeCars = new Map();

const radioQueue = []
let isRadioProcessing = false

console.log("---- Servidor de Telemetría Iniciado en el puerto 8080 ----");
console.log(`[Race Control] Esperando parrilla mínima de 3 vehículos...`);

wss.on('connection', (ws) =>{
    let id = 'Vehiculo desconocido'
    ws.on('message', (buffer) => {
        const data = JSON.parse(buffer.toString());
        if(data.type === 'SESSION_INIT'){
            console.log("\n***************************************************")
            console.log(`[Sesion] Circuito: ${data.track_name}`)

            id = `#${data.car_number}`
            activeCars.set(id, {socket: ws, last_clk : 0})

            console.log(`[Race Control] Nuevo competidor: ${id}`);
            console.log(`[Race Control] Parrilla ${activeCars.size}/3`)
            console.log("***************************************************\n")
            radioQueue.push(id)
            console.log(`[Radio] Vehículo ${id} encolado para radio check. (${radioQueue.length}/3)`)
            if(radioQueue.length >= 3 && !isRadioProcessing){
                processRadioQueue()
            }
        }else if(data.type === 'TELEMETRY_TICK'){
            if(!activeCars.has(id)) return
            let carState = activeCars.get(id)

            //ordenamiento logico -> Timestamp Ordering
            if(data.clk <= carState.last_clk){
                console.log(`[Race Control] Telemetria desactualizada de ${carState.id}. Ignorando datos...`)
            }

            carState.last_clk = data.clk
        }
    })
    ws.on('close', () =>{
        if(activeCars.has(id)){
            activeCars.delete(id)
            console.log("\n***************************************************")
            console.log(`[Race Control] Competidor ${id} ha abandonado la carrera`)
            console.log("***************************************************\n")
        }
    })
})

async function processRadioQueue() {
    isRadioProcessing = true;
    console.log("\n[Ingeniero] Condición de parrilla alcanzada. Iniciando procesamiento de radio secuencial...\n");

    while (radioQueue.length > 0) {
        // Extraemos el primer auto que llegó (FIFO)
        const targetId = radioQueue.shift(); 
        const targetCar = activeCars.get(targetId);

        // Verificamos que el auto siga conectado antes de hablarle
        if (targetCar && targetCar.socket.readyState === 1) { 
            console.log(`[Ingeniero] > Abriendo canal con ${targetId}...`);
            
            const command = {
                type: 'ENGINEER_COMMAND',
                message: 'Plan de carrera confirmado. Entendido, cortando radio.'
            };
            targetCar.socket.send(JSON.stringify(command));
            
            // Pausa no bloqueante: Simulamos el tiempo que tarda el ingeniero en hablar
            await new Promise(resolve => setTimeout(resolve, 2500)); 
            
            console.log(`[Ingeniero] < Comunicación finalizada con ${targetId}. Desconectando vehículo.`);
            targetCar.socket.close();
            
            // Breve pausa antes de abrir el radio con el siguiente
            await new Promise(resolve => setTimeout(resolve, 500)); 
        }
    }

    isRadioProcessing = false;
    console.log("\n[Ingeniero] Cola de radio vacía. A la espera de la siguiente tanda de vehículos.");
}