import java.rmi.Remote;
import java.rmi.RemoteException;

// Esta interfaz es tu IDL (Interface Definition Language)
public interface TrackEngineer extends Remote {
    DiagnosisDTO analyzeCarStatus(String carId, TelemetryDTO telemetry) throws RemoteException;
}