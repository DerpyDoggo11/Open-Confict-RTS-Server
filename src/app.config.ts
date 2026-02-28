import config, { listen } from "@colyseus/tools";
import { matchMaker } from "colyseus";
import { GameRoom } from "./rooms/gameRoom.js";

const app = config({
  initializeGameServer: (gameServer) => {
    gameServer.define("game_room", GameRoom);
  },

  initializeExpress: (expressApp) => {
    expressApp.get("/health", (req, res) => res.json({ status: "ok" }));

    // Custom lobby endpoint using matchMaker directly
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
  },
});

listen(app, 2567).then(() => {
  console.log("Server running on ws://localhost:2567");
});