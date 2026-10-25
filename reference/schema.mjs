// Wire-protocol schema — the SINGLE SOURCE OF TRUTH for the binary contract
// shared by the C++ server (server/protocol.cpp, command_registry.cpp) and the
// TypeScript client (client/src/net.ts). Both sides used to hand-mirror these
// numbers; a reorder or offset drift silently corrupted every peer's decode.
//
// Edit THIS file, then run `npm run gen:protocol` (from client/) to regenerate:
//   - client/src/protocol.gen.ts
//   - server/protocol_gen.h
// Both generated files are committed; CI/verify re-runs the generator and fails
// if they are stale. Never edit the generated files by hand.
//
// JSON `hello` + the ~110 JSON commands stay JSON (debuggable, cold path); only
// the hot binary channels live here.

export const schema = {
  // Bumped on any wire-layout change. Client refuses to run against a server
  // with a different value (hard disconnect), since the record layout may differ.
  // v3: appended linear velocity (mm/s i16 x3) to the object record.
  // v4: `move` (drag grab-target) moved from JSON to binary tag 6 — an old
  //     server would silently drop the frames, so the version gate must trip.
  // v5: keyframe/delta carry a TRAILING u32 server sim-time (ms since server
  //     start, wraps at ~49 days). The client interpolates object motion on the
  //     server's simulation timeline instead of packet-arrival time — arrival
  //     jitter (OS timer + network) no longer modulates playback speed.
  //     Appended at the END of the message (after the records / removed ids) so
  //     the tools' front-to-back record parsers keep working unmodified.
  // v6: object-record positions quantize at 0.1 mm (scale.recPos), range
  //     ±3.2767 m. Physics keeps stacked cards ~1.5-2 mm apart (2 mm thickness
  //     minus the 0.3 mm penetration slop), but the old 1 mm quantum collapsed
  //     those separations — cards in a pile rendered at identical heights and
  //     z-fought. Only the record layout changes scale; the move/presence/
  //     drawlive channels stay at 1 mm (scale.pos).
  // v7: `move` gains a u16 seq after the object id (13-byte frame). The move
  //     stream rides the unreliable UNORDERED data channel; seq is a
  //     per-connection monotonic counter (wrap-around compared, signed-i16
  //     window) so the server can drop a reordered datagram instead of
  //     stepping the grab target BACKWARD — the backward step reversed the
  //     grab-spring velocity for a tick, and that spike rode the broadcast
  //     into every client's extrapolation as a direction-change jerk.
  // v8: new server->client tag `lookahead` (throw lookahead bursts, see
  //     docs/lag-lookahead-analysis.md §3): u8 tag | u8 sections | per section
  //     [u16 count | count×records | u32 simMs] — record layout unchanged, but
  //     the stamps are FUTURE sim times (a scratch forward-simulation of the
  //     throw), so an old client must not feed them to its clock trackers —
  //     version-gate rather than risk it.
  // v9: two additions.
  //   (a) the object record appends 3×i16 ANGULAR velocity (rad/s, scale.avel)
  //       after the linear velocity — 29→35 bytes. ω is the dominant state of a
  //       rolling die / flipping coin, and it was NOT on the wire: the client
  //       could only finite-difference it from the i16-quantized quats of two
  //       ring slots (noisy, and zero if the ring underran to one slot), so a
  //       die tumbling through a stream hole extrapolated the wrong spin and
  //       snapped on resume. Sleeping bodies report ~0 (quantizes to 0), so a
  //       resting record stays byte-identical and out of the delta set — only
  //       genuinely spinning objects pay the 6 bytes.
  //   (b) new binary tag `ping` (7), DC hot lane, echoed: the client stamps a
  //       frame and the server bounces it straight back, so the RTT reflects
  //       the UNRELIABLE data-channel path the hot state actually rides — the
  //       old `echo` probe went over the WebSocket (TCP), inflating the RTT
  //       that sizes lagS / the ahead boost / the lookahead horizon.
  // v10: committed strokes ride as DELTAS — JSON `drawing` {drawing} per
  //      commit and `drawingdel` {id} per erase (server/script_bridges.cpp);
  //      the whole-list `drawings` is now only the connect catch-up, a clear
  //      or a restore. A v9 client ignores the two new types and silently
  //      stops seeing new strokes, which is exactly what the gate is for.
  // v11: two changes on the drag path.
  //   (a) new server->client tag `targets` (9): the grab-spring TARGET of every
  //       held object (u16 count | count×{u32 id, 3×i16 recPos} | u32 simMs).
  //       Observers used to see a remote drag only as the server spring's
  //       output, one-way + interp buffer + the spring's own lag (~55 ms)
  //       late; with the target on the wire a client runs the same spring
  //       locally and renders the held piece AHEAD of its buffer (loop.ts
  //       observerCarry). Rides the DC with the record linger, the WS slow lane
  //       for fallback clients; restricted ids are never in it.
  //   (b) `move` (6) becomes MULTI-TARGET: u8 tag | u16 seq | u32 tMs | u8 count
  //       | count×{u32 id, 3×i16 mm}. A 52-card pack drag was 52 datagrams per
  //       tick (~290 KB/s of upstream framing + 52 loop tasks); now one. tMs is
  //       the client's monotonic clock at send time — reserved, the server does
  //       not read it yet. An old client's 13-byte frame fails the length gate.
  // v12: reliability over the unreliable lane. Every delta (2) the data channel
  //      sends carries a TRAILING u16 seq after simMs (0 on the WebSocket's
  //      unsequenced keyframe-topic deltas); the client answers with the new
  //      `ack` tag (10): the newest seq it received + a 64-bit field of the ones
  //      before it, Fiedler-style. From that the server knows WHICH datagrams a
  //      client lost and re-sends the newest record of every object those
  //      carried — instead of the blind 120 ms linger (7 copies of every settle
  //      record) plus a 2 s reliable keyframe being the only recovery, which
  //      left a settle pose stale for up to 2 s after a loss burst (measured:
  //      p50 1.47 s, tools/dcloss_probe.mjs). Acking clients also get the
  //      keyframe insurance at 10 s instead of 2. The trailer follows the same
  //      rule as the v5 stamp: front-to-back record parsers keep working.
  // v13: state frames append generation + visibilityRevision (u32 each).
  // Shared and personal keyframes form an atomic WS baseline on epoch changes;
  // later shared snapshots preserve personal membership. Personal changes use
  // their own reliable delta tag. ACKs carry the same epoch as their datagrams.
  protocolVersion: 13,

  // Binary message tags — byte 0 of every binary frame. Direction noted; 3/4/5
  // share one layout both ways (`player` is 0 on uplink, server-stamped on
  // rebroadcast).
  tags: {
    keyframe: 1,    // server -> client: shared object snapshot
    delta: 2,       // server -> client: changed + removed objects
    presence: 3,    // client -> server: cursor / hover / selection (not rebroadcast)
    drawlive: 4,    // both ways: live in-progress brush/shape stroke
    measurelive: 5, // both ways: live ruler endpoints
    move: 6,        // client -> server: drag grab-targets (see `move` below; multi-target since v11)
    ping: 7,        // client <-> server (DC): RTT probe — u8 tag | f64 client-time; echoed verbatim
    lookahead: 8,   // server -> client (DC only): future-stamped throw-lookahead records
    targets: 9,     // server -> client: held objects' grab-spring targets (see `targets` below)
    ack: 10,        // client -> server (DC): datagram acknowledgement (see `ack` below)
    personalKeyframe: 11, // server -> client (WS): restricted objects visible to this viewer
    personalDelta: 12,    // server -> client (WS): restricted membership/state changes
  },

  // Datagram acknowledgement (tag 10, v12): u8 tag | u16 ack | u64 ackBits |
  // u16 ackDelayMs. `ack` = the newest delta seq received; bit n of `ackBits`
  // = seq (ack − 1 − n) was received too; `ackDelayMs` = how long the client
  // held the ack seq's datagram before answering, so the server's round-trip
  // read excludes it. 64 bits, not 32: a 2000-object all-moving table is five
  // chunks a tick, and 32 would cover ~100 ms.
  ack: { size: 21, off: { ack: 1, bits: 3, delay: 11, generation: 13, visibilityRevision: 17 } },
  stateEpoch: { size: 8 }, // trailing generation:u32, visibilityRevision:u32

  // Drag grab-target uplink (tag 6, v11): u8 tag | u16 seq | u32 tMs | u8 count
  // | count × entry. seq is the per-connection newest-wins guard (v7), shared by
  // every entry of the frame; tMs the client's monotonic ms at send time
  // (reserved). Positions ride at scale.pos (1 mm) like the other uplinks.
  move: { head: 8, entry: 10, off: { id: 0, pos: 4 } },

  // Held-object grab targets (tag 9, v11): u8 tag | u16 count | count × entry |
  // u32 simMs. One entry per held object whose quantized target changed within
  // the linger window (tick.cpp). Positions at scale.recPos (0.1 mm), the same
  // quantum as the records the spring output arrives in.
  targets: { entry: 10, off: { id: 0, pos: 4 } },

  // Object kinds. THE ORDER IS THE WIRE CONTRACT — the index is encoded as the
  // record's `kind` u8. Must match `enum class ObjectKind` in
  // core/include/tableweb/types.h (protocol.cpp static_asserts this at compile
  // time, so a reorder there trips the build instead of corrupting clients).
  kinds: ['die', 'chip', 'coin', 'deck', 'card', 'prop', 'tablet', 'counter', 'clock', 'note'],

  // Draw tools — order is the client-to-client contract for the drawlive tool
  // byte (the server only relays it).
  drawTools: ['pencil', 'marker', 'line', 'arrow', 'rect', 'ellipse', 'eraser'],

  // Object record: fixed 35-byte little-endian layout. `off` = byte offset of
  // each field within one record; `flags` = bit masks in the flags byte.
  // `vel` (linear velocity, mm/s i16 x3) and `avel` (angular velocity, rad/s
  // i16 x3) trail the legacy 23-byte block so the existing offsets are
  // untouched — the client extrapolates on both during a buffer underrun and
  // seeds the throw hand-off from the linear one (see loop.ts / interp.ts).
  // Sleeping bodies report ~0 for both, which quantizes to 0, so a resting
  // object's record is still byte-identical tick to tick and stays out of the
  // delta set.
  record: {
    size: 35,
    off: { id: 0, kind: 4, flags: 5, pos: 6, quat: 12, extra: 20, holder: 21, extra2: 22,
           vel: 23, avel: 29 },
    flags: { sleeping: 1, locked: 2, clickable: 4 },
  },

  // Quantization scales (world units -> int16). Object-record positions ride at
  // 0.1 mm (±3.2767 m — tables are ~2 m, and objects are clamped to the table)
  // so sub-mm physics separations in card piles survive the wire; the uplink /
  // transient channels (move, presence, drawlive, measurelive) keep 1 mm
  // (±32.767 m). Quaternion components ride at ×32767; linear velocity in
  // mm/s shares the ±32.767 m/s range (far above any throw). Angular velocity
  // at ×250 covers ±131 rad/s, above the server's physics.throw.maxSpin cap, so
  // a real tumble never saturates — generate.mjs asserts that coupling.
  scale: { pos: 1000, recPos: 10000, quat: 32767, vel: 1000, avel: 250 },
};
