import swap from 'swap.core'
import debug from 'debug'

export const save = (_swap) => {
  const storage = swap.app.env.storage

  const history = storage.getItem('history') || []

  try {
    const id = _swap.id

    if (history.filter(_id => _id === id).length > 0) {
      return debug('swap.core:simple:history')(`swap already saved id = ${id}`)
    }

    const newHistory = [ ...history, id ]

    storage.setItem('history', newHistory)

    debug('swap.core:simple:history')(`saved swap = ${id}`)
  } catch (err) {
    debug('swap.core:simple:history')('Error:', err)
    debug('swap.core:simple:history')('Error:', `Cannot save swap.history, rewind back`)
  }
}

export const remove = (_swap) => {
  const storage = swap.app.env.storage

  const history = storage.getItem('history') || []

  try {
    const id = _swap.id

    if (history.filter(_id => _id === id).length == 0) {
      return debug('swap.core:simple:history')(`swap not saved id = ${id} cant remove`)
    }

    const newHistory = history.filter(_id => _id !== id)

    storage.setItem('history', newHistory)

    debug('swap.core:simple:history')(`remove swap = ${id}`)
  } catch (err) {
    debug('swap.core:simple:history')('Error:', err)
    debug('swap.core:simple:history')('Error:', `Cannot save swap.history, rewind back`)
  }
}

export const getAll = () => {
  const storage = swap.app.env.storage

  const history = storage.getItem('history') || []

  debug('swap.core:simple:history')(`history = ${history}`)

  return history
}

module.exports = { save, getAll, remove }
