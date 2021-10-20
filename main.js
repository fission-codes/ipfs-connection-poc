import { create } from 'ipfs-core'
import Websockets from 'libp2p-websockets'
import filters from 'libp2p-websockets/src/filters'

const KEEP_ALIVE_INTERVAL =
  1 * 60 * 1000 // 1 minute

const BACKOFF_INIT = {
  retryNumber: 0,
  lastBackoff: 0,
  currentBackoff: 1000
}

const MAX_RETRIES =
  17 // ~43 minutes


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

  const ipfs = await create(OPTIONS)
  self.ipfs = ipfs

  peers.forEach(peer => {
    tryConnecting(peer)
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

let latestTimeoutId = null;

async function keepAlive(peer, backoff) {
  log('retry number', backoff.retryNumber)

  let timeoutId = null;

  if (backoff.retryNumber <= MAX_RETRIES) {
    log('backoff timeout', backoff.currentBackoff)

    // Start race between reconnect and ping
    timeoutId = setTimeout(() => reconnect(peer, backoff), backoff.currentBackoff)

    // Track the latest reconnect attempt
    latestTimeoutId = timeoutId;
  } else {
    console.log('max connection attempts exceeded, giving up')
  }

  self.ipfs.libp2p.ping(peer).then(() => {
    log('alive')

    // Cancel reconnect because ping won
    clearTimeout(timeoutId)

    // Keep alive after the latest ping-reconnect race, ignore the rest
    // Give up if timeoutId is null, we are at max retries
    if (timeoutId === latestTimeoutId) {
      setTimeout(() => keepAlive(peer, BACKOFF_INIT), KEEP_ALIVE_INTERVAL)
    }
  }).catch(() => { })

}

async function reconnect(peer, { retryNumber, lastBackoff, currentBackoff }) {
  log('reconnecting')

  try {
    await self.ipfs.swarm.disconnect(peer)
    await self.ipfs.swarm.connect(peer)
  } catch {
    // No action needed, we will retry
  }

  // Keep alive or keep trying after this reconnect attempt
  keepAlive(peer, { retryNumber: retryNumber + 1, lastBackoff: currentBackoff, currentBackoff: lastBackoff + currentBackoff })
}

async function tryConnecting(peer) {
  self
    .ipfs.libp2p.ping(peer)
    .then(() => {
      return ipfs.swarm
        .connect(peer, 1 * 1000)
        .then(() => {
          console.log(`🪐 Connected to ${peer}`)

          // Ensure permanent connection to Fission gateway
          // TODO: This is a temporary solution while we wait for
          //       https://github.com/libp2p/js-libp2p/issues/744
          //       (see "Keep alive" bit)
          setTimeout(() => keepAlive(peer, BACKOFF_INIT), KEEP_ALIVE_INTERVAL)
        })
    })
    .catch(() => {
      console.log(`🪓 Could not connect to ${peer}. Will keep trying.`)

      keepAlive(peer, BACKOFF_INIT)
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