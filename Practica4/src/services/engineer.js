import {createClient} from 'redis'

const redis = createClient()
await redis.connect()

console.log("---- Microservicio: Ingeniero de Pista Iniciado ----")
console.log("Supervisando la cola global de comunicaciones en Redis...")

let isProcessing = false

setInterval(async () => {
    if (isProcessing) return

    const qLength = await redis.lLen('global_radio_queue')

    if (qLength >=3){
        isProcessing = true // Bloqueamos el procesamiento mientras atendemos la cola de 3 coches
        console.log(`[Ingeniero] Limite de parrilla detectado. Iniciando transmisiones...`)
        while(await redis.lLen('global_radio_queue') > 0){
            const targetId = await redis.lPop('global_radio_queue')
            const isActive = await redis.sIsMember('global_active_cars', targetId)
            if (isActive){
                console.log(`[Ingeniero] Publicando orden de radio para ${targetId}`)
                const commandPayload = {
                    targetId: targetId,
                    instruction: `Telemetría óptima. Mantén el ritmo, agresividad en frenada confirmada.`
                }
                await redis.publish('radio_comms', JSON.stringify(commandPayload))
                await new Promise(resolve => setTimeout(resolve, 3000)) // Simulamos un retardo de 3 segundos entre cada transmisión
            }

        }
        isProcessing = false // Liberamos el procesamiento para la siguiente ronda
        console.log("\n[Ingeniero] Fin de las transmisiones. A la espera de más tráfico.");
    }
}, 2000) //Revisa la base de datos cada 2 segundos para ver si hay 3 coches en la cola global