import debug from 'debug'
import crypto from 'bitcoinjs-lib/src/crypto' // move to BtcSwap
import SwapApp, { constants, util } from 'swap.app'
import { Flow } from 'swap.swap'


class PUFFS2BTC extends Flow {

  static getName() {
    return `${this.getFromName()}2${this.getToName()}`
  }
  static getFromName() {
    return constants.COINS.puffs
  }
  static getToName() {
    return constants.COINS.btc
  }
  constructor(swap) {
    super(swap)

    this._flowName = PUFFS2BTC.getName()

    this.stepNumbers = {
      'sign': 1,
      'wait-lock-btc': 2,
      'verify-script': 3,
      'sync-balance': 4,
      'lock-eth': 5,
      'wait-withdraw-eth': 6, // aka getSecret
      'withdraw-btc': 7,
      'finish': 8,
      'end': 9
    }

    this.puffsSwap = swap.participantSwap
    this.btcSwap = swap.ownerSwap

    if (!this.puffsSwap) {
      throw new Error('BTC2PUFFS: "puffsSwap" of type object required')
    }
    if (!this.btcSwap) {
      throw new Error('BTC2ETH: "btcSwap" of type object required')
    }

    this.state = {
      step: 0,

      isStoppedSwap: false,
      isEnoughMoney: false,

      signTransactionHash: null,
      isSignFetching: false,
      isMeSigned: false,

      secretHash: null,
      btcScriptValues: null,

      btcScriptVerified: false,

      isBalanceFetching: false,
      isBalanceEnough: false,
      balance: null,

      btcScriptCreatingTransactionHash: null,
      puffsSwapCreationTransactionHash: null,
      canCreatePuffsTransaction: true,
      isPuffsContractFunded: false,

      secret: null,

      isPuffsWithdrawn: false,
      isBtcWithdrawn: false,

      refundTransactionHash: null,
      isRefunded: false,

      isFinished: false,
      isSwapExist: false,
    }

    this.swap.room.once('swap was canceled for core', () => {
      console.error('Swap was stopped')
      this.setState({
        isStoppedSwap: true,
      })
    })

    super._persistSteps()
    this._persistState()

    const flow = this
    flow.swap.room.once('request withdraw', () => {
      flow.setState({
        withdrawRequestIncoming: true,
      })
    })
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

      // 2. Wait participant create, fund BTC Script

      () => {
        flow.swap.room.once('create btc script', ({ scriptValues, btcScriptCreatingTransactionHash }) => {
          flow.finishStep({
            secretHash: scriptValues.secretHash,
            btcScriptValues: scriptValues,
            btcScriptCreatingTransactionHash,
          }, { step: 'wait-lock-btc', silentError: true })
        })
        flow.swap.room.sendMessage({
          event: 'request btc script',
        })
      },

      // 3. Verify BTC Script

      () => {
        debug('swap.core:flow')(`waiting verify btc script`)
        // this.verifyBtcScript()
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

        await util.helpers.repeatAsyncUntilResult(async () => {
          const scriptCheckError = await flow.btcSwap.checkScript(flow.state.btcScriptValues, {
            value: buyAmount,
            recipientPublicKey: this.app.services.auth.accounts.btc.getPublicKey(),
            lockTime: getLockTime(),
            confidence: 0.8,
          })

          if (scriptCheckError) {
            console.error(`Btc script check error:`, scriptCheckError)
            flow.swap.events.dispatch('btc script check error', scriptCheckError)

            return false
          } else {
            return true
          }
        })

        const swapData = {
          participantAddress: participant.puffs.address,
          secretHash: flow.state.secretHash,
          amount: sellAmount,
          targetWallet: flow.swap.destinationSellAddress
        }
        const tryCreateSwap = async () => {
          if (!flow.state.isEthContractFunded) {
            try {
              debug('swap.core:flow')('create swap', swapData)
              await this.puffsSwap.create(swapData, (hash) => {
                debug('swap.core:flow')('create swap tx hash', hash)
                flow.swap.room.sendMessage({
                  event: 'create PUFFS contract',
                  data: {
                    puffsSwapCreationTransactionHash: hash,
                  },
                })

                flow.setState({
                  puffsSwapCreationTransactionHash: hash,
                  canCreatePuffsTransaction: true,
                })
              })
            } catch (err) {
              if ( /known transaction/.test(err.message) ) {
                console.error(`known tx: ${err.message}`)
              } else if ( /out of gas/.test(err.message) ) {
                console.error(`tx failed (wrong secret?): ${err.message}`)
              } else {
                console.error(err)
              }

              flow.setState({
                canCreatePuffsTransaction: false,
              })

              return null
            }
          }
          return true
        }
        const isPuffsContractFunded = await util.helpers.repeatAsyncUntilResult(() =>
          tryCreateSwap(),
        )

        if (isPuffsContractFunded) {
          debug('swap.core:flow')(`finish step`)
          flow.finishStep({
            isPuffsContractFunded,
          }, {step: 'lock-puffs'})
        }
      },

      // 6. Wait participant withdraw

      async () => {
        flow.swap.room.once('puffsWithdrawTxHash', async ({puffsSwapWithdrawTransactionHash}) => {
          flow.setState({
            puffsSwapWithdrawTransactionHash,
          })

          let secretFromTxhash = await util.helpers.repeatAsyncUntilResult(() => {
            const { secret } = flow.state

            if (secret) {
              return secret
            } else {
              return flow.puffsSwap.getSecretFromTxhash(puffsSwapWithdrawTransactionHash)
            }
          })

          secretFromTxhash = `0x${secretFromTxhash.replace(/^0x/, '')}`

          const { isPuffsWithdrawn } = flow.state

          if (!isPuffsWithdrawn && secretFromTxhash) {
            debug('swap.core:flow')('got secret from tx', puffsSwapWithdrawTransactionHash, secretFromTxhash)
            flow.finishStep({
              isPuffsWithdrawn: true,
              secret: secretFromTxhash,
            }, {step: 'wait-withdraw-puffs'})
          }
        })

        flow.swap.room.sendMessage({
          event: 'request puffsWithdrawTxHash',
        })

        // If partner decides to scam and doesn't send puffsWithdrawTxHash
        // then we try to withdraw as in PUFFSTOKEN2USDT

        const { participant } = flow.swap

        const checkSecretExist = async () => {
          try {
            let secretFromContract = await flow.puffsSwap.getSecret({
              participantAddress: participant.puffs.address,
            })

            if (secretFromContract) {

              secretFromContract = `0x${secretFromContract.replace(/^0x/, '')}`

              return secretFromContract
            } else {
              console.warn('Secret does not exist')

              return null
            }
          }
          catch (err) {
            console.error(err)

            return null
          }
        }

        flow.swap.room.once('finish puffs withdraw', () =>
          checkSecretExist()
        )

        const secretFromContract = await util.helpers.repeatAsyncUntilResult((stopRepeat) => {
          const { isPuffsWithdrawn } = flow.state

          if (isPuffsWithdrawn) {
            console.warn('Secret already exists')
            stopRepeat()

            return false
          }

          return checkSecretExist()
        })

        if (secretFromContract) {
          debug('swap.core:flow')('got secret from smart contract', secretFromContract)

          flow.finishStep({
            isPuffsWithdrawn: true,
            secret: secretFromContract,
          }, { step: 'wait-withdraw-puffs' })
        }
      },


      // 7. Withdraw

      async () => {
        let { secret, btcScriptValues } = flow.state

        if (!btcScriptValues) {
          console.error('There are no "btcScriptValues" in state. No way to continue swap...')
          return
        }

        console.log("Debug - destination address....")
        await flow.btcSwap.withdraw({
          scriptValues: flow.state.btcScriptValues,
          secret,
          destinationAddress: flow.swap.destinationBuyAddress,
        }, (hash) => {
          flow.setState({
            btcSwapWithdrawTransactionHash: hash,
          })
        })



        flow.finishStep({
          isBtcWithdrawn: true,
        }, { step: 'withdraw-btc' })
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

  acceptWithdrawRequest() {
    const flow = this

    if (this.state.withdrawRequestAccepted) return
    this.setState({
      withdrawRequestAccepted: true,
    })

    this.swap.room.once('do withdraw', async ({secret}) => {
      try {
        const data = {
          participantAddress: flow.swap.participant.puffs.address,
          secret,
        }

        await flow.puffsSwap.withdrawNoMoney(data, (hash) => {
          flow.swap.room.sendMessage({
            event: 'withdraw ready',
            data: {
              puffsSwapWithdrawTransactionHash: hash,
            }
          })
        })
      } catch (err) {
        debug('swap.core:flow')(err.message)
      }
    })

    this.swap.room.sendMessage({
      event: 'accept withdraw request'
    })
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

      this.swap.room.on('request sign', () => {
        this.swap.room.sendMessage({
          event: 'swap sign',
        })
      })

      this.swap.room.sendMessage({
        event: 'swap sign',
      })

      this.finishStep({
        isMeSigned: true,
      }, { step: 'sign', silentError: true })

      return true
    }
  }


  verifyBtcScript() {
    if (this.state.btcScriptVerified) {
      return true
    }
    if (!this.state.btcScriptValues) {
      throw new Error(`No script, cannot verify`)
    }

    this.finishStep({
      btcScriptVerified: true,
    }, { step: 'verify-script' })

    return true
  }

  async syncBalance() {
    const checkBalance = async () => {
      const { sellAmount } = this.swap

      this.setState({
        isBalanceFetching: true,
      })

      const balance = await this.ethSwap.fetchBalance(this.app.services.auth.accounts.puffs.address)
      const isEnoughMoney = sellAmount.isLessThanOrEqualTo(balance)

      this.setState({
        isEnoughMoney,
      })

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
    await util.helpers.repeatAsyncUntilResult((stopRepeat) => {
      if (!this.state.isStoppedSwap && !this.state.isEnoughMoney) {
        checkBalance()
      } else {
        stopRepeat()
      }
    })
  }

  async tryRefund() {
    const { secretHash } = this.state

    const refundHandler = () => {
      this.swap.room.sendMessage({
        event: 'refund completed',
      })

      this.setState({
        isSwapExist: false,
        isRefunded: true,
      })

      return true
    }

    const wasRefunded = this.puffsSwap.wasRefunded({ secretHash })

    if (wasRefunded) {
      debug('swap.core:flow')('This swap was refunded')

      return refundHandler()
    }

    return this.puffsSwap.refund({
      participantAddress: participant.puffs.address,
    }, (hash) => {
      this.setState({
        refundTransactionHash: hash,
      })
    })
    .then(() => refundHandler())
  }

  stopSwapProcess() { 
    this.setState({
      isStoppedSwap: true,
    })
    this.sendMessageAboutClose()
  }

  async tryWithdraw(_secret) {
    const { secret, secretHash, isPuffsWithdrawn, isBtcWithdrawn, btcScriptValues } = this.state

    if (!_secret)
      throw new Error(`Withdrawal is automatic. For manual withdrawal, provide a secret`)

    if (!btcScriptValues)
      throw new Error(`Cannot withdraw without script values`)

    if (secret && secret != _secret)
      console.warn(`Secret already known and is different. Are you sure?`)

    if (isBtcWithdrawn)
      console.warn(`Looks like coins have already been withdrawn, are you sure?`)

    debug('swap.core:flow')(`WITHDRAW using secret = ${_secret}`)

    const _secretHash = crypto.ripemd160(Buffer.from(_secret, 'hex')).toString('hex')
    if (secretHash != _secretHash)
      console.warn(`Hash does not match! state: ${secretHash}, given: ${_secretHash}`)

    const { scriptAddress } = this.btcSwap.createScript(btcScriptValues)
    const balance = await this.btcSwap.getBalance(scriptAddress)

    debug('swap.core:flow')(`address=${scriptAddress}, balance=${balance}`)

    if (balance === 0) {
      this.finishStep({
        isBtcWithdrawn: true,
      }, { step: 'withdraw-btc' })
      throw new Error(`Already withdrawn: address=${scriptAddress},balance=${balance}`)
    }

    await this.btcSwap.withdraw({
      scriptValues: btcScriptValues,
      secret: _secret,
    }, (hash) => {
      debug('swap.core:flow')(`TX hash=${hash}`)
      this.setState({
        btcSwapWithdrawTransactionHash: hash,
      })
    })
    debug('swap.core:flow')(`TX withdraw sent: ${this.state.btcSwapWithdrawTransactionHash}`)

    this.finishStep({
      isBtcWithdrawn: true,
    }, { step: 'withdraw-btc' })
  }

}


export default PUFFS2BTC
