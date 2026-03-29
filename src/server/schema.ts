import { Schema, MapSchema, type } from "@colyseus/schema";

export class TroopState extends Schema {
  @type("string") id: string = "";
  @type("string") type: string = "";
  @type("number") tileX: number = 0;
  @type("number") tileY: number = 0;
  @type("number") health: number = 100;
  @type("string") ownerId: string = "";
}

export class GameState extends Schema {
  @type({ map: TroopState }) troops = new MapSchema<TroopState>();
}

export class PlayerLobbyState extends Schema {
  @type("string") name: string = "";
  @type("boolean") isReady: boolean = false;
  @type("string")  votedMap: string = "";
}

export class LobbyState extends Schema {
  @type({ map: PlayerLobbyState}) players = new MapSchema<PlayerLobbyState>();
  @type("string") winningMap = "";
}