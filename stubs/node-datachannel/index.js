// Stub for node-datachannel native addon.
// Disables WebRTC peer connections — regular BitTorrent over TCP/UDP works normally.

class Noop {
  constructor() {}
}

const stub = {
  preload() {},
  cleanup() {},
  initLogger() {},
  setSctpSettings() {},
  getLibraryVersion() { return '0.0.0-stub' },
  PeerConnection: Noop,
  DataChannel: Noop,
  Track: Noop,
  Audio: Noop,
  Video: Noop,
  IceUdpMuxListener: Noop,
  RtpPacketizationConfig: Noop,
  PacingHandler: Noop,
  RtcpReceivingSession: Noop,
  RtcpNackResponder: Noop,
}

export default stub
