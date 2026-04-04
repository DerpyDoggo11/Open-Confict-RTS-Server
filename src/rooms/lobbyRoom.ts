import { Room, Client } from "colyseus";
import { matchMaker } from "colyseus";
import { LobbyState, PlayerLobbyState } from "../server/schema.js";

export class LobbyRoom extends Room {
  maxClients = 2;
  private countdownTimer: ReturnType<typeof setTimeout> | null = null;

  get lobbyState(): LobbyState { return this.state as LobbyState; }

  onCreate(options: { serverIndex?: number }) {
    this.setState(new LobbyState());
    this.setMetadata({ serverIndex: options.serverIndex ?? 0 });

    this.onMessage("voteMap", (client, msg: { mapId: string }) => {
      const player = this.lobbyState.players.get(client.sessionId);
      if (!player) return;
      player.votedMap = msg.mapId;
      this.updateWinningMap();
    });
  }

  onJoin(client: Client, options: { name?: string }) {
    const p = new PlayerLobbyState();
    p.name = options.name ?? `Player_${client.sessionId.slice(0, 4)}`;
    this.lobbyState.players.set(client.sessionId, p);

    if (this.clients.length >= this.maxClients) {
      this.lock();
      this.startCountdown();
    }
  }

  onLeave(client: Client) {
    this.lobbyState.players.delete(client.sessionId);
    this.cancelCountdown();
    this.unlock();
  }

  onDispose() {
    this.cancelCountdown();
  }

  private startCountdown() {
    this.cancelCountdown();
    this.countdownTimer = setTimeout(() => this.launchGame(), 5_000);
  }

  private cancelCountdown() {
    if (this.countdownTimer) {
      clearTimeout(this.countdownTimer);
      this.countdownTimer = null;
    }
  }

  private async launchGame() {
    try {
      const reservation = await matchMaker.createRoom("game_room", {});
      this.broadcast("startGame", {
        roomId: reservation.roomId,
        map: this.lobbyState.winningMap,
      });
      setTimeout(() => this.disconnect(), 3_000);
    } catch (e) {
      console.error("[LobbyRoom] Failed to create game room:", e);
    }
  }

  private updateWinningMap() {
    const tally: Record<string, number> = {};
    this.lobbyState.players.forEach((p: PlayerLobbyState) => {
      if (p.votedMap) tally[p.votedMap] = (tally[p.votedMap] ?? 0) + 1;
    });
    let winner = "";
    let best = 0;
    for (const [map, count] of Object.entries(tally)) {
      if (count > best) { winner = map; best = count; }
    }
    this.lobbyState.winningMap = winner;
  }
}