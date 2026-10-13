// Entry point: builds the shared-world transport the game talks to (hub), and the
// page's own world-wide feature on top of it: the player census.
//   ?net=local    tabs of this browser (BroadcastChannel), for testing without internet
//   (default)     browsers anywhere (WebRTC through Trystero), no server of ours
//   ?room=name    which world to join; everyone in the same one shares it
//
// Layers, bottom up: discovery networks -> one union (multi_network) ->
// relaying across strict NATs (mesh_room) -> zones and bridges (world_topology),
// which finds seats through a seat board on public MQTT brokers (board.js).
import { localNetwork } from './local.js';
import { trysteroNetworks } from './trystero.js';
import { multiNetwork } from './multi_network.js';
import { meshNetwork } from './mesh_room.js';
import { WorldTopology } from './world_topology.js';
import { mqttBoard, NO_BOARD } from './board.js';
import { MetaChannel } from './meta_channel.js';
import { Census } from './census.js';
import { worldName } from './world_epoch.js';
import { PeerHub } from './peer_hub.js';

const APP_ID = 'sm64coopdx-web';

// How long a freshly joined room takes to show its members on each network
const SETTLE_MS = { local: 500, trystero: 4000 };

export async function startPeerTransport(params = new URLSearchParams(location.search)) {
  const local = params.get('net') === 'local';
  const world = worldName(params.get('room') || 'world');
  const [networks, board] = await Promise.all([
    local ? [localNetwork(APP_ID)] : trysteroNetworks(APP_ID),
    local ? NO_BOARD : mqttBoard(`${APP_ID}/seats`),
  ]);
  const joinRoom = meshNetwork(multiNetwork(networks));
  const topology = new WorldTopology(joinRoom, world, {
    settleMs: local ? SETTLE_MS.local : SETTLE_MS.trystero,
    board,
  });
  // the hub is what pages hand the game; the census rides on it, so a page cached
  // from before it existed still gets a working hub
  const hub = new PeerHub(topology);
  hub.census = new Census(topology, new MetaChannel(topology));
  return hub;
}
