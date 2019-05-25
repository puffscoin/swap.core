import debug from 'debug'
import crypto from 'bitcoinjs-lib/src/crypto' // move to LtcSwap
import SwapApp, { constants } from 'swap.app'
import { Flow } from 'swap.swap'


class PUFFS2LTC extends Flow {

  static getName() {
    return `${this.getFromName()}2${this.getToName()}`
  }
  static getFromName() {
    return constants.COINS.Puffs
  }
  static getToName() {
    return constants.COINS.ltc
  }
  constructor(swap) {
    super(swap)

    this._flowName = PUFFS2LTC.getName()

    this.stepNumbers = {
      'sign': 1,
      'wait-lock-ltc': 2,
      'verify-script': 3,
      'sync-balance': 4,
      'lock-puffs': 5,
      'wait-withdraw-puffs': 6, // aka getSecret
      'withdraw-ltc': 7,
      'finish': 8,
      'end': 9
    }

    this.puffsSwap = swap.participantSwap
    this.ltcSwap = swap.ownerSwap

    if (!this.puffsSwap) {
      throw new Error('LTC2PUFFS: "puffsSwap" of type object required')
    }
    if (!this.ltcSwap) {
      throw new Error('LTC2PUFFS: "ltcSwap" of type object required')
    }

    this.state = {
      step: 0,

      signTransactionHash: null,
      isSignFetching: false,
      isMeSigned: false,

      secretHash: null,
      ltcScriptValues: null,

      ltcScriptVerified: false,

      isBalanceFetching: false,
      isBalanceEnough: false,
      balance: null,

      ltcScriptCreatingTransactionHash: null,
      puffsSwapCreationTransactionHash: null,

      isPuffsContractFunded: false,

      secret: null,

      isPuffsWithdrawn: false,
      isLtcWithdrawn: false,

      refundTransactionHash: null,
      isRefunded: false,

      isFinished: false,
      isSwapExist: false,
    }

    super._persistSteps()
    this._persistState()
  }

  _persistState() {
    super._persistState()
  }

  _getSteps() {
    const flow = this

    return [

      // 1. Sign swap to start

      () => {
        // this.sign()
      },

      // 2. Wait participant create, fund LTC Script

      () => {
        flow.swap.room.once('create ltc script', ({ scriptValues, ltcScriptCreatingTransactionHash }) => {
          flow.finishStep({
            secretHash: scriptValues.secretHash,
            ltcScriptValues: scriptValues,
            ltcScriptCreatingTransactionHash,
          }, { step: 'wait-lock-ltc', silentError: true })
        })

        flow.swap.room.sendMessage({
          event: 'request ltc script',
        })
      },

      // 3. Verify LTC Script

      () => {
        debug('swap.core:flow')(`waiting verify ltc script`)
        // this.verifyLtcScript()
      },

      // 4. Check balance

      () => {
        this.syncBalance()
      },

      // 5. Create PUFFS Contract

      async () => {
        const { participant, buyAmount, sellAmount } = flow.swap

        // TODO move this somewhere!
        const utcNow = () => Math.floor(Date.now() / 1000)
        const getLockTime = () => utcNow() + 3600 * 1 // 1 hour from now

        const scriptCheckResult = await flow.ltcSwap.checkScript(flow.state.ltcScriptValues, {
          value: buyAmount,
          recipientPublicKey: this.app.services.auth.accounts.ltc.getPublicKey(),
          lockTime: getLockTime(),
        })

        if (scriptCheckResult) {
          console.error(`Ltc script check error:`, scriptCheckResult)
          flow.swap.events.dispatch('ltc script check error', scriptCheckResult)
          return
        }

        const swapData = {
          participantAddress:   participant.puffs.address,
          secretHash:           flow.state.secretHash,
          amount:               sellAmount,
        }

        try {
          await this.puffsSwap.create(swapData, (hash) => {
            flow.swap.room.sendMessage({
              event: 'create PUFFS contract',
              data: {
                puffsSwapCreationTransactionHash: hash,
              },
            })

            flow.setState({
              puffsSwapCreationTransactionHash: hash,
            })
          })
        } catch (err) {
          // TODO user can stuck here after page reload...
          if ( /known transaction/.test(err.message) )
            return console.error(`known tx: ${err.message}`)
          else if ( /out of gas/.test(err.message) )
            return console.error(`tx failed (wrong secret?): ${err.message}`)
          else
            return console.error(err)
        }

        debug('swap.core:flow')(`finish step`)

        flow.finishStep({
          isPuffsContractFunded: true,
        }, { step: 'lock-puffs' })
      },

      // 6. Wait participant withdraw

      () => {
        flow.swap.room.once('puffsWithdrawTxHash', async ({ puffsSwapWithdrawTransactionHash }) => {
          flow.setState({
            puffsSwapWithdrawTransactionHash,
          })

          const secret = await flow.puffsSwap.getSecretFromTxhash(puffsSwapWithdrawTransactionHash)

          if (!flow.state.isPuffsWithdrawn && secret) {
            flow.finishStep({
              isPuffsWithdrawn: true,
              secret,
            }, { step: 'wait-withdraw-puffs' })
          }
        })

        flow.swap.room.sendMessage({
          event: 'request puffsWithdrawTxHash',
        })
      },

      // 7. Withdraw

      async () => {
        let { secret, ltcScriptValues } = flow.state

        if (!ltcScriptValues) {
          console.error('There is no "ltcScriptValues" in state. No way to continue swap...')
          return
        }

        await flow.ltcSwap.withdraw({
          scriptValues: flow.state.ltcScriptValues,
          secret,
        }, (hash) => {
          flow.setState({
            ltcSwapWithdrawTransactionHash: hash,
          })
        })

        flow.finishStep({
          isLtcWithdrawn: true,
        }, { step: 'withdraw-ltc' })
      },

      // 8. Finish

      () => {
        flow.swap.room.sendMessage({
          event: 'swap finished',
        })

        flow.finishStep({
          isFinished: true,
        }, { step: 'finish' })
      },

      // 9. Finished!
      () => {

      }
    ]
  }

  _checkSwapAlreadyExists() {
    const { participant } = this.swap

    const swapData = {
      ownerAddress:       this.app.services.auth.accounts.puffs.address,
      participantAddress: participant.puffs.address
    }

    return this.puffsSwap.checkSwapExists(swapData)
  }

  async sign() {
    const swapExists = await this._checkSwapAlreadyExists()

    if (swapExists) {
      this.swap.room.sendMessage({
        event: 'swap exists',
      })

      this.setState({
        isSwapExist: true,
      })
    } else {
      this.setState({
        isSignFetching: true,
      })

      this.swap.room.once('request sign', () => {
        this.swap.room.sendMessage({
          event: 'swap sign',
        })

        this.finishStep({
          isMeSigned: true,
        }, { step: 'sign' })
      })

      return true
    }
  }


  verifyLtcScript() {
    if (this.state.ltcScriptVerified) {
      return true
    }
    if (!this.state.ltcScriptValues) {
      throw new Error(`No script, cannot verify`)
    }

    this.finishStep({
      ltcScriptVerified: true,
    }, { step: 'verify-script' })

    return true
  }

  async syncBalance() {
    const { sellAmount } = this.swap

    this.setState({
      isBalanceFetching: true,
    })

    const balance = await this.puffsSwap.fetchBalance(this.app.services.auth.accounts.puffs.address)
    const isEnoughMoney = sellAmount.isLessThanOrEqualTo(balance)

    if (isEnoughMoney) {
      this.finishStep({
        balance,
        isBalanceFetching: false,
        isBalanceEnough: true,
      }, { step: 'sync-balance' })
    }
    else {
      this.setState({
        balance,
        isBalanceFetching: false,
        isBalanceEnough: false,
      })
    }
  }

  tryRefund() {
    const { participant } = this.swap

    return this.puffsSwap.refund({
      participantAddress: participant.puffs.address,
    }, (hash) => {
      this.setState({
        refundTransactionHash: hash,
        isRefunded: true,
      })
    })
      .then(() => {
        this.swap.room.sendMessage({
          event: 'refund completed',
        })

        this.setState({
          isSwapExist: false,
        })
      })
  }

  async tryWithdraw(_secret) {
  const { secret, secretHash, isPuffsWithdrawn, isLtcWithdrawn, ltcScriptValues } = this.state
    if (!_secret)
      throw new Error(`Withdrawal is automatic. For manual withdrawal, provide a secret`)

    if (!ltcScriptValues)
      throw new Error(`Cannot withdraw without script values`)

    if (secret && secret != _secret)
      console.warn(`Secret already known and is different. Are you sure?`)

    if (isLtcWithdrawn)
      console.warn(`Looks like money were already withdrawn, are you sure?`)

    debug('swap.core:flow')(`WITHDRAW using secret = ${_secret}`)

    const _secretHash = crypto.ripemd160(Buffer.from(_secret, 'hex')).toString('hex')
    if (secretHash != _secretHash)
      console.warn(`Hash does not match!`)

    const { scriptAddress } = this.ltcSwap.createScript(ltcScriptValues)
    const balance = await this.ltcSwap.getBalance(scriptAddress)

    debug('swap.core:flow')(`address=${scriptAddress}, balance=${balance}`)

    if (balance === 0) {
      this.finishStep({
        isLtcWithdrawn: true,
      }, { step: 'withdraw-ltc' })
      throw new Error(`Already withdrawn: address=${scriptAddress},balance=${balance}`)
    }

    await this.ltcSwap.withdraw({
      scriptValues: ltcScriptValues,
      secret: _secret,
    }, (hash) => {
      debug('swap.core:flow')(`TX hash=${hash}`)
      this.setState({
        ltcSwapWithdrawTransactionHash: hash,
      })
    })
    debug('swap.core:flow')(`TX withdraw sent: ${this.state.ltcSwapWithdrawTransactionHash}`)

    this.finishStep({
      isLtcWithdrawn: true,
    }, { step: 'withdraw-ltc' })
  }

}


export default PUFFS2LTC
