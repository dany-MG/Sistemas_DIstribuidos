import {WebSocketServer} from 'ws';

const wss = new WebSocketServer({port : 8080});
const activeCars = new Map();

console.log("---- Servidor de Telemetría Iniciado en el puerto 8080 ----");

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
            console.log("***************************************************\n")
        }else if(data.type === 'TELEMETRY_TICK'){
            if(!activeCars.has(id)) return
            let carState = activeCars.get(id)

            //ordenamiento logico -> Timestamp Ordering
            if(data.clk <= carState.last_clk){
                console.log(`[Race Control] Telemetria desactualizada de ${carState.id}. Ignorando datos...`)
            }

            carState.last_clk = data.clk

            console.log("------------------------------------------------------------")
            console.log(`[${id}-Telemetria] Vuelta: ${data.lap}`)
            console.log(`[${id}-Llantas] DI: ${data.fr_tire_temp}°C | DD: ${data.fl_tire_temp}°C | TI: ${data.rr_tire_temp}°C | TD: ${data.rl_tire_temp}°C`)
            console.log(`[${id}-Combustible] Nivel: ${data.fuel_level}L`)
            console.log(`[${id}-Inputs] Acelerador: ${data.throttle}% | Freno: ${data.break_pressure}% | Angulo de direccion: ${data.steering_angle}°`)
            console.log(`[${id}-Velocidad] ${data.speed}km/h | Marcha: ${data.gear}`)
            console.log(`[${id}-Motor] RPM: ${data.rpm} | Temperatura: ${data.engine_temperature}°C`)
            console.log(`[${id}-Aceite] Presion: ${data.oil_pressure}psi | Temperatura: ${data.oil_temperature}°C`)
            console.log(`[${id}-Refrigerante] Temperatura: ${data.coolant_temperature}°C`)
            console.log('------------------------------------------------------------')
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

