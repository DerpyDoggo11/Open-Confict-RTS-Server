import { Room, Client } from "colyseus";
import { matchMaker } from "colyseus";
import { LobbyState, PlayerLobbyState } from "../server/schema.js";

export class LobbyRoom extends Room {
  maxClients = 2;

  get lobbyState(): LobbyState { return this.state as LobbyState; }

  onCreate(options: { serverIndex?: number }) {
    this.setState(new LobbyState());
    this.setMetadata({ serverIndex: options.serverIndex ?? 0 });

    this.onMessage("setReady", (client, msg: { isReady: boolean }) => {
      const player = this.lobbyState.players.get(client.sessionId);
      if (!player) return;
      player.isReady = msg.isReady;
      this.checkAllReady();
    });

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
    if (this.clients.length >= this.maxClients) this.lock();
  }

  onLeave(client: Client) {
    const player = this.lobbyState.players.get(client.sessionId);
    if (player) player.isReady = false;
    this.lobbyState.players.delete(client.sessionId);
    this.unlock();
  }

  onDispose() {}

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

  private async checkAllReady() {
    if (this.clients.length < this.maxClients) return;
    const allReady = Array.from(this.lobbyState.players.values())
      .every((p: unknown) => (p as PlayerLobbyState).isReady);
    if (!allReady) return;
    try {
      const reservation = await matchMaker.createRoom("game_room", {});
      this.broadcast("startGame", { roomId: reservation.roomId, map: this.lobbyState.winningMap });
      setTimeout(() => this.disconnect(), 3000);
    } catch (e) {
      console.error("[LobbyRoom] Failed to create game room:", e);
    }
  }
}