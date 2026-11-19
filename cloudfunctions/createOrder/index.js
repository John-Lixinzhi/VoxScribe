const crypto = require('crypto')
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const PLANS = [
  { id: 'minutes_60', name: '轻量包', seconds: 3600, priceFen: 990 },
  { id: 'minutes_240', name: '进阶包', seconds: 14400, priceFen: 2490 },
  { id: 'minutes_600', name: '创作包', seconds: 36000, priceFen: 4990 }
]

function isoDate(value) {
  if (!value) return new Date().toISOString()
  if (value instanceof Date) return value.toISOString()
  return new Date(value).toISOString()
}

function publicOrder(data) {
  return {
    _id: data._id,
    outTradeNo: data.outTradeNo,
    planId: data.planId,
    planName: data.planName,
    seconds: data.seconds,
    amountFen: data.amountFen,
    status: data.status,
    createdAt: isoDate(data.createdAt)
  }
}

exports.main = async (event) => {
  let orderId = null
  try {
    const context = cloud.getWXContext()
    const openid = context.OPENID
    const mchId = process.env.WECHAT_PAY_MCHID
    if (!openid) throw new Error('无法识别用户身份')
    if (!mchId) throw new Error('微信支付商户号尚未配置')
    const plan = PLANS.find((item) => item.id === event.planId)
    if (!plan) throw new Error('所选套餐不存在')

    const outTradeNo = `VS${Date.now()}${crypto.randomBytes(4).toString('hex').toUpperCase()}`
    const inserted = await db.collection('orders').add({
      data: {
        _openid: openid,
        outTradeNo,
        planId: plan.id,
        planName: plan.name,
        seconds: plan.seconds,
        amountFen: plan.priceFen,
        status: 'pending',
        createdAt: db.serverDate(),
        updatedAt: db.serverDate()
      }
    })
    orderId = inserted._id

    const paymentResult = await cloud.cloudPay.unifiedOrder({
      body: `VoxScribe ${plan.name}`,
      outTradeNo,
      spbillCreateIp: '127.0.0.1',
      subMchId: mchId,
      totalFee: plan.priceFen,
      envId: context.ENV,
      functionName: 'paymentCallback'
    })
    if (!paymentResult.payment) throw new Error('微信支付未返回支付参数')

    const snapshot = await db.collection('orders').doc(orderId).get()
    return {
      code: 0,
      message: 'success',
      data: { order: publicOrder(snapshot.data), payment: paymentResult.payment }
    }
  } catch (error) {
    console.error('[createOrder]', error)
    if (orderId) {
      await db.collection('orders').doc(orderId).update({
        data: { status: 'failed', error: error.message, updatedAt: db.serverDate() }
      }).catch((updateError) => console.error('[createOrder] 更新订单状态失败', updateError))
    }
    return { code: -1, message: error.message || '创建支付订单失败', data: null }
  }
}
