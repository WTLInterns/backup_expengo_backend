
const { createClient } = require('redis');
require('dotenv').config();

const redisClient = createClient({
  url: process.env.REDIS_URL
});

redisClient.on('error', (err) => console.error(' Redis Client Error', err));

(async () => {
  await redisClient.connect();
  console.log(' Redis Connected');
})();

module.exports = redisClient;
