// Rooms: the only thing the topology needs from a network.
//
// A room is a named group whose members discover each other and exchange bytes:
//   room.selfId                      my id (the same in every room)
//   room.peers()                     ids of the members I'm connected to
//   room.send(bytes, to?)            to one member, or all when `to` is omitted
//   room.leave()
//   room.onPeerJoin  = id => {}
//   room.onPeerLeave = id => {}
//   room.onMessage   = (bytes, fromId) => {}
//
// A network is a factory: joinRoom(name) -> room. Implementations:
//   local.js     BroadcastChannel between tabs of one browser (testing)
//   trystero.js  WebRTC between browsers, found through public relays

export class RoomBase {
  constructor(selfId) {
    this.selfId = selfId;
    this.onPeerJoin = () => {};
    this.onPeerLeave = () => {};
    this.onMessage = () => {};
  }
}

// Wraps a room constructor into a network that leaves every open room when the page goes away.
export function networkOf(createRoom) {
  const open = new Set();
  globalThis.addEventListener?.('pagehide', () => [...open].forEach(room => room.leave()));
  return name => {
    const room = createRoom(name);
    const leave = room.leave.bind(room);
    room.leave = () => { open.delete(room); leave(); };
    open.add(room);
    return room;
  };
}
