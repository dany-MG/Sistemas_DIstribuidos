import WebSocket from 'ws'

const ws = new WebSocket('ws://localhost:8080')

ws.on('open', () =>{
    console.log('----Conectado al muro de boxes----')

    const sessionData = {
        type : 'SESSION_INIT',
        car_brand : 'Porsche GT3R',
        track_name : 'Sebring International Raceway'
    }
    ws.send(JSON.stringify(sessionData))

    let lap = 1
    setInterval(() => {
        const telemetria = {
            type : 'TELEMETRY_TICK',
            lap: lap,

            fr_tire_temp: (Math.random() * (110 - 70) + 70).toFixed(2),
            fl_tire_temp: (Math.random() * (110 - 70) + 70).toFixed(2),
            rr_tire_temp: (Math.random() * (110 - 70) + 70).toFixed(2),
            rl_tire_temp: (Math.random() * (110 - 70) + 70).toFixed(2),

            fuel_level: 117.5 - (lap * 0.5),

            throttle: Math.floor(Math.random() * (100 - 0 + 1) + 0),
            break_pressure: Math.floor(Math.random() * (100 - 0 + 1) + 0),
            steering_angle: Math.floor(Math.random() * (360 - 0 + 1) + 0),

            speed: Math.floor(Math.random() * (200 - 0 + 1) + 0),

            gear: Math.floor(Math.random() * (6 - 1 + 1) + 1),

            engine_temperature: (Math.random() * (120 - 80) + 80).toFixed(2),

            oil_pressure: (Math.random() * (100 - 20) + 20).toFixed(2),
            oil_temperature: (Math.random() * (120 - 80) + 80).toFixed(2),
            
            coolant_temperature: (Math.random() * (120 - 80) + 80).toFixed(2),
            
            rpm: Math.floor(Math.random() * (9000 - 1000 + 1) + 1000)
        }   
        ws.send(JSON.stringify(telemetria))
        lap++
    }, 1000)
})