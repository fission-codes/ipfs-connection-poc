A proof of concept environment for testing IPFS peer connections.

## Setup

Install dependencies

```
npm run install
```

This project depends on a local IPFS node. Start IPFS to determine your local multiaddresses

```
npm run ipfs
```

Copy the three WebSocket entries into the empty `peers` array in `main.js`. These entries have `/ws/` in their multiaddress.

## Run

Start IPFS

```
npm run ipfs
```

Start the app

```
npm run dev
```

Start the app with extra debug logging

```
npm run dev:log
```

Flaky connections can be simulated by stopping and restarting IPFS.