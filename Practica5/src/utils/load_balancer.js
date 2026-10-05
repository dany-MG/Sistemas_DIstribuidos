import net from 'net'

const backends = [
    {host: '127.0.0.1', port: 8081 },
    {host : '127.0.0.1', port : 8082}
]

let index = 0

const server = net.createServer((clientSocket) => {
    const target = backends[index]
    index = (index + 1) % backends.length
    
    console.log(`[Load Balancer] Enrutando trafico al servidor ${target.host}:${target.port}`)
    const backendSocket = net.connect(target.port, target.host, () => {
        clientSocket.pipe(backendSocket)
        backendSocket.pipe(clientSocket)
    })
    backendSocket.on('error', (err) =>{
        console.log(`[Load Balancer] Fallo en el nodo backend ${target.port}: ${err.message}`);
        clientSocket.end();
    })
    clientSocket.on('error', (err) =>{
        console.log(`[Load Balancer] Fallo de red en el cliente: ${err.message}`);
        backendSocket.end();
    })
})

const PORT = 8080
server.listen(PORT, () => {
    console.log(`---- Balanceador de Carga Capa 4 Iniciado (Puerto TCP ${PORT}) ----`);
    console.log(`Enrutando tráfico hacia ${backends.length} nodos activos.`);
})
