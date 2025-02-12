import Fastify, { FastifyError } from "fastify";

import fastifyRateLimit from "@fastify/rate-limit";
import fastifyHelmet from "@fastify/helmet";
import fastifyCors from '@fastify/cors';
import fastifyMultipart from "@fastify/multipart";
import fastifyWebsocket from "@fastify/websocket";

import redis, { redisDeleteAll } from "./services/redis";
import websocket from "./services/websocket";
import logger from "./services/logger";

// custom hooks
import dataSourcesMiddleware from "./middlewares/dataSourcesMiddleware";

const fastify = Fastify({ logger: true });

const PORT = 8080;

// helmet
await fastify.register(fastifyHelmet, { 
    contentSecurityPolicy: false, 
    crossOriginResourcePolicy: false 
})

// cors
await fastify.register(fastifyCors);

// rate limit
await fastify.register(fastifyRateLimit, {
    max: 100,
    timeWindow: '1 minute'
})

// for files
await fastify.register(fastifyMultipart);

// websocket
await fastify.register(fastifyWebsocket);

// middlewares
fastify.addHook("preHandler", dataSourcesMiddleware);
fastify.addHook("preHandler", tokenMiddleware);

// error handler
fastify.setErrorHandler((error: FastifyError) => {
    logger.error({
        message: error.message,
        name: error.name,
        stack: error.stack,
        statusCode: error.statusCode,
        cause: error.cause
    });
});

// routes
import router from "./routes/index";
import tokenMiddleware from "./middlewares/tokenMiddleware";
router(fastify);

try {    
    await redis.connect();
    console.log(`Connected to redis ! ✅`);

    //await redisDeleteAll("room:*"); // delete all rooms
    logger.info(`Cleaned all rooms from redis`);

    websocket(fastify);
    console.log(`Websocket enabled on ws://localhost:${PORT}/ws/`);

    // listening to 0.0.0.0 (for container)
    await fastify.listen({ host: "0.0.0.0", port: PORT });
    logger.info(`Server running on port http://localhost:${PORT} 🚀`);
} catch (err) {
    fastify.log.error(err);
    process.exit(1);
}