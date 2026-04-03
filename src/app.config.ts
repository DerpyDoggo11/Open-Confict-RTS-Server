import config, { listen } from "@colyseus/tools";
import { matchMaker } from "colyseus";
import { GameRoom } from "./rooms/gameRoom.js";
import { LobbyRoom } from "./rooms/lobbyRoom.js";
import cors from "cors";

const MAX_SERVERS = 4;

const app = config({
  initializeGameServer: (gameServer) => {
    gameServer.define("game_room", GameRoom);
    gameServer.define("lobby_room", LobbyRoom);
  },

  initializeExpress: (expressApp) => {

    expressApp.use(cors({ origin: "https://open-conflict-rts.pages.dev" }));

    expressApp.get("/health", (req, res) => res.json({ status: "ok" }));

    expressApp.get("/rooms", async (req, res) => {
      try {
        const rooms = await matchMaker.query({ name: "game_room" });
        res.json(rooms.map(r => ({
          roomId: r.roomId,
          clients: r.clients,
          maxClients: r.maxClients,
          locked: r.locked,
        })));
      } catch (e) {
        res.json([]);
      }
    });

    expressApp.get("/lobby-rooms", async(_req, res) => {
      try {
        const rooms = await matchMaker.query({ name: "lobby_room" });

        const slots = Array.from({ length: MAX_SERVERS }, (_, i) => {
          const room = rooms.find(r => r.metadata?.serverIndex === i);
          return {
            serverIndex: i,
            roomId: room?.roomId ?? null,
            clients: room?.clients ?? 0,
            maxClients: room?.maxClients ?? 2,
            locked: room?.locked ?? false,
          };
        });

        res.json(slots);
      } catch {
        res.json([]);
      }
    });
  },
});

listen(app, 2567).then(() => {
  console.log("Server running on ws://localhost:2567");
});