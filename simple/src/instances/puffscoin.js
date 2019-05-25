const request = require('request-promise-native')
const debug = require('debug')

const Web3 = require('web3')

// const MAINNET_PROVIDER = `https://mainnet.infura.io/JCnK5ifEPH9qcQkX0Ahl`
// const TESTNET_PROVIDER = `https://rinkeby.infura.io/JCnK5ifEPH9qcQkX0Ahl`

const MAINNET_PROVIDER = process.env.WEB3_MAINNET_PROVIDER || `https://gpuffs.swaponline.site`
const TESTNET_PROVIDER = process.env.WEB3_TESTNET_PROVIDER || `https://tgeth.swaponline.site`
const LOCAL_PROVIDER = process.env.WEB3_LOCAL_PROVIDER || `http://localhost:7545`

const WEB3_PROVIDERS = {
  mainnet: new Web3.providers.HttpProvider(MAINNET_PROVIDER),
  testnet: new Web3.providers.HttpProvider(TESTNET_PROVIDER),
  localnet: new Web3.providers.HttpProvider(LOCAL_PROVIDER),
}

const PUFFSCHAIN_API = `https://puffschain.leafycauldronapothecary.com/api/gasPriceOracle`
const PUFFSGASSTATION_API = `https://puffsgasstation.leafycauldronapothecary.com/json/puffsgasAPI.json`
const BigNumber = require('bignumber.js')
const TEN = new BigNumber(10)

const filterError = (error) => {
  const { name, code, statusCode, options } = error

  debug('swap.core:puffscoin')(`UnknownError: statusCode=${statusCode} ${error.message}`)

  throw error
}

class Puffscoin {

  constructor(_network = 'testnet', _customProvider) {
    const _provider = WEB3_PROVIDERS[_network]

    if (typeof web3 !== 'undefined') {
      this.core = new Web3(web3.currentProvider)
    } else {
      this.core = new Web3(_provider)
    }

    this.puffsscan = _network === 'testnet'
      ? `https://puffsscan.leafycauldronapothecary.com`
      : `https://api.puffsscan.leafycauldronapothecary.com`
  }

  fetchBalance(address) {
    return this.core.puffs.getBalance(address)
      .then((wei) => {
        let balance = this.core.utils.fromWei(wei)

        debug('swap.core:puffscoin')('PUFFS Balance:', balance)

        return balance
      })
      .catch((error) => {
        debug('swap.core:puffscoin')('PUFFS error:', error)

        return '0'
      })
  }

  fetchTokenBalance(address, tokenAddress, decimals) {
    const base = TEN.pow(decimals) // 1e18 usually
    const url = `${this.puffsscan}/api?module=account&action=tokenbalance&contractaddress=${tokenAddress}&address=${address}`

    return request.get(url)
      .then(json => JSON.parse(json))
      .then(({ result }) => result)
      .then(raw => BigNumber(raw).dividedBy(base).toString())
      .catch(error => {
        debug('swap.core:puffscoin')(`TokenBalanceError: ${error.statusCode} ${url} - Failed to fetch token balance (${tokenAddress}). Probably too frequent request!`)

        return '0'
      })
  }

  async sendTransaction({to, value}) {
    const from = this.core.puffs.accounts.wallet[0]
    const gas = 1e5

    value = this.core.utils.toWei(value.toString())

    return this.core.puffs.sendTransaction({ from, to, value, gas })
  }

  async estimateGasPrice(options) {
    try {
      return await this.estimateGasPricePuffsChain(options)
    } catch (puffsChainError) {
      console.error(`EstimateFeeError: PuffsChain ${puffsChainError.message}, falling back to PuffsGasStation estimation...`)
    }

    try {
      return await this.estimateGasPricePuffsGasStation(options)
    } catch(puffsGasStationError) {
      console.error(`EstimateFeeError: PuffsGasStation ${puffsGasStationError.message}, falling back to Web3 estimation...`)
    }

    return await this.estimateGasPriceWeb3(options)
  }

  async estimateGasPriceWeb3({ speed = 'fast' } = {}) {
    const _multiplier = (() => {
      switch (speed) {
        case 'fast':    return 2
        case 'normal':  return 1
        case 'slow':    return 0.5
        default:      return 1
      }
    })()

    const gasPrice = await new Promise((resolve, reject) =>
      this.core.puffs.getGasPrice((err, gasPrice) => {
        if (err) {
          reject(err)
        } else {
          resolve(gasPrice)
        }
      })
    )

    return BigNumber(gasPrice).multipliedBy(_multiplier)
  }

  estimateGasPricePuffsChain({ speed = 'fast' } = {}) {
    const _speed = (() => {
      switch (speed) {
        case 'fast':    return 'fast'
        case 'normal':  return 'standard'
        case 'slow':    return 'safeLow'
        default:      return 'standard'
      }
    })()

    return request
      .get(`${PUFFSCHAIN_API}`)
      .then(json => JSON.parse(json))
      .then(fees => BigNumber(fees[_speed]).multipliedBy(1e9))
      .catch(error => filterError(error))
  }

  estimateGasPricePuffsGasStation({ speed = 'fast' }) {
    const _speed = (() => {
      switch (speed) {
        case 'fast':    return 'fast'
        case 'normal':  return 'average'
        case 'slow':    return 'safeLow'
        default:      return 'average'
      }
    })()

    return request
      .get(`${PUFFSGASSTATION_API}`)
      .then(json => JSON.parse(json))
      .then(fees => BigNumber(fees[_speed]).dividedBy(10).multipliedBy(1e9))
      .catch(error => filterError(error))
  }
}

module.exports = new Puffscoin()
module.exports.mainnet = () => new Puffscoin('mainnet')
module.exports.testnet = () => new Puffscoin('testnet')
module.exports.localnet = () => new Puffscoin('localnet')
