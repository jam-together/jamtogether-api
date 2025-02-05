import {v4 as uuid} from "uuid";

import redis, { setRedisKey } from "../services/redis";

import MusicService, { IMusicToken, ITrack, TQueue } from "../business/musics/MusicService";
import SpotifyService from "../business/musics/SpotifyService";
import { webSocketConnections } from "../services/websocket";
import tokenService from "../business/tokenService";
import { IMe } from "../../fastify";
import logger from "../services/logger";

export declare namespace RoomEvents {

    namespace Member {
        interface Joined { member: IRoomMember; }
        interface Leaved { member: IRoomMember; }
        interface Nickname { member: IRoomMember; }
        
        type MessageType = "MEMBER_JOINED" |  "MEMBER_LEAVED";
    }
    namespace Music {
        interface Added { newTrack: ITrack, newQueue: Array<ITrack>; by?: IRoomMember; }
        interface Removed { newTrack: ITrack, newQueue: Array<ITrack>; by?: IRoomMember; }
        interface Switched { newTrack: ITrack; newQueue: Array<ITrack>; by?: IRoomMember; }
        interface Played { newTrack: ITrack, newQueue: Array<ITrack>; by?: IRoomMember; }
        interface Paused { newTrack: ITrack, newQueue: Array<ITrack>; by?: IRoomMember; }

        type MessageType = "MUSIC_ADDED" | "MUSIC_REMOVED" | "MUSIC_SWITCHED" | "MUSIC_PLAYED" | "MUSIC_PAUSED";
    }

    type MessageType = Music.MessageType | Member.MessageType | "DISCONNECTED" | "NEW_DEVICE" | "HISTORY_MODIFIED" | "NICKNAME_CHANGED";
    interface IncomingMessage<T = {}> {
        date: Date;
        type: RoomEvents.MessageType;
        data?: T;
    }

}

export interface IRoomMember {
    id: string;
    displayName: string;
    isConnected: boolean;
}

export interface IRoom {
    id: string;
    ownerId: string;
    members: Array<IRoomMember>;
    createdAt: Date;

    history: RoomEvents.IncomingMessage[];
    token: IMusicToken;

    externalIds: { type: string; value: string; }[];
}

export default class Rooms {

    private generateRoomId() {
        const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
        let result = "";
      
        for (let i = 0; i < 6; i++) {
          result += letters[Math.floor(Math.random() * letters.length)];
        }
      
        return result;
    }

    public generateClientId() {
        return uuid();
    }

    public async generateAccessToken({ roomId, roles, clientId }: {roomId: string; roles?: string[]; clientId?: string;}): Promise<string> {
        roles = [...new Set([...roles??[], "user"])];
        return tokenService.serialize({ roomId, clientId: clientId ?? uuid(), roles });
    }

    public async create(token: IMusicToken): Promise<IRoom> {
        const room: Partial<IRoom> = {
            id: this.generateRoomId(),
            createdAt: new Date(),
            token,

            history: [],
            members: [],
            externalIds: []
        };

        await setRedisKey(`room:${room.id}`, room);
        return room as IRoom;
    }
    
    public async update(id: string, props: Partial<IRoom>): Promise<IRoom> {
        const room = await this.get(id);
        if(!room) {
            throw new Error("room not found");
        }
        delete (room as any).service;
        const newRoomData = {...room, ...props};
        await setRedisKey(`room:${id}`, newRoomData);
        return newRoomData;
    }

    public async get(id: string): Promise<IRoom&{service: MusicService}|null> {
        const r = await redis.get(`room:${id}`);
        if(!r) return null;

        const room = JSON.parse(r) as IRoom;
        const service = new SpotifyService(room.token);

        const result = Object.assign({}, room, { service });
        return result;
    }

    public async delete(id: string): Promise<IRoom> {
        const room = await this.get(id);
        if(!room) {
            throw new Error("Room not found.");
        }

        await this.broadcast(room.id, { type: "DISCONNECTED" });

        const subscriptionKey = `room:${id}`;
        await redis.del(subscriptionKey);
        return room;
    }

    public async join(room: IRoom, clientId: string, me?: IMe, displayName: string): Promise<IRoom> {
        const hasAlreadyThisMember = room.members.findIndex(({id}) => id === me?.clientId) !== -1;
        // if member is not connected or the room that he's trying to get connect is different than his room
        let member: IRoomMember;
        
        if(!me || me.roomId !== room.id || !hasAlreadyThisMember) {
            member = {
                id: clientId, 
                displayName,
                isConnected: true
            };
            await this.update(room.id, {
                members: [...room.members, member]
            });
        // if member is connected to this room
        } else {
            const clientIndex = room.members.findIndex(m => m.id === clientId);
            const m = room.members.at(clientIndex)!;
            m.isConnected = true;
            member = m;
        }

        await this.broadcast<RoomEvents.Member.Joined>(room.id, {
            type: "MEMBER_JOINED",
            data: { member }
        });
        return room;
    }

    public async leave(room: IRoom, clientId: string): Promise<void> {
        if(clientId === room.ownerId) {
            this.delete(room.id);   
            return;
        }
        
        const clientIndex = room.members.findIndex(({id}) => id === clientId);
        if(clientIndex === -1) {
            throw new Error("Client id is not in this room.");
        }
        
        const member = room.members.at(clientIndex)!;
        room.members.at(clientIndex)!.isConnected = false;

        await this.update(room.id, {
            members: room.members
        });
        await this.broadcast<RoomEvents.Member.Leaved>(room.id, {
            type: "MEMBER_LEAVED",
            data: { member }
        });
    }

    public async broadcast<T>(id: string, message: Omit<RoomEvents.IncomingMessage<T>, "date">): Promise<void> {
        const room = await this.get(id);
        if(!room) return;
        
        const membersValidWebsockets = room.members
            .map(({id: uid}) => webSocketConnections[uid])
            .filter(ws => !!ws);

        const newHistory = [...room.history, {...message, date: new Date()} as RoomEvents.IncomingMessage]

        // broadcast the message to all members
        membersValidWebsockets.forEach(ws => {
            ws.send(JSON.stringify(message));
            ws.send(JSON.stringify({
                type: "HISTORY_MODIFIED",
                date: new Date(),
                data: { newHistory }
            } as RoomEvents.IncomingMessage<{ newHistory: RoomEvents.IncomingMessage[] }>))
        });
        
        try {
            // then put it in redis
            await this.update(room.id, { history: newHistory })
        } catch(e) {
            const error = e as Error;
            logger.error(error);
        }
    }

}