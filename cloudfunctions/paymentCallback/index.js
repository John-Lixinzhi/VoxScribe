const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const FREE_QUOTA_SECONDS = 600

async function ensureAccount(openid) {
  const users = db.collection('users')
  const existing = await users.where({ _openid: openid }).limit(1).get()
  if (existing.data.length > 0) return
  await users.doc(openid).set({
    data: {
      _openid: openid,
      nickname: '微信用户',
      remainingSeconds: FREE_QUOTA_SECONDS,
      usedSeconds: 0,
      freeQuotaSeconds: FREE_QUOTA_SECONDS,
      createdAt: db.serverDate(),
      updatedAt: db.serverDate()
    }
  })
}

exports.main = async (event) => {
  try {
    if (event.returnCode !== 'SUCCESS' || event.resultCode !== 'SUCCESS') {
      throw new Error('支付回调未确认成功状态')
    }
    const outTradeNo = String(event.outTradeNo || '')
    if (!outTradeNo) throw new Error('支付回调缺少商户订单号')
    const orderResult = await db.collection('orders').where({ outTradeNo }).limit(1).get()
    const order = orderResult.data[0]
    if (!order) throw new Error('支付订单不存在')
    if (Number(event.totalFee) !== Number(order.amountFen)) {
      throw new Error('支付回调金额与订单不一致')
    }

    await ensureAccount(order._openid)
    await db.runTransaction(async (transaction) => {
      const orderSnapshot = await transaction.collection('orders').doc(order._id).get()
      if (orderSnapshot.data.status === 'paid') return
      const userSnapshot = await transaction.collection('users').doc(order._openid).get()
      const account = userSnapshot.data
      await transaction.collection('users').doc(order._openid).update({
        data: {
          remainingSeconds: Number(account.remainingSeconds || 0) + Number(order.seconds),
          updatedAt: db.serverDate()
        }
      })
      await transaction.collection('orders').doc(order._id).update({
        data: {
          status: 'paid',
          transactionId: String(event.transactionId || ''),
          paidAt: db.serverDate(),
          updatedAt: db.serverDate()
        }
      })
    })
    console.info('[paymentCallback] 支付订单已入账', { outTradeNo })
    return { errcode: 0, errmsg: 'OK' }
  } catch (error) {
    console.error('[paymentCallback]', error)
    return { errcode: -1, errmsg: error.message || '支付回调处理失败' }
  }
}
