const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const FREE_QUOTA_SECONDS = 600

function isoDate(value) {
  if (!value) return new Date().toISOString()
  if (value instanceof Date) return value.toISOString()
  return new Date(value).toISOString()
}

function publicAccount(data) {
  return {
    nickname: data.nickname || '微信用户',
    remainingSeconds: Math.max(0, Number(data.remainingSeconds || 0)),
    usedSeconds: Math.max(0, Number(data.usedSeconds || 0)),
    freeQuotaSeconds: Math.max(0, Number(data.freeQuotaSeconds || 0))
  }
}

async function ensureAccount(openid) {
  const users = db.collection('users')
  const existing = await users.where({ _openid: openid }).limit(1).get()
  if (existing.data.length > 0) return existing.data[0]

  const account = {
    _openid: openid,
    nickname: '微信用户',
    remainingSeconds: FREE_QUOTA_SECONDS,
    usedSeconds: 0,
    freeQuotaSeconds: FREE_QUOTA_SECONDS,
    createdAt: db.serverDate(),
    updatedAt: db.serverDate()
  }
  await users.doc(openid).set({ data: account })
  return { ...account, _id: openid }
}

exports.main = async () => {
  try {
    const { OPENID: openid } = cloud.getWXContext()
    if (!openid) throw new Error('无法识别用户身份')
    const account = await ensureAccount(openid)
    const orderResult = await db.collection('orders')
      .where({ _openid: openid })
      .orderBy('createdAt', 'desc')
      .limit(5)
      .get()
    const recentOrders = orderResult.data.map((order) => ({
      _id: order._id,
      outTradeNo: order.outTradeNo,
      planId: order.planId,
      planName: order.planName,
      seconds: order.seconds,
      amountFen: order.amountFen,
      status: order.status,
      createdAt: isoDate(order.createdAt)
    }))
    return {
      code: 0,
      message: 'success',
      data: { openid, account: publicAccount(account), recentOrders }
    }
  } catch (error) {
    console.error('[login]', error)
    return { code: -1, message: error.message || '账户初始化失败', data: null }
  }
}
