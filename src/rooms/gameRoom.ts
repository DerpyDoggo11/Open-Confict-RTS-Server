import { Room, Client } from "colyseus";

interface PlayerInfo {
  name: string;
}

export class GameRoom extends Room {
  private players: Map<string, PlayerInfo> = new Map();

  onCreate() {
    console.log("server created");
    this.onMessage("chat", (client, message: { text: string }) => {
      const name = this.players.get(client.sessionId)?.name ?? "Unknown";
      this.broadcast("chat", {
        playerId: client.sessionId,
        name,
        text: message.text.slice(0, 200),
        timestamp: Date.now(),
      });
    });
  }

  onJoin(client: Client, options: { name?: string }) {
    console.log("player joined");
    const name = options.name ?? `Player_${client.sessionId.slice(0, 4)}`;
    this.players.set(client.sessionId, { name });

    this.broadcast("chat", {
      playerId: "system",
      name: "System",
      text: `${name} joined the game.`,
      timestamp: Date.now(),
    }, { except: client });
  }

  onLeave(client: Client) {
    const name = this.players.get(client.sessionId)?.name ?? "Unknown";
    this.players.delete(client.sessionId);

    this.broadcast("chat", {
      playerId: "system",
      name: "System",
      text: `${name} left the game.`,
      timestamp: Date.now(),
    });
  }
}