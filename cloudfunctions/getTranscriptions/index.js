const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

function isoDate(value) {
  if (!value) return new Date().toISOString()
  if (value instanceof Date) return value.toISOString()
  return new Date(value).toISOString()
}

function publicJob(data) {
  return {
    _id: data._id,
    fileName: data.fileName,
    fileSize: data.fileSize,
    status: data.status,
    progress: data.progress || 0,
    language: data.language,
    model: data.model,
    withSrt: data.withSrt !== false,
    createdAt: isoDate(data.createdAt),
    updatedAt: isoDate(data.updatedAt),
    error: data.error || undefined,
    result: data.result || undefined
  }
}

exports.main = async () => {
  try {
    const { OPENID: openid } = cloud.getWXContext()
    if (!openid) throw new Error('无法识别用户身份')
    const result = await db.collection('transcription_jobs')
      .where({ _openid: openid })
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get()
    return {
      code: 0,
      message: 'success',
      data: { jobs: result.data.map(publicJob) }
    }
  } catch (error) {
    console.error('[getTranscriptions]', error)
    return { code: -1, message: error.message || '读取任务列表失败', data: null }
  }
}
