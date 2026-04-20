import { Room, Client } from "colyseus";
import { GameState, TroopState } from "../server/schema.js";

interface PlayerInfo {
  name: string;
  team: "blue" | "red";
}

interface TroopExtra {
  facingDx: number;
  facingDy: number;
}

export class GameRoom extends Room {
  maxClients = 10;
  state = new GameState();
  private players: Map<string, PlayerInfo> = new Map();
  private spectators: Set<string> = new Set();
  private troopExtras: Map<string, TroopExtra> = new Map();
  private gameDuration = 480;
  private intermissionDuration = 60;
  private timeRemaining = this.gameDuration;
  private timerInterval: ReturnType<typeof setInterval> | null = null;
  private readyPlayers: Set<string> = new Set();
  private readyStateListeners: ((readyCount: number, totalCount: number) => void)[] = [];
  private maxPlayers = 2;

  onCreate(options: { map?: string }) {
    this.setState(new GameState());
    const map = options.map;
    this.setMetadata({ startedAt: Date.now(), map });

    this.onMessage("getMap", (client) => {
      client.send("mapInfo", { map });
    });

    this.onMessage("chat", (client, message: { text: string }) => {
      const isSpectator = this.spectators.has(client.sessionId);
      const name = isSpectator
        ? `[Spectator] ${client.sessionId.slice(0, 4)}`
        : (this.players.get(client.sessionId)?.name ?? "Unknown");
      this.broadcast("chat", {
        playerId: client.sessionId,
        name,
        text: message.text.slice(0, 200),
        timestamp: Date.now(),
      });
    });

    this.onMessage("spawnTroop", (client, msg: {
      id: string; type: string; tileX: number; tileY: number;
      health: number; facingDx?: number; facingDy?: number;
    }) => {
      if (this.spectators.has(client.sessionId)) return;
      const troop = new TroopState();
      troop.id = msg.id;
      troop.type = msg.type;
      troop.tileX = msg.tileX;
      troop.tileY = msg.tileY;
      troop.health = msg.health;
      troop.ownerId = client.sessionId;
      this.state.troops.set(msg.id, troop);

      this.troopExtras.set(msg.id, {
        facingDx: msg.facingDx ?? 1,
        facingDy: msg.facingDy ?? 1,
      });
    });

    this.onMessage("moveTroop", (client, msg: {
      id: string; tileX: number; tileY: number;
    }) => {
      if (this.spectators.has(client.sessionId)) return;
      const troop = this.state.troops.get(msg.id);
      if (!troop || troop.ownerId !== client.sessionId) return;

      const dx = msg.tileX - troop.tileX;
      const dy = msg.tileY - troop.tileY;
      if (dx !== 0 || dy !== 0) {
        const extra = this.troopExtras.get(msg.id);
        if (extra) {
          extra.facingDx = Math.sign(dx);
          extra.facingDy = Math.sign(dy);
        }
      }

      troop.tileX = msg.tileX;
      troop.tileY = msg.tileY;
    });

    this.onMessage("attackTroop", (client, msg: {
      attackerId: string; targetId: string; damage: number;
    }) => {
      if (this.spectators.has(client.sessionId)) return;
      const attacker = this.state.troops.get(msg.attackerId);
      const target = this.state.troops.get(msg.targetId);
      if (!attacker || attacker.ownerId !== client.sessionId) return;
      if (!target) return;

      target.health = Math.max(0, target.health - msg.damage);

      if (target.health <= 0) {
        this.state.troops.delete(msg.targetId);
        this.troopExtras.delete(msg.targetId);
        this.broadcast("troopDied", { id: msg.targetId });
      }
    });

    this.onMessage("attackTile", (client, msg: {
      attackerId: string; targetTileX: number; targetTileY: number;
      damage: number; fireRate?: number; splashRadius?: number;
    }) => {
      if (this.spectators.has(client.sessionId)) return;
      this.handleAttackTile(client, msg);
    });

    this.onMessage("splashAttackTile", (client, msg: {
      attackerId: string;
      targetTileX: number; targetTileY: number;
      damage: number;
      fireRate?: number;
      splashRadius: number;
    }) => {
      if (this.spectators.has(client.sessionId)) return;
      this.handleAttackTile(client, msg);
    });

    this.onMessage("ready", (client, msg: { isReady: boolean }) => {
      if (this.spectators.has(client.sessionId)) return;

      if (msg.isReady) {
        this.readyPlayers.add(client.sessionId);
      } else {
        this.readyPlayers.delete(client.sessionId);
      }

      const playerCount = this.players.size;
      this.broadcast("playerReady", {
        readyCount: this.readyPlayers.size,
        totalCount: playerCount,
      });

      const inIntermission = this.timeRemaining > this.intermissionDuration;
      if (inIntermission && this.readyPlayers.size >= playerCount) {
        this.broadcast("gameStart", {});
      }
    });
  }

  private handleAttackTile(client: Client, msg: {
    attackerId: string;
    targetTileX: number;
    targetTileY: number;
    damage: number;
    fireRate?: number;
    splashRadius?: number;
  }) {
    const attacker = this.state.troops.get(msg.attackerId);
    if (!attacker || attacker.ownerId !== client.sessionId) return;

    const adx = msg.targetTileX - attacker.tileX;
    const ady = msg.targetTileY - attacker.tileY;
    if (adx !== 0 || ady !== 0) {
      const extra = this.troopExtras.get(msg.attackerId);
      if (extra) {
        extra.facingDx = Math.sign(adx);
        extra.facingDy = Math.sign(ady);
      }
    }

    const shots = Math.max(1, msg.fireRate ?? 1);
    const splashRadius = Math.max(1, Math.min(20, (msg.splashRadius ?? 1) | 0));
    const totalBase = msg.damage * shots;

    const hits: { id: string; troop: TroopState; scaled: number }[] = [];
    this.state.troops.forEach((troop, id) => {
      if (troop.ownerId === attacker.ownerId) return;
      if (troop.health <= 0) return;

      const dist = Math.abs(troop.tileX - msg.targetTileX)
                 + Math.abs(troop.tileY - msg.targetTileY);
      if (dist >= splashRadius) return;

      const falloff = (splashRadius - dist) / splashRadius;
      const scaled = Math.round(totalBase * falloff);
      if (scaled <= 0) return;

      hits.push({ id, troop, scaled });
    });

    const victims: { id: string; newHealth: number; totalDamage: number }[] = [];
    const deaths: string[] = [];
    for (const { id, troop, scaled } of hits) {
      troop.health = Math.max(0, troop.health - scaled);
      victims.push({ id, newHealth: troop.health, totalDamage: scaled });
      if (troop.health <= 0) deaths.push(id);
    }

    this.broadcast("splashDamage", {
      attackerId: msg.attackerId,
      targetTileX: msg.targetTileX,
      targetTileY: msg.targetTileY,
      shots,
      projectileDamage: msg.damage,
      victims,
    });

    for (const id of deaths) {
      this.state.troops.delete(id);
      this.troopExtras.delete(id);
      this.broadcast("troopDied", { id });
    }
  }

  private buildTroopSnapshot(): {
    id: string; type: string; tileX: number; tileY: number;
    health: number; ownerId: string; facingDx: number; facingDy: number;
  }[] {
    const snapshot: any[] = [];
    this.state.troops.forEach((troop, id) => {
      const extra = this.troopExtras.get(id);
      snapshot.push({
        id,
        type: troop.type,
        tileX: troop.tileX,
        tileY: troop.tileY,
        health: troop.health,
        ownerId: troop.ownerId,
        facingDx: extra?.facingDx ?? 1,
        facingDy: extra?.facingDy ?? 1,
      });
    });
    return snapshot;
  }

  onJoin(client: Client, options: { name?: string; spectate?: boolean }) {
    const name = options.name ?? `Player_${client.sessionId.slice(0, 4)}`;
    const isSpectator = options.spectate === true || this.players.size >= this.maxPlayers;

    if (isSpectator) {
      this.spectators.add(client.sessionId);
      client.send("assignRole", { role: "spectator" });

      const snapshot = this.buildTroopSnapshot();
      if (snapshot.length > 0) {
        client.send("troopSnapshot", { troops: snapshot });
      }

      this.broadcast("chat", {
        playerId: "system", name: "System",
        text: `${name} is now spectating.`,
        timestamp: Date.now(),
      });

      this.broadcastTeams();
      return;
    }

    const blueCount = Array.from(this.players.values()).filter(p => p.team === "blue").length;
    const redCount = Array.from(this.players.values()).filter(p => p.team === "red").length;

    let team: "blue" | "red";
    if (blueCount === 0 && redCount === 0) {
      team = Math.random() < 0.5 ? "blue" : "red";
    } else {
      team = blueCount <= redCount ? "blue" : "red";
    }

    this.players.set(client.sessionId, { name, team });
    client.send("assignRole", { role: "player", team });

    setTimeout(() => {
      const playerCount = this.players.size;
      const max = this.maxPlayers;
      this.clients.forEach(c => c.send("playerCount", { count: playerCount, max }));
      if (playerCount >= max && !this.timerInterval) {
        this.startMainTimer();
      }
    }, 50);

    this.broadcast("chat", {
      playerId: "system", name: "System",
      text: `${name} joined the game.`,
      timestamp: Date.now(),
    }, { except: client });

    this.broadcastTeams();
  }

  onLeave(client: Client) {
    if (this.spectators.has(client.sessionId)) {
      this.spectators.delete(client.sessionId);
      this.broadcast("chat", {
        playerId: "system", name: "System",
        text: `A spectator left.`,
        timestamp: Date.now(),
      });
      return;
    }

    const name = this.players.get(client.sessionId)?.name ?? "Unknown";
    this.players.delete(client.sessionId);
    this.readyPlayers.delete(client.sessionId);

    if (this.players.size < this.maxPlayers) {
      this.stopMainTimer();
    }

    const playerCount = this.players.size;
    const max = this.maxPlayers;
    this.clients.forEach(c => c.send("playerCount", { count: playerCount, max }));

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