// Voice chat, opted into twice: talking sends my microphone, listening plays others'.
// It's by proximity, as in the game: my voice goes only to roommates who listen and
// are close to me in the game, the nearest few at most (so a phone uploads a handful
// of streams, not thirty), and what I hear fades with distance.
//   distanceOf(id)  game units between my character and that roommate's, -1 if not near me
//   isBlocked(id)   players I blocked neither hear me nor are heard
import { every } from './ticker.js';

const DEFAULTS = {
  hearRange: 6000,      // game units (Mario is about 160 tall)
  fullVolumeRange: 1500,
  keepRange: 1.25,      // a listener I already send to keeps it until a bit further: no flapping at the edge
  maxListeners: 6,
  updateMs: 500,
};

// A function reading how loud `node` is right now, 0..1
function meterOn(context, node) {
  const analyser = context.createAnalyser();
  analyser.fftSize = 256;
  node.connect(analyser);
  const samples = new Float32Array(analyser.fftSize);
  return () => {
    analyser.getFloatTimeDomainData(samples);
    let sum = 0;
    for (const sample of samples) sum += sample * sample;
    return Math.min(1, Math.sqrt(sum / samples.length) * 4);
  };
}

const MIC = { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } };

export class VoiceChat {
  constructor(topology, roster, { distanceOf, isBlocked }, options = {}) {
    this.topology = topology;
    this.roster = roster;
    this.distanceOf = distanceOf;
    this.isBlocked = isBlocked;
    this.options = { ...DEFAULTS, ...options };
    this.mic = null;
    this.sendingTo = new Set();
    this.incoming = new Map(); // id -> { element, source, gain, meter }
    this.micMeter = null;
    this.context = null;

    topology.onZoneStream = (stream, id) => this.received(stream, id);
    topology.addPeerLeaveListener(id => { this.dropIncoming(id); this.sendingTo.delete(id); });
    this.stopUpdates = every(this.options.updateMs, () => this.update());
  }

  get talking() { return this.mic !== null; }
  get listening() { return this.roster.mine.listening; }

  // Both start from a tap: browsers allow the microphone and sound only then
  async startTalking() {
    if (this.mic) return;
    this.mic = await navigator.mediaDevices.getUserMedia(MIC);
    this.micSource = this.audio().createMediaStreamSource(this.mic);
    this.micMeter = meterOn(this.context, this.micSource);
    this.roster.setMine({ talking: true });
    this.update();
  }

  stopTalking() {
    if (!this.mic) return;
    this.sendingTo.forEach(id => this.topology.removeZoneStream(this.mic, id));
    this.sendingTo.clear();
    this.mic.getTracks().forEach(track => track.stop());
    this.micSource.disconnect();
    this.mic = this.micSource = this.micMeter = null;
    this.roster.setMine({ talking: false });
  }

  startListening() {
    this.audio();
    this.roster.setMine({ listening: true });
    this.update();
  }

  stopListening() {
    this.roster.setMine({ listening: false });
    this.update();
  }

  audio() {
    this.context ??= new AudioContext();
    if (this.context.state !== 'running') this.context.resume().catch(() => {});
    return this.context;
  }

  update() {
    this.updateSending();
    this.updateVolumes();
  }

  // Send to the nearest listeners in range; stop for those who left it
  updateSending() {
    if (!this.mic) return;
    const { hearRange, keepRange, maxListeners } = this.options;
    const wanted = new Set([...this.roster.players]
      .filter(([id, player]) => player.listening && !this.isBlocked(id))
      .map(([id]) => [id, this.distanceOf(id)])
      .filter(([id, distance]) => distance >= 0 && distance <= hearRange * (this.sendingTo.has(id) ? keepRange : 1))
      .sort((a, b) => a[1] - b[1])
      .slice(0, maxListeners)
      .map(([id]) => id));
    for (const id of this.sendingTo) {
      if (!wanted.has(id)) { this.topology.removeZoneStream(this.mic, id); this.sendingTo.delete(id); }
    }
    for (const id of wanted) {
      if (!this.sendingTo.has(id)) { this.topology.addZoneStream(this.mic, id); this.sendingTo.add(id); }
    }
  }

  received(stream, id) {
    this.dropIncoming(id);
    const context = this.audio();
    // Chrome feeds a remote stream to Web Audio only while a media element plays it
    const element = new Audio();
    element.muted = true;
    element.srcObject = stream;
    element.play().catch(() => {});
    const source = context.createMediaStreamSource(stream);
    const gain = context.createGain();
    gain.gain.value = 0;
    source.connect(gain).connect(context.destination);
    this.incoming.set(id, { element, source, gain, meter: meterOn(context, gain) });
    this.updateVolumes();
  }

  dropIncoming(id) {
    const voice = this.incoming.get(id);
    if (!voice) return;
    voice.source.disconnect();
    voice.gain.disconnect();
    voice.element.srcObject = null;
    this.incoming.delete(id);
  }

  // How loud (0..1) a roommate sounds to me right now, and my own microphone
  levelOf(id) { return this.incoming.get(id)?.meter() ?? 0; }
  myLevel() { return this.micMeter?.() ?? 0; }

  // Where a roommate's voice stands, for the players list:
  //   off      their microphone is off        far      on, but too far to be heard here
  //   waiting  on and near, no audio yet      audio    their audio reaches me
  statusOf(id) {
    if (this.incoming.has(id) && this.volumeFor(id) > 0) return 'audio';
    if (!this.roster.players.get(id)?.talking) return 'off';
    const distance = this.distanceOf(id);
    if (distance < 0 || distance > this.options.hearRange) return 'far';
    return 'waiting';
  }

  volumeFor(id) {
    if (!this.listening || this.isBlocked(id)) return 0;
    const { hearRange, fullVolumeRange } = this.options;
    const distance = this.distanceOf(id);
    if (distance < 0 || distance > hearRange) return 0;
    return distance <= fullVolumeRange ? 1 : 1 - (distance - fullVolumeRange) / (hearRange - fullVolumeRange);
  }

  updateVolumes() {
    for (const [id, voice] of this.incoming) voice.gain.gain.setTargetAtTime(this.volumeFor(id), this.context.currentTime, 0.1);
  }
}
