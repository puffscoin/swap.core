const testnet = require('./testnet')
const localnet = require('./localnet')
const puffsnet = require('./puffsnet')

const getConfig = require('./getConfig')

const swap = require('swap.core')
const { PuffsTokenSwap } = swap.swaps
const tokenSwap = require('./tokenSwap')

module.exports = {
  testnet: getConfig(testnet),
  localnet: getConfig(localnet),
  puffsnet: getConfig(puffsnet),

  tokenSwap: (config) => new PuffsTokenSwap(tokenSwap(config)()),
}
