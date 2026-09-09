import {WebSocketServer} from 'ws';

const wss = new WebSocketServer({port : 8080});

console.log("---- Servidor de Telemetría Iniciado en el puerto 8080 ----");

wss.on('connection', (ws) =>{
    console.log('[Sistema] Nuevo cliente del simulador conectado')
    ws.on('message', (buffer) => {
        const data = JSON.parse(buffer.toString());

        if(data.type === 'SESSION_INIT'){
            console.log(`[Sesion] Vehiculo: ${data.car_brand} | Circuito: ${data.track_name}`)
        }else if(data.type === 'TELEMETRY_TICK'){
            console.log(`[Telemetria] Vuelta: ${data.lap}`)
            console.log(`[Llantas] DI: ${data.fr_tire_temp}°C | DD: ${data.fl_tire_temp}°C | TI: ${data.rr_tire_temp}°C | TD: ${data.rl_tire_temp}°C`)
            console.log(`[Combustible] Nivel: ${data.fuel_level}L`)
            console.log(`[Inputs] Acelerador: ${data.throttle}% | Freno: ${data.break_pressure}% | Angulo de direccion: ${data.steering_angle}°`)
            console.log(`[Velocidad] ${data.speed}km/h | Marcha: ${data.gear}`)
            console.log(`[Motor] RPM: ${data.rpm} | Temperatura: ${data.engine_temperature}°C`)
            console.log(`[Aceite] Presion: ${data.oil_pressure}psi | Temperatura: ${data.oil_temperature}°C`)
            console.log(`[Refrigerante] Temperatura: ${data.coolant_temperature}°C`)
            console.log('------------------------------------------------------------')
        }
    })
    ws.on('close', () =>{
        console.log('[Sistema] Cliente del simulador desconectado')
    })
})

