import config, { listen } from "@colyseus/tools";
import { GameRoom } from "./rooms/gameRoom.js";

const app = config({
  initializeGameServer: (gameServer) => {
    gameServer.define("game_room", GameRoom);
    console.log("game_room registered");
  },

  initializeExpress: (expressApp) => {
    expressApp.get("/health", (req, res) => res.json({ status: "ok" }));
  },

  beforeListen: () => {
    console.log("Server starting...");
  }
});

listen(app, 2567).then(() => {
  console.log("Server running on ws://localhost:2567");
});