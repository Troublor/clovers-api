const debug = require('debug')('app:models:simpleCloversMarket')
import r from 'rethinkdb'
import utils from 'web3-utils'
import BigNumber from 'bignumber.js'
import { dodb, padBigNum } from '../lib/util'

let db, io

// event updatePrice(uint256 _tokenId, uint256 price); // NOTE: lowercase u
export let simpleCloversMarketupdatePrice = async function({
  log,
  io: _io,
  db: _db
}) {
  db = _db
  io = _io

  debug(log.name + ' called')
  let _tokenId = log.data._tokenId
  await changeCloverPrice(db, io, _tokenId, log)
}

export let simpleCloversMarketOwnershipTransferred = async function({
  log,
  io,
  db
}) {
  debug(log.name + ' does not affect the database')
}

export async function changeCloverPrice (db, io, _tokenId, log) {
  let price = log.data.price
  if (Array.isArray(price)) {
    price = price[0]
  }
  price = typeof price == 'object' ? price : new BigNumber(price)

  debug('changeCloverPrice', price)

  // price = BigInt(price.toString()).toString(16)

  let command = r
    .db('clovers_v2')
    .table('clovers')
    .get(_tokenId)
  let clover = await dodb(db, command)

  if (price.eq(0)) {
    debug('removed from market or sold (set to 0)')
    price = '0'
  } else {
    price = price.toString(10).padStart(64, '0')
  }
  clover.price = price
  clover.modified = log.blockNumber
  command = r
    .db('clovers_v2')
    .table('clovers')
    .insert(clover, { conflict: 'update' })
  await dodb(db, command)

  // get clover again, with comments and orders
  r.db('clovers_v2')
    .table('clovers')
    .get(_tokenId)
    .do((doc) => {
      return doc.merge({
        commentCount: r.table('chats')
          .getAll(doc('board'), { index: 'board' })
          .count(),
        lastOrder: r.table('orders')
          .getAll(doc('board'), { index: 'market' })
          .orderBy(r.desc('created'), r.desc('transactionIndex'))
          .limit(1).fold(null, (l, r) => r),
        user: r.table('users').get(doc('owner'))
          .without('clovers', 'curationMarket').default(null)
      })
    })
    .run(db, (err, result) => {
      io && io.emit('updateClover', result)
      debug(io ? 'emit updateClover' : 'do not emit updateClover')
    })
}
