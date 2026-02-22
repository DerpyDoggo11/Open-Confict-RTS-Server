import { Room, Client } from "colyseus";
import { Schema, type, ArraySchema } from "@colyseus/schema";

class Message extends Schema {
  @type("string") sender: string = "";
  @type("string") text: string = "";
}

class ChatState extends Schema {
  @type([Message]) messages = new ArraySchema<Message>();
}

export class ChatRoom extends Room {
  state!: ChatState;

  onCreate(options: any) {
    this.setState(new ChatState());

    this.onMessage("chat", (client, data: { text: string }) => {
      const msg = new Message();
      msg.sender = client.sessionId;
      msg.text = data.text;
      this.state.messages.push(msg);
    });
  }

  onJoin(client: Client) {
    console.log(client.sessionId, "joined");
  }

  onLeave(client: Client) {
    console.log(client.sessionId, "left");
  }
}