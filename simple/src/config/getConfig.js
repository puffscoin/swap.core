const { constants } = require('swap.app')

const SwapAuth = require('swap.auth')
const SwapRoom = require('swap.room')
const SwapOrders = require('swap.orders')

const { PuffsSwap, PuffsTokenSwap, BtcSwap, UsdtSwap, BchSwap, } = require('swap.swaps')
const {
  PUFFS2BTC, BTC2PUFFS,
  PUFFS2BCH, BCH2PUFFS,
  PUFFSTOKEN2BTC, BTC2PUFFSTOKEN,
  USDT2PUFFSTOKEN, PUFFSTOKEN2USDT } = require('swap.flows')

const puffs = require('../instances/puffscoin')
const btc = require('../instances/bitcoin')

const Ipfs = require('ipfs')
const IpfsRoom = require('ipfs-pubsub-room')

const common = require('./common')

const tokenSwap = require('./tokenSwap')

const setupLocalStorage = require('./setupLocalStorage')
const { LocalStorage } = require('node-localstorage')
const sessionStorage = require('node-sessionstorage')

module.exports = (config) => ({ account, contracts: { PUFFS, TOKEN }, ...custom }) => {
  config = {
    ...common,
    ...config,
    ...custom,

    swapAuth: {
      ...common.swapAuth,
      ...config.swapAuth,
      ...custom.swapAuth,
    },

    swapRoom: {
      ...common.swapRoom,
      ...config.swapRoom,
      ...custom.swapRoom,
    },
  }

  setupLocalStorage()

  const storage = new LocalStorage(config.storageDir)

  const web3    = puffs[config.network]().core
  const bitcoin = btc[config.network]().core

  const tokens = (config.ERC20TOKENS || [])
    .map(_token => ({ network: config.network, ..._token }))
    .filter(_token => _token.network === config.network)

  return {
    network: config.network,
    constants,
    env: {
      web3,
      bitcoin,
      // bcash,
      Ipfs,
      IpfsRoom,
      storage,
      sessionStorage,
      ...config.env,
    },
    services: [
      new SwapAuth({
        puffs: account,
        btc: null,
        ...config.swapAuth
      }),
      new SwapRoom(config.swapRoom),
      new SwapOrders(),
    ],

    swaps: [
      new PuffsSwap(config.puffsSwap(PUFFS)),
      new BtcSwap(config.btcSwap()),
      config.network === 'mainnet'
        ? new UsdtSwap(config.usdtSwap())
        : null,
      new PuffsTokenSwap(config.noxonTokenSwap(TOKEN)),
      new PuffsTokenSwap(config.swapTokenSwap(TOKEN)),
      ...(
        (config.swaps || [])
      ),
      ...(
        tokens.map(_token => new PuffsTokenSwap(tokenSwap(_token)()))
      )
    ]
    .filter(a=>!!a),

    flows: [
      PUFFS2BTC,
      BTC2PUFFS,
      PUFFSTOKEN2BTC(constants.COINS.noxon),
      BTC2PUFFSTOKEN(constants.COINS.noxon),
      PUFFSTOKEN2BTC(constants.COINS.swap),
      BTC2PUFFSTOKEN(constants.COINS.swap),
      PUFFSTOKEN2USDT(constants.COINS.noxon),
      USDT2PUFFSTOKEN(constants.COINS.noxon),
      PUFFSTOKEN2USDT(constants.COINS.swap),
      USDT2PUFFSTOKEN(constants.COINS.swap),
      ...(config.flows || []),
      ...((
          [].concat.apply([],
            tokens.map(({ name }) => ([
              PUFFSTOKEN2USDT(name),
              USDT2PUFFSTOKEN(name),
              PUFFSTOKEN2BTC(name),
              BTC2PUFFSTOKEN(name),
            ]))
          )
        ) || []
      )
      // PUFFS2BCH,
      // BCH2PUFFS,
    ],
  }
}
