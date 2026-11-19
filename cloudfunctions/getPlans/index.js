const PLANS = [
  { id: 'minutes_60', name: '轻量包', seconds: 3600, priceFen: 990, description: '60 分钟，适合会议片段与短视频' },
  { id: 'minutes_240', name: '进阶包', seconds: 14400, priceFen: 2490, description: '240 分钟，适合课程与访谈', tag: '最受欢迎' },
  { id: 'minutes_600', name: '创作包', seconds: 36000, priceFen: 4990, description: '600 分钟，适合持续内容生产', tag: '单价更低' }
]

exports.main = async () => ({
  code: 0,
  message: 'success',
  data: { plans: PLANS.map((plan) => ({ ...plan })) }
})
