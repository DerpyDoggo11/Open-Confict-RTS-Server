import { Room, Client } from "colyseus";

interface PlayerInfo {
  name: string;
}

export class GameRoom extends Room {
  maxClients = 2;
  private players: Map<string, PlayerInfo> = new Map();
  private gameDuration = 480; 
  private intermissionDuration = 15; 
  private timeRemaining = this.gameDuration;
  private timerInterval: ReturnType<typeof setInterval> | null = null;

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

    this.onMessage("ready", (client) => {
      // optional: handle ready state per player
    });
  }

  onJoin(client: Client, options: { name?: string }) {
    const name = options.name ?? `Player_${client.sessionId.slice(0, 4)}`;
    this.players.set(client.sessionId, { name });
    
    setTimeout(() => {
      const count = this.clients.length;
      const max = this.maxClients;
      this.clients.forEach(c => c.send("playerCount", { count, max }));

      if (count >= max && !this.timerInterval) {
        this.startMainTimer();
      }
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

  private startMainTimer() {
    this.timeRemaining = this.gameDuration;

    this.broadcast("gameTick", {
      timeRemaining: this.timeRemaining,
      intermissionDuration: this.intermissionDuration,
      gameDuration: this.gameDuration,
    });

    this.timerInterval = setInterval(() => {
      this.timeRemaining -= 1;

      this.broadcast("gameTick", {
        timeRemaining: this.timeRemaining,
        intermissionDuration: this.intermissionDuration,
        gameDuration: this.gameDuration,
      });

      if (this.timeRemaining <= this.intermissionDuration) {
        this.broadcast("gameStart", {});
      } else if (this.timeRemaining <= 0) {
        this.stopMainTimer();
        // stop game here
      }
    }, 1000);
  }

  private stopMainTimer() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  onLeave(client: Client) {
    const name = this.players.get(client.sessionId)?.name ?? "Unknown";
    this.players.delete(client.sessionId);

    this.stopMainTimer();
    this.unlock();

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

  onDispose() {
    this.stopMainTimer();
  }
}