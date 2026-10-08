import java.io.Serializable;
import java.util.List;

public class DiagnosisDTO implements Serializable {
    private static final long serialVersionUID = 1L;
    
    public boolean boxNow;
    public boolean retireCar;
    public List<String> warnings;
    public String command;
    
    public DiagnosisDTO(boolean boxNow, boolean retireCar, List<String> warnings, String command) {
        this.boxNow = boxNow;
        this.retireCar = retireCar;
        this.warnings = warnings;
        this.command = command;
    }
}