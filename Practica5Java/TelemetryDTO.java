import java.io.Serializable;

// Este es el paquete de datos que viajará por la red
public class TelemetryDTO implements Serializable {
    private static final long serialVersionUID = 1L;
    
    public int lap;
    public double fl_tire_temp, fr_tire_temp, rl_tire_temp, rr_tire_temp;
    public double fuel_level, engine_temperature, coolant_temperature, oil_pressure;
    public int break_pressure;

    // Constructor básico para el ejemplo
    public TelemetryDTO(int lap, double fl, double fr, double rl, double rr, double fuel) {
        this.lap = lap;
        this.fl_tire_temp = fl; this.fr_tire_temp = fr;
        this.rl_tire_temp = rl; this.rr_tire_temp = rr;
        this.fuel_level = fuel;
    }
}