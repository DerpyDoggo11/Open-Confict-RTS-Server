import { Room, Client } from "colyseus";
import { GameState, TroopState } from "../server/schema.js";

interface PlayerInfo {
  name: string;
}

export class GameRoom extends Room {
  maxClients = 2;
  state = new GameState();
  private players: Map<string, PlayerInfo> = new Map();
  private gameDuration = 480;
  private intermissionDuration = 15;
  private timeRemaining = this.gameDuration;
  private timerInterval: ReturnType<typeof setInterval> | null = null;

  onCreate() {
    this.setState(new GameState());

    this.onMessage("chat", (client, message: { text: string }) => {
      const name = this.players.get(client.sessionId)?.name ?? "Unknown";
      this.broadcast("chat", {
        playerId: client.sessionId,
        name,
        text: message.text.slice(0, 200),
        timestamp: Date.now(),
      });
    });

    this.onMessage("spawnTroop", (client, msg: {
      id: string; type: string; tileX: number; tileY: number; health: number;
    }) => {
      const troop = new TroopState();
      troop.id = msg.id;
      troop.type = msg.type;
      troop.tileX = msg.tileX;
      troop.tileY = msg.tileY;
      troop.health = msg.health;
      troop.ownerId = client.sessionId;
      this.state.troops.set(msg.id, troop);
    });

    // Client moves a troop
    this.onMessage("moveTroop", (client, msg: {
      id: string; tileX: number; tileY: number;
    }) => {
      const troop = this.state.troops.get(msg.id);
      if (!troop || troop.ownerId !== client.sessionId) return;
      troop.tileX = msg.tileX;
      troop.tileY = msg.tileY;
    });

    // Client attacks with a troop
    this.onMessage("attackTroop", (client, msg: {
      attackerId: string; targetId: string; damage: number;
    }) => {
      const attacker = this.state.troops.get(msg.attackerId);
      const target = this.state.troops.get(msg.targetId);
      if (!attacker || attacker.ownerId !== client.sessionId) return;
      if (!target) return;

      target.health = Math.max(0, target.health - msg.damage);

      if (target.health <= 0) {
        this.state.troops.delete(msg.targetId);
        this.broadcast("troopDied", { id: msg.targetId });
      }
    });

    this.onMessage("ready", () => {});
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
      playerId: "system", name: "System",
      text: `${name} joined the game.`,
      timestamp: Date.now(),
    }, { except: client });

    if (this.clients.length >= this.maxClients) this.lock();
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
      if (this.timeRemaining === this.intermissionDuration) {
        this.broadcast("gameStart", {});
      } else if (this.timeRemaining <= 0) {
        this.stopMainTimer();
      }
    }, 1000);
  }

  private stopMainTimer() {
    if (this.timerInterval) { clearInterval(this.timerInterval); this.timerInterval = null; }
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
      playerId: "system", name: "System",
      text: `${name} left the game.`,
      timestamp: Date.now(),
    });
  }

  onDispose() { this.stopMainTimer(); }
}