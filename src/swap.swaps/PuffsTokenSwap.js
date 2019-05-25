import debug from 'debug'
import SwapApp, { SwapInterface, constants, util } from 'swap.app'
import BigNumber from 'bignumber.js'
import InputDataDecoder from 'puffscoin-input-data-decoder'


class PuffsTokenSwap extends SwapInterface {

  /**
   *
   * @param {object}    options
   * @param {string}    options.name
   * @param {string}    options.address
   * @param {array}     options.abi
   * @param {string}    options.tokenAddress
   * @param {array}     options.tokenAbi
   * @param {number}    options.gasLimit
   * @param {function}  options.fetchBalance
   */
  constructor(options) {
    super()

    if (!options.name) {
      throw new Error('PuffsTokenSwap: "name" required')
    }
    if (!Object.values(constants.COINS).includes(options.name.toUpperCase())) {
      throw new Error('PuffsTokenSwap: "name" should be correct')
    }
    if (typeof options.address !== 'string') {
      throw new Error('PuffsTokenSwap: "address" required')
    }
    if (typeof options.decimals !== 'number') {
      throw new Error('PuffsTokenSwap: "decimals" required')
    }
    if (!Array.isArray(options.abi)) {
      throw new Error('PuffsTokenSwap: "abi" required')
    }
    if (typeof options.tokenAddress !== 'string') {
      throw new Error('PuffsTokenSwap: "tokenAddress" required')
    }
    if (!Array.isArray(options.tokenAbi)) {
      throw new Error('PuffsTokenSwap: "tokenAbi" required')
    }
    if (typeof options.estimateGasPrice !== 'function') {
      // ({ speed } = {}) => gasPrice
      console.warn(`PuffsTokenSwap: "estimateGasPrice" is not a function. You will not be able use automatic mempool-based fee`)
    }



    this._swapName      = options.name.toUpperCase()

    this.address        = options.address
    this.abi            = options.abi
    this.decimals       = options.decimals
    this.tokenAddress   = options.tokenAddress
    this.tokenAbi       = options.tokenAbi

    this.gasLimit       = options.gasLimit || 2e5
    this.gasPrice       = options.gasPrice || 2e9
    this.fetchBalance   = options.fetchBalance
    this.estimateGasPrice = options.estimateGasPrice || (() => {})

  }

  _initSwap(app) {
    super._initSwap(app)

    this.app = app

    this.decoder        = new InputDataDecoder(this.abi)
    this.contract       = new this.app.env.web3.puffs.Contract(this.abi, this.address)
    this.ERC20          = new this.app.env.web3.puffs.Contract(this.tokenAbi, this.tokenAddress)
  }

  async updateGas() {
    try {
      this.gasPrice = await this.estimateGasPrice({ speed: 'fast' })
    } catch(err) {
      debug('swap.core:swaps')(`PuffsTokenSwap: Error with gas update: ${err.message}, using old value gasPrice=${this.gasPrice}`)
    }
  }

  /**
   *
   * @param {object} data
   * @param {BigNumber} data.amount
   * @param {function} handleTransactionHash
   * @returns {Promise}
   */
  async approve(data, handleTransactionHash) {
    const { amount } = data

    const exp = BigNumber(10).pow(this.decimals)
    const newAmount = BigNumber(amount).times(exp).toString()

    await this.updateGas()

    return new Promise(async (resolve, reject) => {
      try {
        const result = await this.ERC20.methods.approve(this.address, newAmount).send({
          from: this.app.services.auth.accounts.puffs.address,
          gas: this.gasLimit,
          gasPrice: this.gasPrice,
        })
          .on('transactionHash', (hash) => {
            if (typeof handleTransactionHash === 'function') {
              handleTransactionHash(hash)
            }
          })
          .on('error', err => {
            reject(err)
          })

        resolve(result)
      }
      catch (err) {
        reject(err)
      }
    })
  }

  /**
   *
   * @param {object} data
   * @param {string} data.spender
   * @returns {Promise}
   */
  checkAllowance(data) {
    const { spender } = data

    return new Promise(async (resolve, reject) => {
      try {
        const result = await this.ERC20.methods.allowance(spender, this.address).call({
          from: this.app.services.auth.accounts.puffs.address,
        })

        resolve(result)
      }
      catch (err) {
        reject(err)
      }
    })
  }

  /**
   *
   * @param {object} data
   * @param {string} data.secretHash
   * @param {string} data.participantAddress
   * @param {BigNumber} data.amount
   * @param {function} handleTransactionHash
   * @returns {Promise}
   */
  async create(data, handleTransactionHash) {
    if (data.targetWallet && (data.targetWallet!==data.participantAddress)) {
      return this.createSwapTarget(data, handleTransactionHash)
    } else {
      return this.createSwap(data, handleTransactionHash)
    }
  }

  /**
   *
   * @param {object} data
   * @param {string} data.secretHash
   * @param {string} data.participantAddress
   * @param {BigNumber} data.amount
   * @param {function} handleTransactionHash
   * @returns {Promise}
   */
  async createSwap(data, handleTransactionHash) {
    const { secretHash, participantAddress, amount, calcFee } = data

    const exp = BigNumber(10).pow(this.decimals)
    const newAmount = BigNumber(amount).times(exp).toString()

    await this.updateGas()

    return new Promise(async (resolve, reject) => {
      const hash    = `0x${secretHash.replace(/^0x/, '')}`

      const values  = [ hash, participantAddress, newAmount, this.tokenAddress ]

      const params  = {
        from: this.app.services.auth.accounts.puffs.address,
        gas: this.gasLimit,
        gasPrice: this.gasPrice,
      }

      try {
        const gasFee = await this.contract.methods.createSwap(...values).estimateGas(params)

        if (calcFee) {
          resolve(gasFee)
          return
        }

        params.gas = gasFee;
        console.log("PuffsTokenSwap -> createSwap -> gasFee",gasFee);
        const result = await this.contract.methods.createSwap(...values).send(params)
          .on('transactionHash', (hash) => {
            if (typeof handleTransactionHash === 'function') {
              handleTransactionHash(hash)
            }
          })
          .on('error', (err) => {
            reject(err)
          })
        console.log('result', result)
        resolve(result)
      }
      catch (err) {
        reject(err)
      }
    })
  }

  /**
   *
   * @param {object} data
   * @param {string} data.secretHash
   * @param {string} data.participantAddress
   * @param {BigNumber} data.amount
   * @param {function} handleTransactionHash
   * @returns {Promise}
   */
  async createSwapTarget(data, handleTransactionHash) {
    const { secretHash, participantAddress, amount , targetWallet, calcFee } = data

    const exp = BigNumber(10).pow(this.decimals)
    const newAmount = BigNumber(amount).times(exp).toString()

    await this.updateGas()

    return new Promise(async (resolve, reject) => {
      const hash    = `0x${secretHash.replace(/^0x/, '')}`

      const values  = [ hash , participantAddress, targetWallet , newAmount, this.tokenAddress ]

      const params  = {
        from: this.app.services.auth.accounts.puffs.address,
        gas: this.gasLimit,
        gasPrice: this.gasPrice,
      }

      try {
        debug('swap.core:swaps')("Get gas fee");
        const gasFee = await this.contract.methods.createSwapTarget(...values).estimateGas(params)

        if (calcFee) {
          resolve(gasFee)
          return
        }

        params.gas = gasFee;
        debug('swap.core:swaps')("PuffsTokenSwap -> create -> gasFee",gasFee);
        const result = await this.contract.methods.createSwapTarget(...values).send(params)
          .on('transactionHash', (hash) => {
            if (typeof handleTransactionHash === 'function') {
              handleTransactionHash(hash)
            }
          })
          .on('error', (err) => {
            reject(err)
          })
        debug('swap.core:swaps')('result', result)
        resolve(result)
      }
      catch (err) {
        reject(err)
      }
    })
  }

  /**
   *
   * @param {object} data
   * @param {string} data.ownerAddress
   * @param {string} data.participantAddress
   * @returns {Promise}
   */
  swaps(data) {
    const { ownerAddress, participantAddress } = data

    return this.contract.methods.swaps(ownerAddress, participantAddress).call()
  }

  /**
   *
   * @param {object} data
   * @param {string} data.ownerAddress
   * @param {string} data.participantAddress
   * @returns {Promise}
   */
  checkSwapExists(data) {
    return new Promise(async (resolve) => {
      const swap = await this.swaps(data)

      debug('swap.core:swaps')('swapExists', swap)

      const balance = swap && swap.balance ? parseInt(swap.balance) : 0
      resolve(balance > 0)
    })
  }

  /**
   *
   * @param {object} data
   * @param {string} data.ownerAddress
   * @returns {Promise}
   */
  getBalance(data) {
    const { ownerAddress } = data

    return new Promise(async (resolve, reject) => {
      let balance

      try {
        balance = await this.contract.methods.getBalance(ownerAddress).call({
          from: this.app.services.auth.accounts.puffs.address,
        })
      }
      catch (err) {
        reject(err)
      }
      debug('swap.core:swaps')('balance', balance)
      resolve(balance)
    })
  }

  /**
   *
   * @param {object} data
   * @param {string} data.ownerAddress
   * @param {BigNumber} data.expectedValue
   * @returns {Promise.<string>}
   */
  async checkBalance(data) {
    const { ownerAddress, participantAddress, expectedValue, expectedHash } = data

    const balance = await util.helpers.repeatAsyncUntilResult(() =>
      this.getBalance({ ownerAddress })
    )
    const swap = await util.helpers.repeatAsyncUntilResult(() =>
      this.contract.methods.swaps(ownerAddress, participantAddress).call()
    )

    const { secretHash } = swap
    debug('swap.core:swaps')(`swap.secretHash`, secretHash)

    const _secretHash = `${secretHash.replace(/^0x/, '')}`

    debug('swap.core:swaps')(`secretHash: expected hash = ${expectedHash}, contract hash = ${_secretHash}`)

    if (expectedHash !== _secretHash) {
      return `Expected hash: ${expectedHash}, got: ${_secretHash}`
    }

    const expectedValueWei = BigNumber(expectedValue).multipliedBy(this.decimals)

    if (expectedValueWei.isGreaterThan(balance)) {
      return `Expected value: ${expectedValueWei.toString()}, got: ${balance}`
    }
  }

  /**
   * @param {object} data
   * @param {string} data.ownerAddress
   * @param {string} tokenAddress
   */
  async checkTokenIsValid(data) {
    const { ownerAddress, participantAddress } = data

    debug('swap.core:swaps')(`Check token is valid. Needed token address: ${this.tokenAddress.toUpperCase()}`);
    const swap = await util.helpers.repeatAsyncUntilResult(() =>
      this.contract.methods.swaps(ownerAddress, participantAddress).call()
    )

    const { token } = swap
    debug('swap.core:swaps')(`Token address at swap contract: ${token.toUpperCase()}`);

    return (this.tokenAddress.toUpperCase() == token.toUpperCase())
  }
  /**
   *
   * @param {string} ownerAddress
   * @returns {Promise.<string>}
   */
  async getTargetWallet(ownerAddress) {
    let address = await util.helpers.repeatAsyncUntilResult(() =>
      this.getTargetWalletPromise(ownerAddress)
    )
    return address
  }

  /**
   *
   * @param {string} ownerAddress
   * @returns {string}
   */
  async getTargetWalletPromise(ownerAddress) {
    debug('swap.core:swaps')('PuffsTokenSwap->getTargetWallet');
    return new Promise(async (resolve, reject) => {
      try {
        const targetWallet = await this.contract.methods.getTargetWallet(ownerAddress).call({
          from: this.app.services.auth.accounts.puffs.address,
        })
        debug('swap.core:swaps')('PuffsTokenSwap->getTargetWallet',targetWallet);

        resolve(targetWallet)
      }
      catch (err) {
        reject(err)
      }
    });
  }

  /**
   *
   * @param {object} data
   * @param {string} data.secret
   * @param {string} data.ownerAddress
   * @param {function} handleTransactionHash
   * @returns {Promise}
   */
  async calcWithdrawGas(data) {
    return this.calcWithdrawOtherGas({
      ownerAddress: data.ownerAddress,
      participantAddress: this.app.services.auth.accounts.puffs.address,
      secret: data.secret,
    })
  }

  /**
   *
   * @param {object} data
   * @param {string} data.secret
   * @param {string} data.ownerAddress
   * @param {function} handleTransactionHash
   * @returns {Promise}
   */
  async withdraw(data, handleTransactionHash) {
    return this.withdrawOther({
      ownerAddress: data.ownerAddress,
      participantAddress: this.app.services.auth.accounts.puffs.address,
      secret: data.secret,
    } , handleTransactionHash)
  }

  /**
   *
   * @param {object} data
   * @param {string} data.secret
   * @param {string} data.participantAddress
   * @returns {Promise}
   */
  async calcWithdrawNoMoneyGas(data) {
    return this.calcWithdrawOtherGas({
      ownerAddress: this.app.services.auth.accounts.puffs.address,
      participantAddress: data.participantAddress,
      secret: data.secret,
    })
  }

  /**
   *
   * @param {object} data
   * @param {string} data.secret
   * @param {string} data.participantAddress
   * @param {function} handleTransactionHash
   * @returns {Promise}
   */
  async withdrawNoMoney(data, handleTransactionHash) {
    return this.withdrawOther({
      ownerAddress: this.app.services.auth.accounts.puffs.address,
      participantAddress: data.participantAddress,
      secret: data.secret,
    }, handleTransactionHash)
  }

  async calcWithdrawOtherGas(data) {
    const { ownerAddress, participantAddress, secret } = data

    await this.updateGas()

    return new Promise(async (resolve, reject) => {
      const _secret = `0x${secret.replace(/^0x/, '')}`

      const params = {
        from: this.app.services.auth.accounts.puffs.address,
        gas: this.gasLimit,
        gasPrice: this.gasPrice,
      }

      try {
        const gasFee = await this.contract.methods.withdrawOther(_secret, ownerAddress, participantAddress).estimateGas(params);
        resolve(gasFee)
      }
      catch (err) {
        reject(err)
      }
    })
  }
  /**
   *
   * @param {object} data
   * @param {string} data.secret
   * @param {string} data.ownerAddress
   * @param {string} data.participantAddress
   * @param {function} handleTransactionHash
   * @returns {Promise}
   */
  async withdrawOther(data, handleTransactionHash) {
    const { ownerAddress, participantAddress, secret } = data

    await this.updateGas()

    return new Promise(async (resolve, reject) => {
      const _secret = `0x${secret.replace(/^0x/, '')}`

      const params = {
        from: this.app.services.auth.accounts.puffs.address,
        gas: this.gasLimit,
        gasPrice: this.gasPrice,
      }

      try {
        const gasFee = await this.calcWithdrawOtherGas(data);
        debug('swap.core:swaps')("PuffsTokenSwap -> withdrawOther -> gasFee",gasFee);

        params.gas = gasFee;
        const result = await this.contract.methods.withdrawOther(_secret, ownerAddress, participantAddress).send(params)
          .on('transactionHash', (hash) => {
            if (typeof handleTransactionHash === 'function') {
              handleTransactionHash(hash)
            }
          })
          .on('error', (err) => {
            reject(err)
          })

        resolve(result)
      }
      catch (err) {
        reject(err)
      }
    })
  }

  /**
   *
   * @param {object} data
   * @param {string} data.participantAddress
   * @param {function} handleTransactionHash
   * @returns {Promise}
   */
  async refund(data, handleTransactionHash) {
    const { participantAddress } = data

    await this.updateGas()

    return new Promise(async (resolve, reject) => {
      const params = {
        from: this.app.services.auth.accounts.puffs.address,
        gas: this.gasLimit,
        gasPrice: this.gasPrice,
      }

      const receipt = await this.contract.methods.refund(participantAddress).send(params)
        .on('transactionHash', (hash) => {
          if (typeof handleTransactionHash === 'function') {
            handleTransactionHash(hash)
          }
        })
        .on('error', (err) => {
          reject(err)
        })

      resolve(receipt)
    })
  }

  /**
   *
   * @param {object} data
   * @param {string} data.participantAddress
   * @returns {Promise}
   */
  getSecret(data) {
    const { participantAddress } = data

    return new Promise(async (resolve, reject) => {
      try {
        const secret = await this.contract.methods.getSecret(participantAddress).call({
          from: this.app.services.auth.accounts.puffs.address,
        })

        const secretValue = secret && !/^0x0+$/.test(secret) ? secret : null

        resolve(secretValue)
      }
      catch (err) {
        reject(err)
      }
    })
  }


  /**
   *
   * @param {string} transactionHash
   * @returns {Promise<any>}
   */
  getSecretFromTxhash = (transactionHash) =>
    this.app.env.web3.puffs.getTransaction(transactionHash)
      .then(txResult => {
        try {
          const bytes32 = this.decoder.decodeData(txResult.input)
          return this.app.env.web3.utils.bytesToHex(bytes32.inputs[0]).split('0x')[1]
        } catch (err) {
          debug('swap.core:swaps')('Trying to fetch secret from tx: ' + err.message)
          return
        }
      })

}


export default PuffsTokenSwap
