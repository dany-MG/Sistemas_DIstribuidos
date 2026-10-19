// La URL base de nuestro nodo backend
const API_BASE_URL = 'http://localhost:8000/api/v1';

export const fetchDashboardData = async () => {
    try {
        const response = await fetch(`${API_BASE_URL}/dashboard`);
        if (!response.ok) {
            throw new Error(`Error HTTP: ${response.status}`);
        }
        return await response.json();
    } catch (error) {
        console.error("Fallo de red al conectar con la API de Telemetría:", error);
        return null;
    }
};
