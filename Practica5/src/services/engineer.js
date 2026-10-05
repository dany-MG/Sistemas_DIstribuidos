import {createClient} from 'redis'

const redisPub = createClient();
const redisSub = createClient();
await redisPub.connect();
await redisSub.connect();

class TrackEngineerService {
    // Método que será invocado remotamente desde cualquier nodo del clúster
    analyzeCarStatus(carId, telemetry) {
        console.log(`[RMI Skeleton] Analizando telemetría completa de ${carId} (Vuelta ${telemetry.lap})`);
        
        const warnings = [];
        let boxNow = false;
        let retireCar = false; // Solo desconectaremos el socket si el motor explota o se queda sin gasolina

        // 1. Análisis de Neumáticos (Ejes Delantero vs Trasero)
        const frontTemp = Math.max(parseFloat(telemetry.fr_tire_temp), parseFloat(telemetry.fl_tire_temp));
        const rearTemp = Math.max(parseFloat(telemetry.rr_tire_temp), parseFloat(telemetry.rl_tire_temp));
        const maxTireTemp = Math.max(frontTemp, rearTemp);

        if (maxTireTemp > 108.0) {
            warnings.push(`CRÍTICO NEUMÁTICOS: ${maxTireTemp}°C. Degradación extrema, ¡Box esta vuelta!`);
            boxNow = true;
        } else if (rearTemp > 103.0 && telemetry.break_pressure > 85) {
            warnings.push(`CUIDADO TRASERO: Eje trasero en ${rearTemp}°C con frenada al ${telemetry.break_pressure}%. Riesgo de trompo en entrada a curva.`);
        } else if (frontTemp > 103.0) {
            warnings.push(`TEMPERATURA DELANTERA: Eje frontal en ${frontTemp}°C. Gestiona el giro en curvas rápidas.`);
        }

        // 2. Análisis de Motor y Refrigerante
        const engineTemp = parseFloat(telemetry.engine_temperature);
        const coolantTemp = parseFloat(telemetry.coolant_temperature);

        if (engineTemp > 118.0 && coolantTemp > 115.0) {
            warnings.push(`FALLA TERMINAL DE MOTOR: Motor a ${engineTemp}°C y refrigerante a ${coolantTemp}°C. ¡Apaga el auto!`);
            retireCar = true;
        } else if (engineTemp > 112.0 || coolantTemp > 112.0) {
            warnings.push(`ALERTA TÉRMICA: Motor (${engineTemp}°C) / Refrigerante (${coolantTemp}°C) elevados. Haz Lift & Coast y cambia a bajas RPM.`);
        }

        // 3. Análisis de Presión y Temperatura de Aceite
        const oilPress = parseFloat(telemetry.oil_pressure);
        const oilTemp = parseFloat(telemetry.oil_temperature);

        if (oilPress < 28.0) {
            warnings.push(`PELIGRO LUBRICACIÓN: Presión de aceite crítica (${oilPress} psi). ¡Entra a boxes de inmediato!`);
            boxNow = true;
        } else if (oilTemp > 114.0) {
            warnings.push(`ADVERTENCIA ACEITE: Temperatura de aceite alta (${oilTemp}°C).`);
        }

        // 4. Análisis de Combustible para Resistencia (Stint completo)
        const fuel = parseFloat(telemetry.fuel_level);
        if (fuel <= 1.0) {
            warnings.push(`SIN COMBUSTIBLE (${fuel.toFixed(1)}L). Retiro de sesión.`);
            retireCar = true;
        } else if (fuel <= 15.0) {
            warnings.push(`COMBUSTIBLE BAJO: Quedan ${fuel.toFixed(1)}L. ¡Box, Box para repostar!`);
            boxNow = true;
        } else if (fuel <= 30.0) {
            warnings.push(`ESTRATEGIA: ${fuel.toFixed(1)}L restantes. Ahorra combustible (Mapa motor de ahorro).`);
        }

        // Si ningún sensor disparó alertas, enviamos confirmación de ritmo limpio
        if (warnings.length === 0) {
            warnings.push(`Ritmo óptimo en vuelta ${telemetry.lap}. Temperaturas (${maxTireTemp}°C) y presiones en ventana verde.`);
        }

        // Retornamos el DTO completo al Stub
        return {
            lap: telemetry.lap,
            boxNow: boxNow,
            retireCar: retireCar,
            warnings: warnings, // Arreglo con todas las instrucciones acumuladas
            command: warnings.join(' | ') // Resumen en texto por retrocompatibilidad
        };
    }
}

const engineerInstance = new TrackEngineerService()
console.log("---- Servidor RMI: Ingeniero de Pista Iniciado ----");

await redisSub.subscribe('rmi_request_channel', async (message) =>{
    const request = JSON.parse(message)
    const {correlationId, methodName, args} = request

    if(typeof engineerInstance[methodName] === 'function'){
        try{
            const result = engineerInstance[methodName](...args)
            const responsePayload = {
                correlationId: correlationId,
                status: 'SUCCESS',
                returnValue: result
            }
            await redisPub.publish('rmi_response_channel', JSON.stringify(responsePayload))
        }catch(error){
            await redisPub.publish('rmi_response_channel', JSON.stringify({
                correlationId: correlationId,
                status: 'ERROR',
                error: error.message
            }));
        }
    }

})