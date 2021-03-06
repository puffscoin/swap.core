const { bitcoin, puffscoin } = require('../instances')
const debug = require('debug')('swap.core:simple:wallet')

const BLOCKCHAININFO = isMain => isMain ? `https://blockchain.info` : `https://testnet.blockchain.info`
const PUFFSSCAN = isMain => isMain ? `https://puffsscan.leafycauldronapothecary.com` : `https://puffsscan.leafycauldronapothecary.com`

class Wallet {
  constructor(app, constants, config) {
    this.id = config.id
    this.network = app.network
    this.puffscoin = puffscoin
    this.bitcoin = bitcoin
    this.swapApp = app
    this.constants = constants
    this.auth = app.services.auth
    this.balances = {}
  }

  async withdraw(from, to, value) {
    switch (from) {
      case 'btc':
        const account = this.auth.accounts.btc
        return await this.bitcoin.sendTransaction({ account, to, value })
      case 'puffs':
        return await this.puffscoin.sendTransaction({to, value})
      default:
        return Promise.reject('not implemented')
    }
  }

  async getBalanceBySymbol(symbol) {

    if(!this.balances[symbol]) {
      debug('updating balance', Date())
      let balances = await this.getBalance()
      balances.map(x => this.balances[x.symbol] = x)
    }

    return this.balances[symbol]
  }

  async getData() {
    const currencies = Object.values(this.constants.COINS)
    const data = this.auth.getPublicData()

    const addresses = currencies.reduce((obj, symbol) => {
      const { address } = (symbol == 'BTC' || symbol == 'BCH' || symbol == 'USDT')
        ? data.btc : data.puffs

      return {
        ...obj,
        [symbol]: address,
      }
    }, {})

    const fetchBalances = currencies.map(symbol => {
      try {
        const instance = this.swapApp.swaps[symbol]
        const address = addresses[symbol]

        return instance ? instance.fetchBalance(address) : '-'
      } catch (err) {
        debug(`Error fetching ${symbol} balance: ${err.message}`)
        return '-'
      }
    })

    const values = await Promise.all( fetchBalances )

    return values.map((value, index) => ({
      symbol: currencies[index],
      amount: value,
      address: addresses[currencies[index]]
    }))
  }

  fetchBalance(symbol) {
    const data = this.auth.getPublicData()
    const account = symbol == 'BTC' || symbol == 'BCH' || symbol == 'USDT' ? data.btc : data.puffs
    const instance = this.swapApp.swaps[symbol]

    return instance ? instance.fetchBalance(account.address) : '-'
  }

  async getBalance(symbols) {
    const currencies = symbols || Object.values(this.constants.COINS)

    const values = await Promise.all(
      currencies.map(symbol => this.fetchBalance(symbol)))

    return values.map((value, index) => ({
      symbol: currencies[index],
      value,
    }))
  }

  getCore() {
    return {
      puffs: this.puffscoin.core,
      btc: this.bitcoin.core,
    }
  }

  view() {
    return {
      id: this.id,
      network: this.network,
      mainnet: this.swapApp.isMainNet(),
      'puffsscan.leafycauldronapothecary.com': `${ETHERSCANIO(this.swapApp.isMainNet())}/address/${this.auth.accounts.puffs.address}`,
      'blockchain.info': `${BLOCKCHAININFO(this.swapApp.isMainNet())}/address/${this.auth.accounts.btc.getAddress()}`,
      room: this.swapApp.services.room.roomName,
      ...this.auth.getPublicData(),
    }
  }

  async detailedView() {
    const gasPrice = await this.puffscoin.core.puffs.getGasPrice()
    const gasLimit = 3e6 // TODO sync with PuffsSwap.js
    const btcFee = 15000 // TODO sync with BtcSwap.js and bitcoin instance

    return {
      puffs: {
        gasPrice,
        gasLimit,
        // ...puffscoin.core,
      },
      btc: {
        fee: btcFee,
        // ...bitcoin.core,
      },
      wallet: this.view()
    }
  }

}

module.exports = Wallet
