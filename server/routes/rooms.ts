import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { IMusicToken } from "../business/musics/MusicService";
import SpotifyService from "../business/musics/SpotifyService";

export default (fastify: FastifyInstance) => {
  fastify.post("/create", {
    schema: {
      body: {
        type: "object",
        required: ["token"],
        properties: {
          token: {
            type: "object",
            required: ["type", "authorization"],
            properties: {
              type: { type: "string", minLength: 1 },
              authorization: { type: "string", minLength: 1 },
              expiresAt: { type: "string", minLength: 1 },
              refreshToken: { type: "string", minLength: 1 },
              name: { type: "string", minLength: 1 },
            },
            additionalProperties: false,
          },
        },
        additionalProperties: false,
      },
    },
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { token, name } = request.body as {
          token: IMusicToken;
          name?: string;
        };
        const service = new SpotifyService(token);

        // user needs to be premium
        const userProfile = await service.getUserProfile();
        if (userProfile?.isPremium !== true) {
          return reply.status(403).send({
            message: "You need to have a premium account to create a room.",
          });
        }

        const room = await request.dataSources.rooms.create(token);
        const ownerId = request.dataSources.rooms.generateClientId();

        const accessToken = await request.dataSources.rooms.generateAccessToken(
          {
            roomId: room.id,
            clientId: ownerId,
          }
        );
        await request.dataSources.rooms.update(room.id, {
          ownerId,
          externalIds: [{ type: "/spotify", value: userProfile.id }],
        });
        await request.dataSources.rooms.join(
          room,
          ownerId,
          name ?? "Owner",
          request.me
        );

        reply.status(200).send({
          redirectURI: `${process.env.WEBSITE_URL!}/room/${room.id}`,
          accessToken,
        });
      } catch (e) {
        const error = e as Error;
        reply.status(500).send({ message: error.message });
      }
    },
  });

  fastify.post("/leave", {
    schema: {
      headers: {
        type: "object",
        properties: {
          authorization: { type: "string", minLength: 1 },
        },
      },
    },
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const me = request.me!; // we assume that it will not be null
        if (!me) {
          return reply
            .status(403)
            .send({ message: "You're not authenticated anymore" });
        }

        const room = await request.dataSources.rooms.get(me.roomId);
        if (!room) {
          return reply.status(403).send({ message: "Invalid room" });
        }

        await request.dataSources.rooms.leave(room, me.clientId);
        reply.status(200).send({ success: true });
      } catch (e) {
        const error = e as Error;
        reply.status(500).send({
          message: error.message,
          stack: error.stack,
        });
      }
    },
  });

  fastify.get("/get/:id", {
    schema: {
      params: {
        type: "object",
        required: ["id"],
        properties: {
          id: { type: "string", minLength: 1 },
        },
        additionalProperties: false,
      },
    },
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { id } = request.params as { id: string };
        const room = await request.dataSources.rooms.get(id);
        if (!room) {
          return reply
            .status(404)
            .send({ message: "Room not found or expired." });
        }

        const player = await room?.service.getPlayer();
        const { currentPlaying, queue } = await room?.service.getQueue()!;
        const { token: _, service, ownerId, ...r }: any = room;

        reply.status(200).send({
          room: {
            ...r,
            queue,
            currentPlaying,
            player,
          },
        });
      } catch (e) {
        const error = e as Error;
        reply.status(500).send({ message: error.message, stack: error.stack });
      }
    },
  });

  fastify.post("/join/:id", {
    schema: {
      params: {
        type: "object",
        required: ["id"],
        properties: {
          id: { type: "string", minLength: 1 },
        },
        additionalProperties: false,
      },
      body: {
        type: "object",
        required: ["name"],
        properties: {
          name: {
            type: "string",
            minLength: 1,
          },
          additionalProperties: false,
        },
      },
    },
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { id } = request.params as { id: string };
        const { name } = request.body as { name: string };

        const room = await request.dataSources.rooms.get(id);
        if (!room) {
          return reply
            .status(404)
            .send({ message: "Room not found or expired." });
        }
        const { token: _, service, ownerId, ...r }: any = room;

        const clientId = request.dataSources.rooms.generateClientId();
        const accessToken = await request.dataSources.rooms.generateAccessToken(
          {
            roomId: r.id,
            clientId,
          }
        );

        await request.dataSources.rooms.join(room!, clientId, name, request.me);

        reply.status(200).send({
          accessToken,
          room: r,
        });
      } catch (e) {
        const error = e as Error;
        reply.status(500).send({ message: error.message, stack: error.stack });
      }
    },
  });
};
