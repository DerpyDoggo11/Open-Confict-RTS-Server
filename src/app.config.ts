import { defineServer, defineRoom } from "colyseus";
import { ChatRoom } from "./rooms/chatRoom.js";

const server = defineServer({
  rooms: {
    game_room: defineRoom(ChatRoom),
  },
});

server.listen(2567);
console.log("Server running on ws://localhost:2567");