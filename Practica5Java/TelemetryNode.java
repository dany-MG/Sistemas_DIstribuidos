import java.rmi.Naming;
import java.util.Random; // Importación necesaria para la aleatoriedad

public class TelemetryNode {
    public static void main(String[] args) {
        try {
            System.out.println("---- Nodo de Telemetría Iniciado ----");
            
            // 1. Localización del objeto distribuido
            TrackEngineer engineerStub = (TrackEngineer) Naming.lookup("rmi://localhost:1099/IngenieroPista");
            System.out.println("[Nodo] Conectado exitosamente al Ingeniero Remoto.");
            
            // 2. Restauración de la parrilla dinámica
            String[] carBrands = {
                "Porsche GT3R", "Ferrari 296 GT3", "Lamborghini Huracan GT3 Evo", 
                "Audi R8 LMS", "Mercedes-AMG GT3 Evo", "BMW GT3", 
                "Aston Martin Vantage GT3 Evo", "McLaren 720S GT3 Evo", 
                "Nissan GT-R Nismo GT3", "Chevrolet Corvette C7 GT3"
            };
            
            Random random = new Random();
            String selectedBrand = carBrands[random.nextInt(carBrands.length)];
            int carNumber = random.nextInt(99) + 1; // Número entre 1 y 99
            
            // Generamos el ID limpio, omitiendo la marca personal anterior
            String carId = "#" + carNumber + " " + selectedBrand;
            
            System.out.println("[Sistema] Vehículo asignado para esta sesión: " + carId);
            
            // Estado inicial del auto para la carrera de resistencia
            double currentFuel = 110.0; 
            double currentTemp = 90.0;  
            
            // 3. Bucle de Polling: Simulamos 25 vueltas de carrera
            for (int lap = 1; lap <= 25; lap++) {
                
                // Evolución física del auto por vuelta
                currentFuel -= 2.5;
                currentTemp += 1.8;
                
                // Instanciamos el DTO con los datos actualizados
                TelemetryDTO currentData = new TelemetryDTO(
                    lap, currentTemp, currentTemp, currentTemp - 5, currentTemp - 5, currentFuel
                );
                
                System.out.println("\n==================================================");
                System.out.println("[Pista] Vuelta " + lap + " | Combustible: " + currentFuel + "L | Llantas: " + currentTemp + "°C");
                
                // 4. Invocación Remota Síncrona
                DiagnosisDTO diagnosis = engineerStub.analyzeCarStatus(carId, currentData);
                
                System.out.println("[Radio Ingeniero]: " + diagnosis.command);
                
                // Reacción a las órdenes del ingeniero
                if (diagnosis.retireCar) {
                    System.out.println("[Sistema] 🛑 Falla terminal. Retirando el auto a los boxes. Fin de sesión.");
                    break;
                }
                
                if (diagnosis.boxNow) {
                    System.out.println("[Sistema] 🛠️ Entrando a pit lane...");
                    System.out.println("[Sistema] 🔧 Cambiando neumáticos y recargando combustible...");
                    
                    // Reseteamos el estado del auto
                    currentFuel = 110.0;
                    currentTemp = 85.0;
                    
                    Thread.sleep(4000); 
                    System.out.println("[Sistema] 🟢 Saliendo de boxes, reincorporación a pista.");
                }
                
                Thread.sleep(1500);
            }
            
            System.out.println("\n---- Bandera a Cuadros. Sesión de telemetría finalizada ----");
            
        } catch (Exception e) {
            System.err.println("[Alerta de Red] Caída del Ingeniero: " + e.getMessage());
        }
    }
}