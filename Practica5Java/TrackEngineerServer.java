import java.rmi.Naming;
import java.rmi.RemoteException;
import java.rmi.server.UnicastRemoteObject;
import java.util.ArrayList;
import java.util.List;

public class TrackEngineerServer extends UnicastRemoteObject implements TrackEngineer {

    protected TrackEngineerServer() throws RemoteException {
        super();
    }

    @Override
    public DiagnosisDTO analyzeCarStatus(String carId, TelemetryDTO telemetry) throws RemoteException {
        System.out.println("[RMI Skeleton] Analizando telemetría completa de " + carId + " (Vuelta " + telemetry.lap + ")");
        
        List<String> warnings = new ArrayList<>();
        boolean boxNow = false;
        
        double maxTire = Math.max(Math.max(telemetry.fl_tire_temp, telemetry.fr_tire_temp), 
                                  Math.max(telemetry.rl_tire_temp, telemetry.rr_tire_temp));
                                  
        if (maxTire > 108.0) {
            warnings.add("CRÍTICO NEUMÁTICOS: " + maxTire + "°C. Degradación extrema, ¡Box esta vuelta!");
            boxNow = true;
        }
        
        if (telemetry.fuel_level <= 15.0) {
            warnings.add("COMBUSTIBLE BAJO: Quedan " + telemetry.fuel_level + "L. ¡Box, Box para repostar!");
            boxNow = true;
        }

        if (warnings.isEmpty()) {
            warnings.add("Ritmo óptimo en vuelta " + telemetry.lap + ". Temperaturas bajo control.");
        }

        String command = String.join(" | ", warnings);
        return new DiagnosisDTO(boxNow, false, warnings, command);
    }

    public static void main(String[] args) {
        try {
            // Levantamos el Skeleton en la memoria de la JVM
            TrackEngineerServer engine = new TrackEngineerServer();
            
            // Registramos el objeto en el bus local (rmiregistry)
            Naming.rebind("rmi://localhost:1099/IngenieroPista", engine);
            
            System.out.println("---- Servidor Java RMI: Ingeniero de Pista Iniciado ----");
        } catch (Exception e) {
            System.err.println("Error en el servidor RMI: " + e.getMessage());
            e.printStackTrace();
        }
    }
}