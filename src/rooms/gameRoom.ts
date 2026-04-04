import { Room, Client } from "colyseus";
import { GameState, TroopState } from "../server/schema.js";

interface PlayerInfo {
  name: string;
  team: "blue" | "red";
}

export class GameRoom extends Room {
  maxClients = 2;
  state = new GameState();
  private players: Map<string, PlayerInfo> = new Map();
  private gameDuration = 480;
  private intermissionDuration = 60;
  private timeRemaining = this.gameDuration;
  private timerInterval: ReturnType<typeof setInterval> | null = null;
  private readyPlayers: Set<string> = new Set();
  private readyStateListeners: ((readyCount: number, totalCount: number) => void)[] = [];

  onCreate() {
    this.setState(new GameState());
    this.setMetadata({ startedAt: Date.now() });
    
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

    this.onMessage("moveTroop", (client, msg: {
      id: string; tileX: number; tileY: number;
    }) => {
      const troop = this.state.troops.get(msg.id);
      if (!troop || troop.ownerId !== client.sessionId) return;
      troop.tileX = msg.tileX;
      troop.tileY = msg.tileY;
    });

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

    this.onMessage("ready", (client, msg: { isReady: boolean }) => {
      if (msg.isReady) {
        this.readyPlayers.add(client.sessionId);
      } else {
        this.readyPlayers.delete(client.sessionId);
      }

      this.broadcast("playerReady", {
        readyCount: this.readyPlayers.size,
        totalCount: this.clients.length,
      });

      const inIntermission = this.timeRemaining > this.intermissionDuration;
      if (inIntermission && this.readyPlayers.size >= this.clients.length) {
        this.broadcast("gameStart", {});
      }
    });
  }

  onJoin(client: Client, options: { name?: string }) {
    const name = options.name ?? `Player_${client.sessionId.slice(0, 4)}`;

    const blueCount = Array.from(this.players.values()).filter(p => p.team === "blue").length;
    const redCount = Array.from(this.players.values()).filter(p => p.team === "red").length;

    let team: "blue" | "red";

    if (blueCount === 0 && redCount === 0) {
      team = Math.random() < 0.5 ? "blue" : "red";
    } else {
      team = blueCount <= redCount ? "blue" : "red";
    }

    this.players.set(client.sessionId, { name, team });

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

    this.broadcastTeams();

    if (this.clients.length >= this.maxClients) this.lock();
  }

  onLeave(client: Client) {
    const name = this.players.get(client.sessionId)?.name ?? "Unknown";
    this.players.delete(client.sessionId);
    this.stopMainTimer();
    this.unlock();
    const count = this.clients.length;
    const max = this.maxClients;
    this.clients.forEach(c => c.send("playerCount", { count, max }));
    this.readyPlayers.delete(client.sessionId);
    
    this.broadcast("chat", {
      playerId: "system", name: "System",
      text: `${name} left the game.`,
      timestamp: Date.now(),
    });

    this.broadcastTeams();
  }

  private broadcastTeams() {
    const teams = [
      {
        teamName: "Blue",
        players: Array.from(this.players.entries())
          .filter(([_, p]) => p.team === "blue")
          .map(([id, p]) => ({ id, name: p.name })),
      },
      {
        teamName: "Red",
        players: Array.from(this.players.entries())
          .filter(([_, p]) => p.team === "red")
          .map(([id, p]) => ({ id, name: p.name })),
      },
    ];

    this.broadcast("playersUpdate", teams);
  }


  onReadyStateChange(fn: (readyCount: number, totalCount: number) => void) {
    this.readyStateListeners.push(fn);
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


  onDispose() { this.stopMainTimer(); }
}