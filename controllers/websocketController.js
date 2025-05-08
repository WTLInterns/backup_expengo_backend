// const WebSocket = require("ws")
// const clients = new Map()

// const handleConnection = (ws) => {

//   ws.on("message", (message) => {
//     try {
//       const data = JSON.parse(message)

//       if (data.type === "register") {
//         // Store client connection
//         clients.set(data.driverId, { role: data.role, ws })
//         console.log(`${data.role} (${data.driverId}) connected`)

//         // Send registration confirmation
//         ws.send(
//           JSON.stringify({
//             type: "register_confirmation",
//             message: `User ${data.driverId} registered as ${data.role}`,
//           }),
//         )
//       }

//       if (data.type === "location") {
//         console.log(`${data.role} (${data.driverId}) location:`, data.location)

//         // Send location updates to all other users
//         for (const [userId, client] of clients.entries()) {
//           // Don't send the update back to the sender
//           if (userId !== data.driverId && client.ws.readyState === WebSocket.OPEN) {
//             client.ws.send(
//               JSON.stringify({
//                 type: "location_update",
//                 driverId: data.driverId,
//                 role: data.role,
//                 location: data.location,
//               }),
//             )
//           }
//         }
//       }
//     } catch (error) {
//     }
//   })

//   ws.on("close", () => {
//     for (const [userId, client] of clients.entries()) {
//       if (client.ws === ws) {
//         console.log(`${client.role} (${userId}) disconnected`)
//         clients.delete(userId)
//         break
//       }
//     }
//   })
// }

// module.exports = { handleConnection }




const WebSocket = require("ws");
const redisClient = require("../config/redisClient");
const { v4: uuidv4 } = require("uuid");  
// const clients = new Map()


// Handle WebSocket connection
const handleConnection = (ws) => {
  ws.on("message", async (message) => {
    try {
      const data = JSON.parse(message);

      if (data.type === "register") {
        // Generate a unique ID for the client
        const clientId = data.driverId;
        // Store client connection in Redis
        await redisClient.hset("clients", clientId, JSON.stringify({ role: data.role }));

        console.log(`${data.role} (${clientId}) connected`);

        // Send registration confirmation
        ws.send(
          JSON.stringify({
            type: "register_confirmation",
            message: `User ${clientId} registered as ${data.role}`,
          })
        );
      }

      if (data.type === "location") {
        console.log(`${data.role} (${data.driverId}) location:`, data.location);

        // Publish location updates to Redis for broadcasting
        redisClient.publish(
          "location_updates",
          JSON.stringify({
            driverId: data.driverId,
            role: data.role,
            location: data.location,
          })
        );
      }
    } catch (error) {
      console.error("Error handling message:", error);
    }
  });

  // On WebSocket close
  ws.on("close", async () => {
    // Remove client from Redis when they disconnect
    for (const [clientId, clientData] of await redisClient.hgetall("clients")) {
      if (clientData.ws === ws) {
        console.log(`${clientData.role} (${clientId}) disconnected`);
        await redisClient.hdel("clients", clientId); // Remove from Redis
        break;
      }
    }
  });
};

// Subscribe to location updates channel
redisClient.subscribe("location_updates");

redisClient.on("message", (channel, message) => {
  if (channel === "location_updates") {
    const data = JSON.parse(message);

    // Broadcast location update to all connected clients
    redisClient.hgetall("clients", (err, clients) => {
      if (err) return console.error("Error fetching clients from Redis:", err);

      for (const [clientId, clientData] of Object.entries(clients)) {
        const client = JSON.parse(clientData);
        // Send location update to each client, except the sender
        if (clientId !== data.driverId) {
          client.ws.send(
            JSON.stringify({
              type: "location_update",
              driverId: data.driverId,
              role: data.role,
              location: data.location,
            })
          );
        }
      }
    });
  }
});

module.exports = { handleConnection };
