import { Room, Client } from "colyseus";

interface PlayerInfo {
  name: string;
}

export class GameRoom extends Room {
  maxClients = 2;
  private players: Map<string, PlayerInfo> = new Map();

  onCreate() {
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
    const name = options.name ?? `Player_${client.sessionId.slice(0, 4)}`;
    this.players.set(client.sessionId, { name });

    setTimeout(() => {
      const count = this.clients.length;
      const max = this.maxClients;
      this.clients.forEach(c => c.send("playerCount", { count, max }));
    }, 50);

    this.broadcast("chat", {
      playerId: "system",
      name: "System",
      text: `${name} joined the game.`,
      timestamp: Date.now(),
    }, { except: client });

    if (this.clients.length >= this.maxClients) {
      this.lock();
    }
  }

  onLeave(client: Client) {
    const name = this.players.get(client.sessionId)?.name ?? "Unknown";
    this.players.delete(client.sessionId);

    const count = this.clients.length;
    const max = this.maxClients;
    this.clients.forEach(c => c.send("playerCount", { count, max }));

    this.broadcast("chat", {
      playerId: "system",
      name: "System",
      text: `${name} left the game.`,
      timestamp: Date.now(),
    });
  }
}