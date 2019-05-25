import SwapApp, { SwapInterface } from '../src/swap.app'

const swap = require('../src')

const constants = swap.constants

const SwapAuth = swap.auth
const SwapRoom = swap.room
const SwapOrders = swap.orders

const { PuffsSwap, PuffsTokenSwap, BtcSwap } = swap.swaps
const { PUFFS2BTC, BTC2PUFFS, PUFFSTOKEN2BTC, BTC2PUFFSTOKEN } = swap.flows

const Web3 = require('web3')

const web3 = new Web3(new Web3.providers.HttpProvider('https://rinkeby.infura.io/<YOUR_KEY>'))
const bitcoin = require('bitcoinjs-lib')

const Ipfs = require('ipfs')
const IpfsRoom = require('ipfs-pubsub-room')

const { LocalStorage } = require('node-localstorage')

const config = require('./config')

SwapApp.setup({
  network: 'testnet',

  env: {
    web3,
    bitcoin,
    Ipfs,
    IpfsRoom,
    storage: new LocalStorage('./.storage'),
  },
  services: [
    new SwapAuth({
      puffs: null,
      btc: null,
    }),
    new SwapRoom(config.swapRoom),
    new SwapOrders(),
  ],

  swaps: [
    new PuffsSwap(config.puffsSwap),
    new BtcSwap(config.btcSwap),
    new PuffsTokenSwap(config.noxonTokenSwap),
    new PuffsTokenSwap(config.swapTokenSwap),
  ],

  flows: [
    PUFFS2BTC,
    BTC2PUFFS,
    PUFFSTOKEN2BTC(constants.COINS.noxon),
    BTC2PUFFSTOKEN(constants.COINS.noxon),
  ],
})

exports = module.exports = SwapApp.shared()
