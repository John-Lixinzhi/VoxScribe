const https = require('https')
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const FREE_QUOTA_SECONDS = 600
const MAX_FILE_SIZE = 200 * 1024 * 1024
const ALLOWED_EXTENSIONS = ['mp3', 'm4a', 'wav', 'aac', 'flac', 'mp4', 'mkv']
const ALLOWED_LANGUAGES = ['auto', 'zh', 'en', 'ja', 'ko']
const ALLOWED_MODELS = ['small', 'medium']

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

function requestAsr(path, payload) {
  const baseUrl = (process.env.ASR_SERVICE_URL || '').replace(/\/$/, '')
  const token = process.env.ASR_SERVICE_TOKEN
  if (!baseUrl || !token) throw new Error('云端转写服务尚未配置')
  const url = new URL(`${baseUrl}${path}`)
  if (url.protocol !== 'https:') throw new Error('ASR_SERVICE_URL 必须使用 HTTPS')
  const body = JSON.stringify(payload)

  return new Promise((resolve, reject) => {
    const request = https.request(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      },
      timeout: 25000
    }, (response) => {
      let text = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => {
        text += chunk
        if (text.length > 2 * 1024 * 1024) request.destroy(new Error('转写服务响应过大'))
      })
      response.on('end', () => {
        try {
          const result = JSON.parse(text || '{}')
          if (response.statusCode < 200 || response.statusCode >= 300) {
            reject(new Error(result.detail || `转写服务返回 ${response.statusCode}`))
            return
          }
          resolve(result)
        } catch (error) {
          reject(new Error('转写服务返回了无效响应'))
        }
      })
    })
    request.on('timeout', () => request.destroy(new Error('转写服务请求超时')))
    request.on('error', reject)
    request.write(body)
    request.end()
  })
}

exports.main = async (event) => {
  let jobId = null
  try {
    const { OPENID: openid } = cloud.getWXContext()
    if (!openid) throw new Error('无法识别用户身份')
    const fileID = String(event.fileID || '')
    const fileName = String(event.fileName || '').trim()
    const fileSize = Number(event.fileSize || 0)
    const extension = fileName.split('.').pop().toLowerCase()
    if (!fileID || !fileName) throw new Error('文件参数不完整')
    if (!ALLOWED_EXTENSIONS.includes(extension)) throw new Error('不支持该文件格式')
    if (fileSize <= 0 || fileSize > MAX_FILE_SIZE) throw new Error('文件大小需介于 0 到 200 MB 之间')

    const account = await ensureAccount(openid)
    if (account.remainingSeconds < 60) throw new Error('可用时长不足，请先充值')

    const language = ALLOWED_LANGUAGES.includes(event.language) ? event.language : 'auto'
    const model = ALLOWED_MODELS.includes(event.model) ? event.model : 'small'
    const inserted = await db.collection('transcription_jobs').add({
      data: {
        _openid: openid,
        fileID,
        fileName,
        fileSize,
        status: 'queued',
        progress: 0,
        language,
        model,
        withSrt: event.withSrt !== false,
        createdAt: db.serverDate(),
        updatedAt: db.serverDate()
      }
    })
    jobId = inserted._id

    const tempUrls = await cloud.getTempFileURL({ fileList: [fileID] })
    const sourceUrl = tempUrls.fileList[0] && tempUrls.fileList[0].tempFileURL
    if (!sourceUrl) throw new Error('无法读取已上传的文件')

    const remote = await requestAsr('/v1/transcriptions', {
      sourceUrl,
      fileName,
      language,
      model,
      withSrt: event.withSrt !== false
    })
    if (!remote.id) throw new Error('转写服务未返回任务编号')

    await db.collection('transcription_jobs').doc(jobId).update({
      data: {
        remoteJobId: remote.id,
        status: remote.status === 'processing' ? 'processing' : 'queued',
        updatedAt: db.serverDate()
      }
    })
    const snapshot = await db.collection('transcription_jobs').doc(jobId).get()
    console.info('[createTranscription] 任务已提交', { jobId, remoteJobId: remote.id })
    return { code: 0, message: 'success', data: { job: publicJob(snapshot.data) } }
  } catch (error) {
    console.error('[createTranscription]', error)
    if (jobId) {
      await db.collection('transcription_jobs').doc(jobId).update({
        data: { status: 'failed', error: error.message, updatedAt: db.serverDate() }
      }).catch((updateError) => console.error('[createTranscription] 更新失败状态异常', updateError))
    }
    return { code: -1, message: error.message || '创建转写任务失败', data: null }
  }
}
