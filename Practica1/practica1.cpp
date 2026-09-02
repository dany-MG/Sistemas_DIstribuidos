#include <iostream>
#include <thread>
#include <mutex>
#include <condition_variable>
#include <queue>
#include <chrono>
#include <random>
#include <time.h>
#include <cstring>

using namespace std;

typedef struct telemetry{
    char car_brand[32];
    char car_model[32];
    char track_name[64];

    int lap;
    float speed;
    float braking;
    float throttle;

    float fuel_remaining;
    int gear;
    int rpm;
    float fl_tire_temp;
    float fr_tire_temp;
    float rl_tire_temp;
    float rr_tire_temp;

    bool rain;
    bool wet;
    float lap_time;
} Telemetry;

thread_local mt19937 generator(random_device{}());

float random_float(float min, float max) {
    uniform_real_distribution<float> distribution(min, max);
    return distribution(generator);
}

int random_int(int min, int max){
    uniform_int_distribution<int> distribution(min, max);
    return distribution(generator);
}

Telemetry mockData(int curr_lap, float curr_fuel){
    Telemetry data;
    strncpy(data.car_brand, "Porsche", sizeof(data.car_brand) - 1);
    strncpy(data.car_model, "GT3 R 992", sizeof(data.car_model) - 1);
    strncpy(data.track_name, "Sebring International Raceway", sizeof(data.track_name) - 1);

    data.car_brand[sizeof(data.car_brand) - 1] = '\0';
    data.car_model[sizeof(data.car_model) - 1] = '\0';
    data.track_name[sizeof(data.track_name) - 1] = '\0';

    data.lap = curr_lap;
    data.speed = random_float(0.0f, 280.0f);
    data.braking = random_float(0.0f, 1.0f);
    data.throttle = random_float(0.0f, 1.0f);

    data.fuel_remaining = curr_fuel;
    data.gear = random_int(1, 6);
    data.rpm = random_int(1000, 9000);
    
    data.fl_tire_temp = random_float(70.0f, 120.0f);
    data.fr_tire_temp = random_float(70.0f, 120.0f);
    data.rl_tire_temp = random_float(70.0f, 120.0f);
    data.rr_tire_temp = random_float(70.0f, 120.0f);

    data.rain = false;
    data.wet = false;
    data.lap_time = random_float(60.0f, 118.448f);

    return data;
}

queue<Telemetry> tireQ;
queue<Telemetry> engineQ;
queue<Telemetry> inputsQ;

mutex mtxTyre, mtxEngine, mtxInputs, mtxConsole;
condition_variable cvTyre, cvEngine, cvInputs;
bool SessionActive = true;

// Hilo productor que simula la generación de datos de telemetría
void simulatorMaker(){
    srand(time(NULL));
    int lap = 1;
    float fuel_remaining = 117.2f;

    while(lap<=20){
        this_thread::sleep_for(chrono::milliseconds(500)); // Simulate delay in reading telemetry data
        Telemetry data = mockData(lap, fuel_remaining);
        {
            lock_guard<mutex> lockTyre(mtxTyre);
            tireQ.push(data);
        }
        cvTyre.notify_one();
        
        {
           lock_guard<mutex> lockEngine(mtxEngine);
           engineQ.push(data); 
        }
        cvEngine.notify_one();

        {
            lock_guard<mutex> lockInputs(mtxInputs);
            inputsQ.push(data);
        }
        cvInputs.notify_one();

        cout << "Telemetría generada: Vuelta " << lap << endl;
        
        lap++;
        fuel_remaining -= random_float(1.0f, 5.0f); // Simulate fuel consumption
    }
    SessionActive = false;
    cvTyre.notify_all();
    cvEngine.notify_all();
    cvInputs.notify_all();
}

void tyreReader(){
    while(1){
        unique_lock<mutex> lock(mtxTyre);
        cvTyre.wait(lock, []{ return !tireQ.empty() || !SessionActive; });
        
        if(!SessionActive && tireQ.empty()) {
            break; // Exit if session is inactive and queue is empty
        }
        Telemetry data = tireQ.front();
        tireQ.pop();
        lock.unlock();

        {
            lock_guard<mutex> lockConsole(mtxConsole);
            cout << "\n[Neumáticos] DI: " << data.fl_tire_temp << endl
                 << "[Neumáticos] TI: " << data.fr_tire_temp << endl
                 << "[Neumáticos] DD: " << data.rl_tire_temp << endl
                 << "[Neumáticos] TD: " << data.rr_tire_temp << endl;
        }
    }
}

void engineReader(){
    while(1){
        unique_lock<mutex> lock(mtxEngine);
        cvEngine.wait(lock, []{return !engineQ.empty() || !SessionActive; });
        
        if(!SessionActive && engineQ.empty()){break;}

        Telemetry data = engineQ.front();
        engineQ.pop();
        lock.unlock();

        {
            lock_guard<mutex> lockConsole(mtxConsole);
            cout << "\n[Motor] RPM: " << data.rpm << endl 
                 << "[Motor] Combustible restante: " << data.fuel_remaining << endl
                 << "[Motor] Velocidad: " << data.speed << endl
                 << "[Motor] Vuelta: " << data.lap << endl
                 << "[Motor] Marcha: " << data.gear << endl;
        }
    }
}

void inputsReader(){
    while(1){
        unique_lock<mutex> lock(mtxInputs);
        cvInputs.wait(lock, []{return !inputsQ.empty() || !SessionActive; });
        
        if(!SessionActive && inputsQ.empty()){break;}

        Telemetry data = inputsQ.front();
        inputsQ.pop();
        lock.unlock();

        {
            lock_guard<mutex> lockConsole(mtxConsole);
            cout << "\n[Inputs] Acelerador: " << data.throttle << endl
                 << "[Inputs] Frenado: " << data.braking << endl;
        }
    }
}
    

int main(){
    cout << "------ Simulación de Telemetría ---" << endl;
    thread telemetry_maker(simulatorMaker);
    thread inputsReaderThread(inputsReader);
    thread tyreReaderThread(tyreReader);
    thread engineReaderThread(engineReader);

    telemetry_maker.join();
    inputsReaderThread.join();
    tyreReaderThread.join();
    engineReaderThread.join();

    cout << "------ Simulación finalizada ---" << endl;
    return 0;
}
