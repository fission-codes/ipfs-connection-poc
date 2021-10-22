import { create } from 'ipfs-core'
import Websockets from 'libp2p-websockets'
import filters from 'libp2p-websockets/src/filters'


/** Connection interval knobs
 * 
 * KEEP_ALIVE_INTERVAL: Interval to keep the connection alive when online
 * BACKOFF_INIT: Starting intervals for fibonacci backoff used when establishing a connection
 * KEEP_TRYING_INTERVAL: Interval to keep trying the connection when offline
 */

const KEEP_ALIVE_INTERVAL =
  1 * 60 * 1000 // 1 minute

const BACKOFF_INIT = {
  retryNumber: 0,
  lastBackoff: 0,
  currentBackoff: 1000
}

const KEEP_TRYING_INTERVAL =
  5 * 60 * 1000 // 5 minutes


// IPFS OPTIONS

const transportKey = Websockets.prototype[Symbol.toStringTag]

const OPTIONS = {
  config: {
    Addresses: {
      Delegates: []
    },
    Bootstrap: [],
    Discovery: {
      webRTCStar: { enabled: false }
    }
  },
  preload: {
    enabled: false
  },
  libp2p: {
    config: {
      peerDiscovery: { autoDial: false },
      transport: {
        [transportKey]: {
          filter: filters.all
        }
      }
    }
  }
}


const main = async () => {
  // Local peers
  const peers = [
    // run `npm run ipfs` to determine local peers
  ]

  // Production peers
  // const peers = await fetchPeers();

  if (peers.length === 0) {
    throw new Error("💥 Couldn't start IPFS node, peer list is empty")
  };

  // Track peer reconnect timeoutIds
  self.latestPeerTimeoutIds = {}
  peers.forEach(peer => {
    self.latestPeerTimeoutIds[peer] = null
  })

  const ipfs = await create(OPTIONS)
  self.ipfs = ipfs

  // Track the connections in a closure
  let connections = []

  const report = (peer, status) => {
    connections = connections
      .filter(connection => connection.peer !== peer)
      .concat({ peer, ...status })

    const offline = connections.every(connection => !connection.connected)
    const lastConnectedAt = connections.reduce((newest, connection) =>
      newest >= connection.lastConnectedAt ? newest : connection.lastConnectedAt,
      0
    )

    const activeConnections = connections.filter(connection => connection.latency !== null)
    const averageLatency = activeConnections.length > 0
      ? connections.reduce((sum, connection) => sum + connection.latency, 0) / activeConnections.length
      : null

    console.table(connections)
    log('offline', offline)
    log('last connected at', lastConnectedAt === 0 ? null : lastConnectedAt)
    log('average latency', averageLatency)
  }

  peers.forEach(peer => {
    tryConnecting(peer, report)
  })
}


// PEER LIST

function fetchPeers() {
  const peersUrl = "https://runfission.com/ipfs/peers"

  return fetch(peersUrl)
    .then(r => r.json())
    .then(r => r.filter(p => p.includes("/wss/")))
    .catch(e => { throw new Error("💥 Couldn't start IPFS node, failed to fetch peer list") })
}


// CONNECTION

async function keepAlive(peer, backoff, status, report) {
  log('retry number', backoff.retryNumber)
  log('currentBackoff', backoff.currentBackoff)

  let timeoutId = null;

  if (backoff.currentBackoff < KEEP_TRYING_INTERVAL) {
    log('backoff timeout', backoff.currentBackoff)

    // Start race between reconnect and ping
    timeoutId = setTimeout(() => reconnect(peer, backoff, status, report), backoff.currentBackoff)
  } else {
    log('at retry ceiling, keep trying')

    // Disregard backoff, but keep trying
    timeoutId = setTimeout(() => reconnect(peer, backoff, status, report), KEEP_TRYING_INTERVAL)
  }

  // Track the latest reconnect attempt
  self.latestPeerTimeoutIds[peer] = timeoutId
  
  self.ipfs.libp2p.ping(peer).then(latency => {
    log('alive')

    const updatedStatus = { connected: true, lastConnectedAt: Date.now(), latency }
    report(peer, updatedStatus)

    // Cancel reconnect because ping won
    clearTimeout(timeoutId)

    // Keep alive after the latest ping-reconnect race, ignore the rest
    if (timeoutId === self.latestPeerTimeoutIds[peer]) {
      setTimeout(() => keepAlive(peer, BACKOFF_INIT, updatedStatus, report), KEEP_ALIVE_INTERVAL)
    }
  }).catch(() => { })

}

async function reconnect(peer, backoff, status, report) {
  log('reconnecting')

  const updatedStatus = { ...status, connected: false, latency: null }
  report(peer, updatedStatus)

  try {
    await self.ipfs.swarm.disconnect(peer)
    await self.ipfs.swarm.connect(peer)
  } catch {
    // No action needed, we will retry
  }

  if (backoff.currentBackoff < KEEP_TRYING_INTERVAL) {
    const nextBackoff = {
      retryNumber: backoff.retryNumber + 1,
      lastBackoff: backoff.currentBackoff,
      currentBackoff: backoff.lastBackoff + backoff.currentBackoff
    }

    keepAlive(peer, nextBackoff, updatedStatus, report)
  } else {
    keepAlive(peer, backoff, updatedStatus, report)
  }
}

async function tryConnecting(peer, report) {
  self
    .ipfs.libp2p.ping(peer)
    .then(latency => {

      return ipfs.swarm
        .connect(peer, 1 * 1000)
        .then(() => {
          console.log(`🪐 Connected to ${peer}`)

          const status = { connected: true, lastConnectedAt: Date.now(), latency }
          report(peer, status)

          // Ensure permanent connection to Fission gateway
          // TODO: This is a temporary solution while we wait for
          //       https://github.com/libp2p/js-libp2p/issues/744
          //       (see "Keep alive" bit)
          setTimeout(() => keepAlive(peer, BACKOFF_INIT, status, report), KEEP_ALIVE_INTERVAL)
        })
    })
    .catch(() => {
      console.log(`🪓 Could not connect to ${peer}. Will keep trying.`)

      const status = { connected: false, lastConnectedAt: 0, latency: null }
      report(peer, status)

      keepAlive(peer, BACKOFF_INIT, status, report)
    })
}


// START

const start = document.getElementById('start')

start.addEventListener('click', () => {
  main();
})


// LOGGING

let { DEBUG } = process.env

const log = (message, val) => {
  if (DEBUG === 'true') {
    if (val !== undefined) {
      console.log(message, val)
    } else {
      console.log(message)
    }
  }
}